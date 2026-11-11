import { db } from '../db/db';
import { toCsv, csvToObjects, parseNumber, parseMonths, normalizeDate } from '../domain/csv';
import type { DividendKind, Market, Security, AccountType, Country } from '../domain/types';
import { DIVIDEND_KIND_LABELS, MARKET_LABELS } from '../domain/types';
import { securityIdOf, uid } from '../domain/util';
import { computePosition } from '../domain/position';
import { dividendDedupKey } from '../domain/dividends';
import { withholdingTax, grossFromDps } from '../domain/tax';
import { createLocalBackup, setForecastManual } from '../db/repo';

export const CSV_HEADERS = {
  securities: ['国', '銘柄コード', '企業名', '市場', '口座', '権利確定月', '支払月', 'メモ'],
  trades: ['国', '銘柄コード', '企業名', '売買', '約定日', '株数', '単価', '手数料', 'メモ'],
  dividends: ['国', '銘柄コード', '企業名', '受取日', '1株配当', '株数', '税引前', '税金', '税引後', '区分', 'メモ'],
  forecasts: ['国', '銘柄コード', '1株年間配当予想', '基準日', '情報源メモ'],
} as const;
export type CsvKind = keyof typeof CSV_HEADERS;

const marketFromLabel = (s: string): Market => {
  const hit = (Object.entries(MARKET_LABELS) as [Market, string][]).find(([k, v]) => v === s || k === s);
  return hit ? hit[0] : 'TSE_PRIME';
};
const kindFromLabel = (s: string): DividendKind => {
  const hit = (Object.entries(DIVIDEND_KIND_LABELS) as [DividendKind, string][]).find(([k, v]) => v === s || k === s || v.replace('配当', '') === s);
  return hit ? hit[0] : 'other';
};

export async function exportCsv(kind: CsvKind): Promise<string> {
  const secs = await db.securities.toArray();
  const byId = new Map(secs.map((s) => [s.id, s]));
  const h = [...CSV_HEADERS[kind]];
  if (kind === 'securities') {
    return toCsv(h, secs.filter((s) => !s.deletedAt).map((s) => [s.country, s.code, s.name, MARKET_LABELS[s.market], s.account === 'nisa' ? 'NISA' : '課税', s.recordMonths.join(' '), s.payMonths.join(' '), s.memo]));
  }
  if (kind === 'trades') {
    const ts = (await db.trades.toArray()).sort((a, b) => a.date.localeCompare(b.date));
    return toCsv(h, ts.map((t) => { const s = byId.get(t.securityId); return [s?.country ?? 'JP', s?.code ?? t.securityId, s?.name ?? '', t.side === 'buy' ? '買' : '売', t.date, t.quantity, t.price, t.fee, t.memo]; }));
  }
  if (kind === 'dividends') {
    const ds = (await db.dividends.toArray()).sort((a, b) => a.receivedDate.localeCompare(b.receivedDate));
    return toCsv(h, ds.map((d) => [byId.get(d.securityId)?.country ?? 'JP', d.code, d.name, d.receivedDate, d.dps, d.shares, d.gross, d.tax, d.net, DIVIDEND_KIND_LABELS[d.kind], d.memo]));
  }
  const fs = (await db.forecasts.toArray()).sort((a, b) => a.asOf.localeCompare(b.asOf));
  return toCsv(h, fs.map((f) => { const s = byId.get(f.securityId); return [s?.country ?? 'JP', s?.code ?? '', f.annualDps ?? '未定', f.asOf, f.sourceDetail ?? '']; }));
}

export const csvTemplate = (kind: CsvKind) => toCsv([...CSV_HEADERS[kind]], []);

export function detectCsvKind(header: string[]): CsvKind | null {
  for (const k of Object.keys(CSV_HEADERS) as CsvKind[]) {
    const need = CSV_HEADERS[k].filter((x) => x !== 'メモ' && x !== '国' && x !== '情報源メモ' && x !== '企業名');
    if (need.every((x) => header.includes(x))) return k;
  }
  return null;
}

export interface ImportResult { kind: CsvKind; added: number; skippedDuplicates: number; errors: string[] }

async function ensureSecurity(country: Country, code: string, name: string, cache: Map<string, Security>): Promise<Security> {
  const id = securityIdOf(country, code);
  const hit = cache.get(id) ?? (await db.securities.get(id));
  if (hit) {
    if (hit.deletedAt) { hit.deletedAt = null; await db.securities.put(hit); }
    cache.set(id, hit); return hit;
  }
  const t = new Date().toISOString();
  const s: Security = { id, country, code: code.toUpperCase(), name: name || code, market: country === 'US' ? 'US' : 'TSE_PRIME', currency: country === 'US' ? 'USD' : 'JPY', account: 'taxable', recordMonths: [], payMonths: [], memo: '', createdAt: t, updatedAt: t, deletedAt: null };
  await db.securities.put(s);
  cache.set(id, s);
  return s;
}

