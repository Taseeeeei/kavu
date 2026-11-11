import { db } from './db';
import type {
  AccountType, Country, DataSource, DividendChangeEvent, DividendForecast, DividendRecord, Market, PriceQuote, Security, Trade,
} from '../domain/types';
import { securityIdOf, uid, toYmd } from '../domain/util';
import { computePosition } from '../domain/position';
import { detectDividendChange } from '../domain/dividendChange';
import { dividendDedupKey } from '../domain/dividends';
import { buildHolding, latestRecorded, summarize } from '../domain/portfolio';
import { loadSettings } from './settings';

const now = () => new Date().toISOString();
/** 直前の記録より必ず後になる日時（同一ミリ秒での順序の曖昧さを防ぐ） */
export const laterThan = (prev?: string | null) => {
  const t = Date.now();
  const p = prev ? new Date(prev).getTime() : 0;
  return new Date(Math.max(t, p + 1)).toISOString();
};

export interface SecurityInput {
  country: Country;
  code: string;
  name: string;
  market: Market;
  account: AccountType;
  recordMonths: number[];
  payMonths: number[];
  memo: string;
  sector?: string;
}

export class DuplicateError extends Error {}

export async function createSecurity(input: SecurityInput): Promise<Security> {
  const id = securityIdOf(input.country, input.code);
  const existing = await db.securities.get(id);
  if (existing && !existing.deletedAt) throw new DuplicateError(`銘柄コード ${input.code} は既に登録されています`);
  const s: Security = {
    id,
    ...input,
    code: input.code.trim().toUpperCase(),
    currency: input.country === 'US' ? 'USD' : 'JPY',
    createdAt: existing?.createdAt ?? now(),
    updatedAt: now(),
    deletedAt: null,
  };
  await db.securities.put(s);
  return s;
}

export async function updateSecurity(id: string, patch: Partial<Security>) {
  await db.securities.update(id, { ...patch, updatedAt: now() });
}

/** ゴミ箱へ移動（論理削除）。関連データは残すので復元可能。 */
export const trashSecurity = (id: string) => db.securities.update(id, { deletedAt: now() });
export const restoreSecurity = (id: string) => db.securities.update(id, { deletedAt: null });

/** 完全削除（ゴミ箱から）。削除前に自動バックアップを取る。 */
export async function purgeSecurity(id: string) {
  await createLocalBackup('銘柄の完全削除前');
  await db.transaction('rw', [db.securities, db.trades, db.prices, db.forecasts, db.events], async () => {
    await db.trades.where('securityId').equals(id).delete();
    await db.prices.where('securityId').equals(id).delete();
    await db.forecasts.where('securityId').equals(id).delete();
    await db.events.where('securityId').equals(id).delete();
    await db.securities.delete(id);
  });
}

export interface TradeInput { securityId: string; side: 'buy' | 'sell'; date: string; quantity: number; price: number; fee: number; memo: string }

const tradeKey = (t: Pick<Trade, 'securityId' | 'side' | 'date' | 'quantity' | 'price'>) =>
  `${t.securityId}|${t.side}|${t.date}|${t.quantity}|${t.price}`;

export async function findDuplicateTrade(t: TradeInput, excludeId?: string) {
  const list = await db.trades.where('securityId').equals(t.securityId).toArray();
  return list.find((x) => x.id !== excludeId && tradeKey(x) === tradeKey(t)) ?? null;
}

/** 取引を追加。売却で保有株数がマイナスになる場合は拒否。 */
export async function saveTrade(t: TradeInput, id?: string): Promise<Trade> {
  const list = await db.trades.where('securityId').equals(t.securityId).toArray();
  const existing = id ? list.find((x) => x.id === id) : undefined;
  const trade: Trade = { id: id ?? uid(), createdAt: existing?.createdAt ?? now(), ...t };
  const next = [...list.filter((x) => x.id !== trade.id), trade];
  const pos = computePosition(next);
  if (pos.errors.length) throw new Error(pos.errors[0]);
  await db.trades.put(trade);
  return trade;
}

export async function deleteTrade(id: string) {
  const t = await db.trades.get(id);
  if (!t) return;
  const list = await db.trades.where('securityId').equals(t.securityId).toArray();
  const pos = computePosition(list.filter((x) => x.id !== id));
  if (pos.errors.length) throw new Error(`この取引を削除すると売却株数が保有株数を超えます（${pos.errors[0]}）`);
  await db.trades.delete(id);
}

export async function addPrice(q: Omit<PriceQuote, 'id' | 'fetchedAt'> & { fetchedAt?: string }) {
  // 同一ソース・同一日付の株価は上書き（重複防止）
  const same = (await db.prices.where('securityId').equals(q.securityId).toArray()).find((x) => x.asOf === q.asOf && x.source === q.source);
  const row: PriceQuote = { ...q, id: same?.id ?? uid(), fetchedAt: q.fetchedAt ?? now() };
  await db.prices.put(row);
  return row;
}

/**
 * 配当予想を保存し、直前の予想と比べて増減配イベントを生成する。
 * 手動・CSVは origin='manual'。自動取得側は services/sync.ts で別途判定する。
 */
