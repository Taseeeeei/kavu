import type { Env } from './types';

export const EODHD_BASE_URL = 'https://eodhd.com/api';

/** EODHD無料プランの公式値（https://eodhd.com/financial-apis/api-limits） */
export const FREE_PLAN = {
  dailyCalls: 20,
  eodHistoryYears: 1,
  realtimeDelayMinutes: '15〜20',
} as const;

/**
 * 各エンドポイントの消費回数（EODHD公式ドキュメント記載の値）。
 * ここに無いエンドポイントは呼び出さない。
 */
export const COST = {
  eod: 1,
  'real-time': 1,
  div: 1,
  'exchange-symbol-list': 1,
  'exchanges-list': 1,
  user: 0,
} as const;
export type Endpoint = keyof typeof COST;

const int = (v: string | undefined, d: number, min = 0) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min ? Math.floor(n) : d;
};

export function limits(env: Env) {
  const daily = int(env.DAILY_CALL_LIMIT, FREE_PLAN.dailyCalls, 1);
  const reserve = Math.min(int(env.CALL_RESERVE, 2), daily - 1);
  return { daily, reserve, automatic: daily - reserve };
}