export async function importCsv(text: string): Promise<ImportResult> {
  const { header, rows } = csvToObjects(text);
  const kind = detectCsvKind(header);
  if (!kind) throw new Error('CSVの見出し行を認識できません。テンプレートの見出しに合わせてください。');
  await createLocalBackup(`CSVインポート前（${kind}）`);
  const res: ImportResult = { kind, added: 0, skippedDuplicates: 0, errors: [] };
  const cache = new Map<string, Security>();
  const country = (r: Record<string, string>): Country => (r['国'] === 'US' ? 'US' : 'JP');

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const line = i + 2;
    const code = r['銘柄コード'];
    if (!code) { res.errors.push(`${line}行目: 銘柄コードがありません`); continue; }
    try {
      if (kind === 'securities') {
        const id = securityIdOf(country(r), code);
        const ex = await db.securities.get(id);
        const s = await ensureSecurity(country(r), code, r['企業名'], cache);
        await db.securities.put({ ...s, name: r['企業名'] || s.name, market: marketFromLabel(r['市場']), account: (r['口座'] === 'NISA' ? 'nisa' : 'taxable') as AccountType, recordMonths: parseMonths(r['権利確定月']), payMonths: parseMonths(r['支払月']), memo: r['メモ'] ?? s.memo, updatedAt: new Date().toISOString() });
        if (ex && !ex.deletedAt) res.skippedDuplicates++; else res.added++;
      } else if (kind === 'trades') {
        const date = normalizeDate(r['約定日']);
        const q = parseNumber(r['株数']); const p = parseNumber(r['単価']);
        if (!date || !q || q <= 0 || p === null || p < 0) { res.errors.push(`${line}行目: 約定日・株数・単価を確認してください`); continue; }
        const side = /売|sell/i.test(r['売買']) ? 'sell' : 'buy';
        const s = await ensureSecurity(country(r), code, r['企業名'], cache);
        const list = await db.trades.where('securityId').equals(s.id).toArray();
        if (list.some((t) => t.side === side && t.date === date && t.quantity === q && t.price === p)) { res.skippedDuplicates++; continue; }
        const t = { id: uid(), securityId: s.id, side, date, quantity: q, price: p, fee: parseNumber(r['手数料']) ?? 0, memo: r['メモ'] ?? '', createdAt: new Date().toISOString() } as const;
        const pos = computePosition([...list, t]);
        if (pos.errors.length) { res.errors.push(`${line}行目: ${pos.errors[0]}`); continue; }
        await db.trades.put(t); res.added++;
      } else if (kind === 'dividends') {
        const date = normalizeDate(r['受取日']);
        const shares = parseNumber(r['株数']) ?? 0;
        const d = parseNumber(r['1株配当']) ?? 0;
        if (!date) { res.errors.push(`${line}行目: 受取日を確認してください`); continue; }
        const s = await ensureSecurity(country(r), code, r['企業名'], cache);
        const gross = parseNumber(r['税引前']) ?? grossFromDps(d, shares);
        const tax = parseNumber(r['税金']) ?? withholdingTax(gross, s.account);
        const net = parseNumber(r['税引後']) ?? gross - tax;
        const rec = { id: uid(), securityId: s.id, code: s.code, name: r['企業名'] || s.name, receivedDate: date, dps: d, shares, gross, tax, net, kind: kindFromLabel(r['区分']), memo: r['メモ'] ?? '', createdAt: new Date().toISOString() };
        const list = await db.dividends.where('securityId').equals(s.id).toArray();
        if (list.some((x) => dividendDedupKey(x) === dividendDedupKey(rec))) { res.skippedDuplicates++; continue; }
        await db.dividends.put(rec); res.added++;
      } else {
        const raw = r['1株年間配当予想'];
        const v = raw === '未定' ? null : parseNumber(raw);
        if (v === null && raw !== '未定') { res.errors.push(`${line}行目: 1株年間配当予想が数値ではありません`); continue; }
        const date = normalizeDate(r['基準日']) ?? undefined;
        const s = await ensureSecurity(country(r), code, '', cache);
        const before = await db.forecasts.where('securityId').equals(s.id).count();
        await setForecastManual(s.id, v, 'csv', date, r['情報源メモ'] || undefined);
        const after = await db.forecasts.where('securityId').equals(s.id).count();
        if (after > before) res.added++; else res.skippedDuplicates++;
      }
    } catch (e) {
      res.errors.push(`${line}行目: ${(e as Error).message}`);
    }
  }
  return res;
}
