import type { Env } from './types';
import { COST, EODHD_BASE_URL, type Endpoint } from './config';
import { markExhausted, reserveCalls } from './quota';

/**
 * EODHD API クライアント。
 * - 呼べるのは config.ts の COST に載っている公式エンドポイントだけ
 * - 呼ぶ前に回数を確保し、結果（成功・失敗）を api_log に残す。APIキーはログに残さない
 */
export class EodhdError extends Error {
  constructor(message: string, readonly status: number | null, readonly code: 'no_key' | 'auth' | 'quota' | 'rate' | 'not_found' | 'plan' | 'bad_response' | 'network' | 'http') {
    super(message); this.name = 'EodhdError';
  }
}

export interface CallOptions { mode: 'auto' | 'manual'; symbol?: string; now?: Date }

const nowIso = (o?: CallOptions) => (o?.now ?? new Date()).toISOString();

async function log(env: Env, endpoint: string, symbol: string | undefined, cost: number, status: number | null, message: string, o?: CallOptions) {
  await env.DB.prepare('INSERT INTO api_log (at, endpoint, symbol, cost, http_status, message) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(nowIso(o), endpoint, symbol ?? null, cost, status, message.slice(0, 500)).run();
}

export async function callEodhd<T>(env: Env, endpoint: Endpoint, pathArg: string | null, params: Record<string, string>, o: CallOptions): Promise<T> {
  if (!env.EODHD_API_KEY) throw new EodhdError('EODHDのAPIキーが設定されていません（WorkerのシークレットEODHD_API_KEY）', null, 'no_key');
  const cost = COST[endpoint];
  await reserveCalls(env, cost, o.mode, o.now);

  const base = env.EODHD_BASE_URL || EODHD_BASE_URL;
  // 公式ドキュメントの書式どおり（exchanges-list だけ末尾に / が付く）
  const tail = pathArg ? `/${encodeURIComponent(pathArg)}` : endpoint === 'exchanges-list' ? '/' : '';
  const url = new URL(`${base}/${endpoint}${tail}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('fmt', 'json');
  url.searchParams.set('api_token', env.EODHD_API_KEY);
  const label = `${endpoint}${pathArg ? `/${pathArg}` : ''}`;

  let res: Response;
  try {
    res = await fetch(url.toString(), { headers: { accept: 'application/json' } });
  } catch (e) {
    await log(env, label, o.symbol, cost, null, `通信エラー: ${(e as Error).message}`, o);
    throw new EodhdError(`EODHDに接続できませんでした: ${(e as Error).message}`, null, 'network');
  }
  const text = await res.text();
  if (!res.ok) {
    const brief = text.replace(/\s+/g, ' ').slice(0, 200);
    await log(env, label, o.symbol, cost, res.status, brief, o);
    if (res.status === 402) { await markExhausted(env, o.now); throw new EodhdError('EODHDの1日の呼び出し上限に達しました（日本時間 9:00 に回復）', 402, 'quota'); }
    if (res.status === 429) throw new EodhdError(`EODHDの短時間の呼び出し上限に達しました（${res.headers.get('Retry-After') ?? '数十'}秒後に再試行してください）`, 429, 'rate');
    if (res.status === 401) throw new EodhdError('EODHDのAPIキーが正しくありません', 401, 'auth');
    if (res.status === 403) throw new EodhdError('このデータはEODHDの現在のプランでは利用できません', 403, 'plan');
    if (res.status === 404) throw new EodhdError(`EODHDにデータがありません（${label}）`, 404, 'not_found');
    throw new EodhdError(`EODHDがエラーを返しました（HTTP ${res.status}）`, res.status, 'http');
  }
  let data: unknown;
  try { data = JSON.parse(text); } catch {
    await log(env, label, o.symbol, cost, res.status, `JSONではない応答: ${text.slice(0, 120)}`, o);
    throw new EodhdError('EODHDの応答を読み取れませんでした', res.status, 'bad_response');
  }
  await log(env, label, o.symbol, cost, res.status, Array.isArray(data) ? `${data.length}件` : 'ok', o);
  return data as T;
}

/* ---- 公式ドキュメントに記載のある項目だけを型にする ---- */

/** /api/user（消費0回） */
export interface EodhdUser { apiRequests?: number; dailyRateLimit?: number; subscriptionType?: string; apiRequestsDate?: string }
/** /api/exchanges-list */
export interface EodhdExchange { Name: string; Code: string; Country?: string; Currency?: string }
/** /api/exchange-symbol-list/{EXCHANGE} */
export interface EodhdListedSymbol { Code: string; Name: string; Country?: string; Exchange?: string; Currency?: string; Type?: string; Isin?: string | null }
/** /api/eod/{SYMBOL} */
export interface EodhdBar { date: string; open: number; high: number; low: number; close: number; adjusted_close: number; volume: number }

export const getUser = (env: Env, o: CallOptions) => callEodhd<EodhdUser>(env, 'user', null, {}, o);
export const getExchanges = (env: Env, o: CallOptions) => callEodhd<EodhdExchange[]>(env, 'exchanges-list', null, {}, o);
export const getSymbolList = (env: Env, exchange: string, o: CallOptions) => callEodhd<EodhdListedSymbol[]>(env, 'exchange-symbol-list', exchange, {}, o);
export const getEod = (env: Env, symbol: string, from: string, to: string, o: CallOptions) =>
  callEodhd<EodhdBar[]>(env, 'eod', symbol, { from, to, period: 'd' }, { ...o, symbol });
