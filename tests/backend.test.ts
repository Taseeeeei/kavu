import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestD1 } from './helpers/d1';
import { handle } from '../backend/src/index';
import { getUsage, reserveCalls, QuotaExceededError } from '../backend/src/quota';
import { limits } from '../backend/src/config';
import type { Env } from '../backend/src/types';

const NOW = new Date('2026-11-12T03:00:00Z');
let env: Env;
let calls: string[];

/** EODHDの応答を模したフェイク（テスト専用。実データではない） */
function fakeEodhd(routes: Record<string, { status?: number; body: unknown }>) {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (u: string) => {
    const url = new URL(u);
    calls.push(url.pathname);
    expect(url.searchParams.get('api_token')).toBe('test-key');
    const r = routes[url.pathname];
    if (!r) return new Response('Ticker Not Found.', { status: 404 });
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }));
}

const req = (path: string, init: RequestInit = {}, token = 'secret') =>
  new Request(`https://kav.example${path}`, { ...init, headers: { authorization: `Bearer ${token}`, origin: 'https://taseeeeei.github.io', ...(init.headers ?? {}) } });

beforeEach(() => {
  env = { DB: createTestD1(), EODHD_API_KEY: 'test-key', APP_TOKEN: 'secret', ALLOWED_ORIGIN: 'https://taseeeeei.github.io', DAILY_CALL_LIMIT: '20', CALL_RESERVE: '2' };
});
afterEach(() => vi.unstubAllGlobals());

describe('設定値', () => {
  it('1日の上限と予備を設定値から読む', () => {
    expect(limits(env)).toEqual({ daily: 20, reserve: 2, automatic: 18 });
    expect(limits({ ...env, DAILY_CALL_LIMIT: 'abc', CALL_RESERVE: undefined })).toEqual({ daily: 20, reserve: 2, automatic: 18 });
    expect(limits({ ...env, DAILY_CALL_LIMIT: '100', CALL_RESERVE: '10' }).automatic).toBe(90);
  });
});

describe('呼び出し回数の管理', () => {
  it('自動取得は予備を残して止まり、手動は上限まで使える', async () => {
    for (let i = 0; i < 18; i++) await reserveCalls(env, 1, 'auto', NOW);
    await expect(reserveCalls(env, 1, 'auto', NOW)).rejects.toBeInstanceOf(QuotaExceededError);
    await reserveCalls(env, 1, 'manual', NOW);
    await reserveCalls(env, 1, 'manual', NOW);
    await expect(reserveCalls(env, 1, 'manual', NOW)).rejects.toBeInstanceOf(QuotaExceededError);
    const u = await getUsage(env, NOW);
    expect(u.used).toBe(20);
    expect(u.remaining).toBe(0);
  });
  it('0:00 GMT（日本時間9:00）で日付が切り替わる', async () => {
    for (let i = 0; i < 20; i++) await reserveCalls(env, 1, 'manual', NOW);
    const next = new Date('2026-11-13T00:00:01Z');
    expect((await getUsage(env, next)).used).toBe(0);
    expect((await getUsage(env, NOW)).resetsAt).toBe('2026-11-13T00:00:00.000Z');
  });
  it('402を受けたらその日はもう呼ばない', async () => {
    fakeEodhd({ '/api/exchanges-list/': { status: 402, body: { error: 'limit' } } });
    const r = await handle(req('/api/verify', { method: 'POST' }), env, NOW);
    const body = await r.json() as { ok: boolean };
    expect(body.ok).toBe(false);
    expect(calls.length).toBe(1);
    const u = await getUsage(env, NOW);
    expect(u.exhausted).toBe(true);
    expect(u.remaining).toBe(0);
    await expect(reserveCalls(env, 1, 'manual', NOW)).rejects.toBeInstanceOf(QuotaExceededError);
  });
  it('/api/user（消費0回）の使用回数と照合し、多い方を採用する', async () => {
    fakeEodhd({ '/api/user': { body: { apiRequests: 7, dailyRateLimit: 20 } } });
    await reserveCalls(env, 1, 'manual', NOW);
    const r = await handle(req('/api/status?refresh=1'), env, NOW);
    const body = await r.json() as { usage: { used: number; remaining: number; remoteUsed: number } };
    expect(body.usage.remoteUsed).toBe(7);
    expect(body.usage.used).toBe(7);
    expect(body.usage.remaining).toBe(13);
  });
});

describe('認証とキー管理', () => {
  it('合言葉がないと拒否し、healthは秘密の値を返さない', async () => {
    expect((await handle(req('/api/status', {}, 'wrong'), env, NOW)).status).toBe(401);
    const h = await (await handle(req('/api/health', {}, ''), env, NOW)).json() as Record<string, unknown>;
    expect(h).toMatchObject({ ok: true, eodhdKey: true, appToken: true, dbReady: true });
    expect(JSON.stringify(h)).not.toContain('test-key');
    expect(JSON.stringify(h)).not.toContain('secret');
  });
  it('APIキーをログに残さない', async () => {
    fakeEodhd({ '/api/exchanges-list/': { body: [{ Code: 'TSE', Name: 'Tokyo' }, { Code: 'US', Name: 'USA' }] }, '/api/exchange-symbol-list/TSE': { body: [] }, '/api/exchange-symbol-list/INDX': { body: [] } });
    await handle(req('/api/verify', { method: 'POST' }), env, NOW);
    const log = await (await handle(req('/api/log'), env, NOW)).json() as { log: unknown[] };
    expect(log.log.length).toBe(3);
    expect(JSON.stringify(log)).not.toContain('test-key');
  });
  it('許可していないオリジンにはCORSを許可しない', async () => {
    const r = await handle(new Request('https://kav.example/api/health', { headers: { origin: 'https://evil.example' } }), env, NOW);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe('null');
  });
});

