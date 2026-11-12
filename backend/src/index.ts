/**
 * カヴ バックエンド（Cloudflare Worker + D1）
 * - 株価・配当の取得元は EODHD API だけ。他の取得元への切り替えは行わない
 * - EODHDのAPIキーは Worker のシークレットにだけ置き、PWAには渡さない
 * - PWAからのリクエストは APP_TOKEN（Bearer）で認証する
 */
import type { Env, ExecutionContext } from './types';
import { FREE_PLAN, limits } from './config';
import { getUsage, recordRemoteUsage, QuotaExceededError } from './quota';
import { EodhdError, getUser } from './eodhd';
import { testSymbol, verifySymbols } from './symbols';

const VERSION = 'phase1';

function corsHeaders(env: Env, req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allowed = (env.ALLOWED_ORIGIN ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const ok = !allowed.length || allowed.includes(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin || '*' : 'null',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const json = (body: unknown, status: number, h: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { ...h, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

/** 時間に依存しない比較（トークンの推測を難しくする） */
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function errorResponse(e: unknown, h: Record<string, string>) {
  if (e instanceof QuotaExceededError) return json({ error: e.message, code: 'quota' }, 429, h);
  if (e instanceof EodhdError) return json({ error: e.message, code: e.code, status: e.status }, e.code === 'no_key' ? 500 : 502, h);
  return json({ error: (e as Error).message ?? String(e), code: 'error' }, 400, h);
}

export async function handle(req: Request, env: Env, now = new Date()): Promise<Response> {
  const h = corsHeaders(env, req);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  // 認証不要：設定状況の確認だけ（秘密の値そのものは返さない）
  if (path === '/api/health') {
    let dbReady = false;
    try { await env.DB.prepare('SELECT 1 FROM securities LIMIT 1').first(); dbReady = true; } catch { /* マイグレーション未適用 */ }
    return json({ ok: true, app: 'kav-backend', version: VERSION, eodhdKey: !!env.EODHD_API_KEY, appToken: !!env.APP_TOKEN, dbReady }, 200, h);
  }

  if (!env.APP_TOKEN) return json({ error: 'WorkerにAPP_TOKENが設定されていません', code: 'no_token' }, 500, h);
  const auth = req.headers.get('authorization') ?? '';
  if (!safeEqual(auth, `Bearer ${env.APP_TOKEN}`)) return json({ error: '合言葉（APP_TOKEN）が違います', code: 'unauthorized' }, 401, h);

  try {
    if (req.method === 'GET' && path === '/api/status') {
      if (url.searchParams.get('refresh') === '1') {
        // /api/user は消費0回。EODHD側の使用回数と照合する
        const u = await getUser(env, { mode: 'manual', now });
        await recordRemoteUsage(env, num(u.apiRequests), num(u.dailyRateLimit), now);
      }
      const usage = await getUsage(env, now);
      const lim = limits(env);
      return json({ usage, limits: lim, plan: FREE_PLAN, now: now.toISOString() }, 200, h);
    }
    if (req.method === 'GET' && path === '/api/securities') {
      const r = await env.DB.prepare('SELECT * FROM securities WHERE deleted_at IS NULL ORDER BY id').all();
      return json({ securities: r.results }, 200, h);
    }
    if (req.method === 'POST' && path === '/api/verify') {
      return json(await verifySymbols(env, now), 200, h);
    }
    const m = path.match(/^\/api\/securities\/(\d+)\/test$/);
    if (req.method === 'POST' && m) {
      const body = await req.json().catch(() => ({})) as { candidate?: string };
      const r = await testSymbol(env, Number(m[1]), body.candidate?.trim() || null, now);
      return json(r, 200, h);
    }
    if (req.method === 'GET' && path === '/api/log') {
      const r = await env.DB.prepare('SELECT * FROM api_log ORDER BY id DESC LIMIT 100').all();
      return json({ log: r.results }, 200, h);
    }
    return json({ error: 'Not Found' }, 404, h);
  } catch (e) {
    return errorResponse(e, h);
  }
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export default {
  fetch(req: Request, env: Env, _ctx: ExecutionContext) { return handle(req, env); },
};
