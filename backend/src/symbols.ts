import type { Env, SecurityRow } from './types';
import { EodhdError, getEod, getExchanges, getSymbolList, type EodhdListedSymbol } from './eodhd';
import { QuotaExceededError } from './quota';

export const FUND_NOTE = 'EODHD非対応・未確認（EODHDの銘柄記号が確認できていません）';

export interface VerifyReport {
  ok: boolean;
  callsPlanned: number;
  steps: { step: string; ok: boolean; message: string }[];
  securities: SecurityRow[];
}

const listSecurities = async (env: Env) =>
  (await env.DB.prepare('SELECT * FROM securities WHERE deleted_at IS NULL ORDER BY kind DESC, id').all<SecurityRow>()).results;

async function setStatus(env: Env, id: number, status: SecurityRow['eodhd_status'], note: string, extra: { eodhd_name?: string | null; currency?: string | null } = {}, now = new Date()) {
  await env.DB.prepare('UPDATE securities SET eodhd_status = ?, status_note = ?, verified_at = ?, eodhd_name = COALESCE(?, eodhd_name), currency = COALESCE(?, currency) WHERE id = ?')
    .bind(status, note, now.toISOString(), extra.eodhd_name ?? null, extra.currency ?? null, id).run();
}

/** 取引所の銘柄一覧の中から、銘柄記号（例 7203.TSE の 7203）に一致するものを探す */
export function findListed(list: EodhdListedSymbol[], code: string) {
  return list.find((x) => String(x.Code).toUpperCase() === code.toUpperCase()) ?? null;
}

/**
 * EODHDの公式一覧で対応銘柄を確認する（3回消費: exchanges-list, exchange-symbol-list/TSE, exchange-symbol-list/INDX）。
 * 一覧に載っていた銘柄は 'listed'。実際に株価を取得できた時点で 'supported' になる。
 */