describe('対応銘柄の確認', () => {
  it('EODHDの銘柄一覧に載っている銘柄だけを「一覧に記載あり」にし、投信は未確認のまま', async () => {
    fakeEodhd({
      '/api/exchanges-list/': { body: [{ Code: 'TSE', Name: 'Tokyo Stock Exchange' }] },
      '/api/exchange-symbol-list/TSE': { body: [{ Code: '7203', Name: 'Toyota Motor Corp', Exchange: 'TSE', Currency: 'JPY', Type: 'Common Stock' }, { Code: '9432', Name: 'NTT', Currency: 'JPY' }] },
      '/api/exchange-symbol-list/INDX': { body: [{ Code: 'N225', Name: 'Nikkei 225', Currency: 'JPY' }] },
    });
    const r = await (await handle(req('/api/verify', { method: 'POST' }), env, NOW)).json() as { securities: { symbol: string; eodhd_status: string; eodhd_name: string | null; status_note: string }[] };
    const by = Object.fromEntries(r.securities.map((s) => [s.symbol, s]));
    expect(calls).toEqual(['/api/exchanges-list/', '/api/exchange-symbol-list/TSE', '/api/exchange-symbol-list/INDX']);
    expect(by['7203.TSE']).toMatchObject({ eodhd_status: 'listed', eodhd_name: 'Toyota Motor Corp' });
    expect(by['9432.TSE'].eodhd_status).toBe('listed');
    expect(by['8058.TSE'].eodhd_status).toBe('unsupported');
    expect(by['N225.INDX'].eodhd_status).toBe('listed');
    expect(by['IXIC.INDX'].eodhd_status).toBe('unsupported');
    const fund = r.securities.find((s) => s.symbol.startsWith('FUND:'))!;
    expect(fund.eodhd_status).toBe('unverified');
    expect(fund.status_note).toContain('EODHD非対応・未確認');
    expect((await getUsage(env, NOW)).used).toBe(3);
  });

  it('実際に日足を取得できたら「対応」に確定し、取得した日足を保存する', async () => {
    fakeEodhd({ '/api/eod/7203.TSE': { body: [{ date: '2026-11-10', open: 1, high: 2, low: 1, close: 2, adjusted_close: 2, volume: 10 }, { date: '2026-11-11', open: 2, high: 3, low: 2, close: 3, adjusted_close: 3, volume: 5 }] } });
    const id = (await env.DB.prepare("SELECT id FROM securities WHERE symbol='7203.TSE'").first<{ id: number }>())!.id;
    const r = await (await handle(req(`/api/securities/${id}/test`, { method: 'POST', body: '{}' }), env, NOW)).json() as { ok: boolean; bars: number };
    expect(r).toMatchObject({ ok: true, bars: 2 });
    const sec = await env.DB.prepare('SELECT eodhd_status FROM securities WHERE id=?').bind(id).first<{ eodhd_status: string }>();
    expect(sec!.eodhd_status).toBe('supported');
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM prices_daily WHERE symbol='7203.TSE'").first<{ n: number }>();
    expect(n!.n).toBe(2);
  });

  it('日足が404なら「非対応」にする（推測で埋めない）', async () => {
    fakeEodhd({});
    const id = (await env.DB.prepare("SELECT id FROM securities WHERE symbol='7135.TSE'").first<{ id: number }>())!.id;
    const r = await handle(req(`/api/securities/${id}/test`, { method: 'POST', body: '{}' }), env, NOW);
    expect(r.status).toBe(502);
    const sec = await env.DB.prepare('SELECT eodhd_status FROM securities WHERE id=?').bind(id).first<{ eodhd_status: string }>();
    expect(sec!.eodhd_status).toBe('unsupported');
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM prices_daily").first<{ n: number }>();
    expect(n!.n).toBe(0);
  });

  it('投信は候補の銘柄記号で取得できたときだけ登録し、失敗したら未確認のまま', async () => {
    fakeEodhd({});
    const fund = (await env.DB.prepare("SELECT id FROM securities WHERE kind='fund' LIMIT 1").first<{ id: number }>())!;
    const r = await handle(req(`/api/securities/${fund.id}/test`, { method: 'POST', body: JSON.stringify({ candidate: 'ABC123.EUFUND' }) }), env, NOW);
    expect(r.status).toBe(502);
    const sec = await env.DB.prepare('SELECT symbol, eodhd_status FROM securities WHERE id=?').bind(fund.id).first<{ symbol: string; eodhd_status: string }>();
    expect(sec!.eodhd_status).toBe('unverified');
    expect(sec!.symbol.startsWith('FUND:')).toBe(true);
  });
});
