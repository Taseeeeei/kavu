/**
 * カヴ用 J-Quants API プロキシ（Cloudflare Workers）
 *
 * - J-Quants の APIキーは Worker のシークレット JQUANTS_API_KEY にのみ保存し、ブラウザには渡さない
 * - ACCESS_TOKEN を設定すると、ヘッダ x-kav-token が一致するリクエストだけを通す（他人による利用を防止）
 * - ALLOWED_ORIGIN にアプリの公開URLのオリジンを設定すると、CORS をそのオリジンだけに許可
 * - 必要なエンドポイントだけを許可し、GET のみ中継
 * - レスポンスはエッジで短時間キャッシュし、J-Quants のレート制限を節約
 */
const UPSTREAM = 'https://api.jquants.com';
const ALLOW = ['/v2/equities/bars/daily', '/v2/equities/master', '/v2/fins/summary', '/v2/equities/earnings-calendar', '/v2/fins/dividend'];
const TTL = { '/v2/equities/master': 86400, '/v2/fins/summary': 3600, '/v2/equities/bars/daily': 1800, '/v2/equities/earnings-calendar': 3600, '/v2/fins/dividend': 3600 };

function cors(env, req) {
  const origin = req.headers.get('Origin') || '';
  const allowed = env.ALLOWED_ORIGIN ? (env.ALLOWED_ORIGIN.split(',').map((s) => s.trim()).includes(origin) ? origin : 'null') : '*';
  return { 'Access-Control-Allow-Origin': allowed, 'Access-Control-Allow-Headers': 'x-kav-token', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Max-Age': '86400', Vary: 'Origin' };
}

export default {
  async fetch(req, env, ctx) {
    const h = cors(env, req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
    if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405, headers: h });
    if (env.ACCESS_TOKEN && req.headers.get('x-kav-token') !== env.ACCESS_TOKEN) return new Response('Forbidden', { status: 403, headers: h });
    const url = new URL(req.url);
    if (url.pathname === '/health') return new Response(`ok: kav-proxy (key ${env.JQUANTS_API_KEY ? 'configured' : 'MISSING'})`, { headers: { ...h, 'content-type': 'text/plain; charset=utf-8' } });
    if (!ALLOW.includes(url.pathname)) return new Response('Not Found', { status: 404, headers: h });
    if (!env.JQUANTS_API_KEY) return new Response('JQUANTS_API_KEY is not configured', { status: 500, headers: h });

    const upstream = new URL(url.pathname + url.search, UPSTREAM);
    const cacheKey = new Request(upstream.toString(), { method: 'GET' });
    const cache = caches.default;
    const hit = await cache.match(cacheKey);
    if (hit) { const r = new Response(hit.body, hit); Object.entries(h).forEach(([k, v]) => r.headers.set(k, v)); r.headers.set('x-kav-cache', 'HIT'); return r; }

    const res = await fetch(upstream, { headers: { 'x-api-key': env.JQUANTS_API_KEY } });
    const body = await res.arrayBuffer();
    const out = new Response(body, { status: res.status, headers: { 'content-type': res.headers.get('content-type') || 'application/json', ...h } });
    if (res.ok) {
      const c = new Response(body, { status: res.status, headers: { 'content-type': out.headers.get('content-type'), 'Cache-Control': `max-age=${TTL[url.pathname] || 600}` } });
      ctx.waitUntil(cache.put(cacheKey, c));
    }
    return out;
  },
};