export async function verifySymbols(env: Env, now = new Date()): Promise<VerifyReport> {
  const o = { mode: 'manual' as const, now };
  const report: VerifyReport = { ok: true, callsPlanned: 3, steps: [], securities: [] };
  const secs = await listSecurities(env);
  const byExchange = new Map<string, SecurityRow[]>();
  for (const s of secs) {
    if (s.kind === 'fund' && s.symbol.startsWith('FUND:')) { await setStatus(env, s.id, 'unverified', FUND_NOTE, {}, now); continue; }
    const [code, ex] = s.symbol.split('.');
    if (!code || !ex) continue;
    byExchange.set(ex, [...(byExchange.get(ex) ?? []), s]);
  }

  let exchanges: Set<string> | null = null;
  try {
    const list = await getExchanges(env, o);
    exchanges = new Set(list.map((x) => x.Code));
    const missing = [...byExchange.keys()].filter((c) => c !== 'INDX' && !exchanges!.has(c));
    report.steps.push({ step: '取引所一覧', ok: !missing.length, message: missing.length ? `EODHDの取引所一覧に ${missing.join(', ')} がありません` : `${[...byExchange.keys()].join(', ')} を確認しました（全${list.length}取引所）` });
  } catch (e) {
    report.steps.push({ step: '取引所一覧', ok: false, message: (e as Error).message });
    if (e instanceof QuotaExceededError || (e instanceof EodhdError && ['quota', 'auth', 'no_key', 'rate'].includes(e.code))) { report.ok = false; report.securities = await listSecurities(env); return report; }
  }

  for (const [ex, rows] of byExchange) {
    try {
      const list = await getSymbolList(env, ex, o);
      let found = 0;
      for (const s of rows) {
        const hit = findListed(list, s.symbol.split('.')[0]);
        if (hit) { found++; await setStatus(env, s.id, 'listed', `EODHDの${ex}銘柄一覧に記載あり（${hit.Name}）。株価の取得はまだ確認していません`, { eodhd_name: hit.Name, currency: hit.Currency ?? null }, now); }
        else await setStatus(env, s.id, 'unsupported', `EODHDの${ex}銘柄一覧（${list.length}件）にありません`, {}, now);
      }
      report.steps.push({ step: `${ex}の銘柄一覧`, ok: found === rows.length, message: `${rows.length}件中${found}件が一覧にありました（一覧の総数${list.length}件）` });
    } catch (e) {
      report.ok = false;
      report.steps.push({ step: `${ex}の銘柄一覧`, ok: false, message: (e as Error).message });
      for (const s of rows) await setStatus(env, s.id, 'unverified', `確認できませんでした: ${(e as Error).message}`, {}, now);
      if (e instanceof QuotaExceededError || (e instanceof EodhdError && ['quota', 'auth', 'no_key', 'rate'].includes(e.code))) break;
    }
  }
  if (report.steps.some((s) => !s.ok)) report.ok = false;
  report.securities = await listSecurities(env);
  return report;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/**
 * 銘柄記号で実際に直近の日足を1回取得して、対応可否を確定する（1回消費）。
 * 投信は、EODHDの銘柄記号がわかったときに candidate で試す。取得できたときだけ登録する。
 */
export async function testSymbol(env: Env, id: number, candidate: string | null, now = new Date()) {
  const sec = await env.DB.prepare('SELECT * FROM securities WHERE id = ?').bind(id).first<SecurityRow>();
  if (!sec) throw new Error('銘柄が見つかりません');
  const symbol = (candidate ?? sec.symbol).trim().toUpperCase();
  if (!/^[A-Z0-9_\-^]+\.[A-Z0-9]+$/.test(symbol)) throw new Error('銘柄記号は「コード.取引所」の形で入力してください（例 7203.TSE）');
  const from = new Date(now.getTime() - 14 * 86400_000);
  try {
    const bars = await getEod(env, symbol, ymd(from), ymd(now), { mode: 'manual', now });
    if (!Array.isArray(bars) || !bars.length) {
      if (!candidate) await setStatus(env, id, 'unsupported', `EODHDの日足が空でした（${ymd(from)}〜${ymd(now)}）`, {}, now);
      return { ok: false, message: `${symbol}: 直近2週間の日足が返ってきませんでした`, bars: 0 };
    }
    const fetchedAt = now.toISOString();
    const stmts = bars.filter((b) => b && typeof b.date === 'string').map((b) =>
      env.DB.prepare('INSERT INTO prices_daily (symbol, date, open, high, low, close, adjusted_close, volume, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(symbol, date) DO UPDATE SET open=excluded.open, high=excluded.high, low=excluded.low, close=excluded.close, adjusted_close=excluded.adjusted_close, volume=excluded.volume, fetched_at=excluded.fetched_at')
        .bind(symbol, b.date, num(b.open), num(b.high), num(b.low), num(b.close), num(b.adjusted_close), num(b.volume), fetchedAt));
    if (stmts.length) await env.DB.batch(stmts);
    const last = bars[bars.length - 1];
    if (candidate && candidate.toUpperCase() !== sec.symbol) {
      await env.DB.prepare('UPDATE securities SET symbol = ?, exchange = ? WHERE id = ?').bind(symbol, symbol.split('.')[1], id).run();
    }
    await setStatus(env, id, 'supported', `EODHDから日足を取得できました（最新 ${last.date} 終値 ${last.close}）`, {}, now);
    await env.DB.prepare(`INSERT INTO fetch_status (symbol, kind, last_attempt_at, last_success_at, last_data_date, last_error) VALUES (?, 'eod', ?, ?, ?, NULL)
      ON CONFLICT(symbol, kind) DO UPDATE SET last_attempt_at=excluded.last_attempt_at, last_success_at=excluded.last_success_at, last_data_date=excluded.last_data_date, last_error=NULL`)
      .bind(symbol, fetchedAt, fetchedAt, last.date).run();
    return { ok: true, message: `${symbol}: ${bars.length}日分を取得しました（最新 ${last.date}）`, bars: bars.length };
  } catch (e) {
    if (e instanceof EodhdError && e.code === 'not_found' && !candidate) await setStatus(env, id, 'unsupported', `EODHDに ${symbol} の日足がありません（404）`, {}, now);
    throw e;
  }
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