export async function setForecastManual(securityId: string, annualDps: number | null, source: DataSource, asOf = toYmd(new Date()), sourceDetail?: string) {
  const sec = await db.securities.get(securityId);
  if (!sec) throw new Error('銘柄が見つかりません');
  const prev = latestRecorded(await db.forecasts.where('securityId').equals(securityId).toArray());
  if (prev && prev.annualDps === annualDps) return null;
  const row: DividendForecast = { id: uid(), securityId, annualDps, asOf, fetchedAt: laterThan(prev?.fetchedAt), source, sourceDetail };
  await db.forecasts.put(row);
  if (prev) {
    const trades = await db.trades.where('securityId').equals(securityId).toArray();
    const shares = computePosition(trades).quantity;
    const ch = detectDividendChange(prev.annualDps, annualDps, shares);
    if (ch) {
      const ev: DividendChangeEvent = {
        id: uid(), securityId, code: sec.code, name: sec.name, ...ch, sharesHeld: shares,
        basis: '前回登録値との比較', disclosureDate: asOf, detectedAt: now(), source, sourceDetail,
        origin: 'manual', read: false,
      };
      await db.events.put(ev);
      return ev;
    }
  }
  return null;
}

export interface DividendInput extends Omit<DividendRecord, 'id' | 'createdAt'> {}

export async function findDuplicateDividend(r: DividendInput, excludeId?: string) {
  const list = await db.dividends.where('securityId').equals(r.securityId).toArray();
  const key = dividendDedupKey(r);
  return list.find((x) => x.id !== excludeId && dividendDedupKey(x) === key) ?? null;
}

export async function saveDividend(r: DividendInput, id?: string) {
  const existing = id ? await db.dividends.get(id) : undefined;
  const row: DividendRecord = { ...r, id: id ?? uid(), createdAt: existing?.createdAt ?? now() };
  await db.dividends.put(row);
  return row;
}

export async function deleteDividend(id: string) {
  await createLocalBackup('配当記録の削除前');
  await db.dividends.delete(id);
}

/** 全保有銘柄のビューを構築 */
export async function loadHoldings(includeClosed = false) {
  const [secs, trades, prices, forecasts, settings] = await Promise.all([
    db.securities.toArray(), db.trades.toArray(), db.prices.toArray(), db.forecasts.toArray(), loadSettings(),
  ]);
  const group = <T extends { securityId: string }>(xs: T[]) => {
    const m = new Map<string, T[]>();
    for (const x of xs) { const l = m.get(x.securityId) ?? []; l.push(x); m.set(x.securityId, l); }
    return m;
  };
  const gt = group(trades), gp = group(prices), gf = group(forecasts);
  return secs
    .filter((s) => !s.deletedAt)
    .map((s) => buildHolding(s, gt.get(s.id) ?? [], gp.get(s.id) ?? [], gf.get(s.id) ?? [], settings.taxRate))
    .filter((h) => includeClosed || h.position.quantity > 0);
}

/** 含み損益推移のための日次スナップショット（1日1件、上書き） */
export async function recordSnapshot() {
  const hs = await loadHoldings();
  const s = summarize(hs);
  if (s.holdingCount === 0) return;
  await db.snapshots.put({ date: toYmd(new Date()), cost: s.pricedCost, value: s.marketValue, pricedCount: s.pricedCount, holdingCount: s.holdingCount, annualDividend: s.annualDividend });
}

// ---------- バックアップ ----------
export const BACKUP_VERSION = 1;
const TABLES = ['securities', 'trades', 'prices', 'forecasts', 'dividends', 'events', 'snapshots', 'settings'] as const;

export async function exportJson(): Promise<string> {
  const data: Record<string, unknown[]> = {};
  for (const t of TABLES) {
    let rows = await db.table(t).toArray();
    if (t === 'settings') rows = rows.filter((r: { key: string }) => r.key !== 'proxyToken');
    data[t] = rows;
  }
  return JSON.stringify({ app: 'kav', version: BACKUP_VERSION, exportedAt: now(), data }, null, 2);
}

export function validateBackup(json: string): { ok: true; data: Record<string, unknown[]>; exportedAt: string } | { ok: false; error: string } {
  let obj: unknown;
  try { obj = JSON.parse(json); } catch { return { ok: false, error: 'JSONとして読み込めません' }; }
  const o = obj as { app?: string; version?: number; data?: Record<string, unknown[]>; exportedAt?: string };
  if (o?.app !== 'kav' || !o.data) return { ok: false, error: 'カヴのバックアップファイルではありません' };
  if ((o.version ?? 0) > BACKUP_VERSION) return { ok: false, error: '新しいバージョンのアプリで作成されたバックアップです' };
  for (const t of TABLES) if (o.data[t] !== undefined && !Array.isArray(o.data[t])) return { ok: false, error: `${t} の形式が不正です` };
  return { ok: true, data: o.data, exportedAt: o.exportedAt ?? '' };
}

/** 復元（全置換）。実行前に現在のデータを自動バックアップする。 */
export async function restoreJson(json: string) {
  const v = validateBackup(json);
  if (!v.ok) throw new Error(v.error);
  await createLocalBackup('復元前の自動バックアップ');
  const token = await db.settings.get('proxyToken');
  await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
    for (const t of TABLES) {
      await db.table(t).clear();
      const rows = v.data[t] ?? [];
      if (rows.length) await db.table(t).bulkPut(rows);
    }
    if (token) await db.settings.put(token);
  });
}

export async function createLocalBackup(reason: string) {
  const json = await exportJson();
  await db.backups.add({ createdAt: now(), reason, json });
  const all = await db.backups.orderBy('createdAt').primaryKeys();
  const excess = all.length - 10;
  if (excess > 0) await db.backups.bulkDelete(all.slice(0, excess));
}
