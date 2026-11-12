/**
 * カヴ バックエンド（Cloudflare Worker）との通信。
 * EODHDのAPIキーはバックエンドにだけあり、このアプリには保存しない。
 * 株価・配当はすべてバックエンド経由でEODHDから取得したものだけを扱う。
 */
export type EodhdStatus = 'unverified' | 'listed' | 'supported' | 'unsupported';
export interface BackendSecurity {
  id: number; symbol: string; code: string | null; name: string; eodhd_name: string | null;
  kind: 'stock' | 'index' | 'fund'; exchange: string | null; currency: string | null;
  eodhd_status: EodhdStatus; status_note: string | null; verified_at: string | null;
}
export interface Usage {
  day: string; used: number; limit: number; reserve: number; remaining: number; exhausted: boolean;
  remoteUsed: number | null; remoteLimit: number | null; remoteCheckedAt: string | null; resetsAt: string;
}
export interface Health { ok: boolean; app: string; version: string; eodhdKey: boolean; appToken: boolean; dbReady: boolean }
export interface VerifyReport { ok: boolean; callsPlanned: number; steps: { step: string; ok: boolean; message: string }[]; securities: BackendSecurity[] }

export const STATUS_LABEL: Record<EodhdStatus, string> = {
  unverified: 'EODHD非対応・未確認',
  listed: 'EODHDの一覧に記載あり（株価は未確認）',
  supported: 'EODHD対応（取得を確認済み）',
  unsupported: 'EODHD非対応',
};

export class BackendError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) { super(message); this.name = 'BackendError'; }
}

export function checkBackendUrl(u: string): string | null {
  const v = u.trim();
  if (!v) return null;
  if (!/^https:\/\//.test(v) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(v)) return 'バックエンドのURLは https:// で始まる必要があります';
  try { new URL(v); } catch { return 'URLの形式が正しくありません'; }
  return null;
}

export class BackendClient {
  private base: string;
  constructor(url: string, private token: string) { this.base = url.trim().replace(/\/+$/, ''); }

  private async req<T>(path: string, init: RequestInit = {}, auth = true): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, {
        ...init,
        headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...(auth ? { authorization: `Bearer ${this.token}` } : {}) },
      });
    } catch {
      throw new BackendError('バックエンドに接続できませんでした（URL・通信状態を確認してください）', 'network', 0);
    }
    const body = await res.json().catch(() => null) as (T & { error?: string; code?: string }) | null;
    if (!res.ok || !body) throw new BackendError(body?.error ?? `バックエンドがエラーを返しました（HTTP ${res.status}）`, body?.code ?? 'http', res.status);
    return body;
  }

  health() { return this.req<Health>('/api/health', {}, false); }
  status(refresh = false) { return this.req<{ usage: Usage; limits: { daily: number; reserve: number; automatic: number } }>(`/api/status${refresh ? '?refresh=1' : ''}`); }
  securities() { return this.req<{ securities: BackendSecurity[] }>('/api/securities').then((r) => r.securities); }
  verify() { return this.req<VerifyReport>('/api/verify', { method: 'POST' }); }
  test(id: number, candidate?: string) { return this.req<{ ok: boolean; message: string; bars: number }>(`/api/securities/${id}/test`, { method: 'POST', body: JSON.stringify(candidate ? { candidate } : {}) }); }
}
