import type { D1Database, Env } from './types';
import { limits } from './config';

/** EODHDの1日の区切りは 0:00 GMT（日本時間 9:00） */
export const gmtDay = (d = new Date()) => d.toISOString().slice(0, 10);
export const nextResetAt = (d = new Date()) => {
  const r = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
  return r.toISOString();
};

export interface Usage {
  day: string;
  used: number;
  limit: number;
  reserve: number;
  remaining: number;
  exhausted: boolean;
  remoteUsed: number | null;
  remoteLimit: number | null;
  remoteCheckedAt: string | null;
  resetsAt: string;
}

export class QuotaExceededError extends Error {
  constructor(message: string) { super(message); this.name = 'QuotaExceededError'; }
}

async function ensureRow(db: D1Database, day: string, limit: number) {
  await db.prepare('INSERT INTO api_usage (day, calls_used, daily_limit) VALUES (?, 0, ?) ON CONFLICT(day) DO UPDATE SET daily_limit = excluded.daily_limit')
    .bind(day, limit).run();
}

export async function getUsage(env: Env, now = new Date()): Promise<Usage> {
  const { daily, reserve } = limits(env);
  const day = gmtDay(now);
  await ensureRow(env.DB, day, daily);
  const r = await env.DB.prepare('SELECT * FROM api_usage WHERE day = ?').bind(day).first<{
    calls_used: number; daily_limit: number; exhausted: number; remote_used: number | null; remote_limit: number | null; remote_checked_at: string | null;
  }>();
  // 残りは「自分で数えた回数」と「EODHDが返した回数」の多い方を使って少なめに見積もる
  const used = Math.max(r!.calls_used, r!.remote_used ?? 0);
  const limit = Math.min(r!.daily_limit, r!.remote_limit ?? Infinity);
  return {
    day, used, limit, reserve,
    remaining: r!.exhausted ? 0 : Math.max(0, limit - used),
    exhausted: !!r!.exhausted || used >= limit,
    remoteUsed: r!.remote_used, remoteLimit: r!.remote_limit, remoteCheckedAt: r!.remote_checked_at,
    resetsAt: nextResetAt(now),
  };
}

/**
 * 呼び出し前に回数を確保する。404などの失敗でもEODHDは1回と数えるため、呼ぶ前に必ず加算する。
 * mode='auto' のときは予備の回数（CALL_RESERVE）に手を付けない。
 */
export async function reserveCalls(env: Env, cost: number, mode: 'auto' | 'manual', now = new Date()): Promise<void> {
  if (cost <= 0) return;
  const u = await getUsage(env, now);
  const ceiling = mode === 'auto' ? u.limit - u.reserve : u.limit;
  if (u.exhausted) throw new QuotaExceededError(`本日のAPI呼び出し上限（${u.limit}回）に達しました。日本時間 9:00 に回復します`);
  if (u.used + cost > ceiling) {
    throw new QuotaExceededError(mode === 'auto'
      ? `自動取得に使える回数（${ceiling}回）を使い切りました。予備${u.reserve}回は手動操作用に残しています`
      : `残り${u.remaining}回のため、${cost}回必要な操作を実行できません`);
  }
  // 同時実行でも上限を超えないよう、条件付きUPDATEで確保する
  const res = await env.DB.prepare('UPDATE api_usage SET calls_used = calls_used + ? WHERE day = ? AND exhausted = 0 AND MAX(calls_used, COALESCE(remote_used, 0)) + ? <= ?')
    .bind(cost, u.day, cost, ceiling).run();
  if (!res.meta.changes) throw new QuotaExceededError('API呼び出し上限に達しました');
}

/** EODHDが402（上限到達）を返したら、その日はもう呼ばない */
export async function markExhausted(env: Env, now = new Date()) {
  const { daily } = limits(env);
  const day = gmtDay(now);
  await ensureRow(env.DB, day, daily);
  await env.DB.prepare('UPDATE api_usage SET exhausted = 1 WHERE day = ?').bind(day).run();
}

/** /api/user（消費0回）の値で照合する */
export async function recordRemoteUsage(env: Env, used: number | null, limit: number | null, now = new Date()) {
  const { daily } = limits(env);
  const day = gmtDay(now);
  await ensureRow(env.DB, day, daily);
  await env.DB.prepare('UPDATE api_usage SET remote_used = ?, remote_limit = ?, remote_checked_at = ?, calls_used = MAX(calls_used, COALESCE(?, 0)) WHERE day = ?')
    .bind(used, limit, now.toISOString(), used, day).run();
}
