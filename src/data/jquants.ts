import type { MarketDataProvider, QuoteResult, CompanyInfo } from './provider';
import { RateLimitError, ProviderConfigError } from './provider';
import type { FinSummaryRecord } from '../domain/dividendChange';
import { toYmd } from '../domain/util';

/**
 * J-Quants API V2（JPX公式）を、利用者自身がデプロイしたプロキシ経由で呼ぶ。
 * APIキーはプロキシ側（Cloudflare Worker のシークレット）にのみ保存し、フロントエンドには置かない。
 * レート制限: Free 5回/分, Light 60, Standard 120, Premium 500（fins/summary は全プラン60回/分）
 * 無料プランはデータが12週間遅延する。
 */
export const PLAN_RPM: Record<string, number> = { free: 5, light: 60, standard: 120, premium: 500 };
export const PLAN_LABEL: Record<string, string> = { free: 'Free（12週間遅延）', light: 'Light', standard: 'Standard', premium: 'Premium' };

export const toJqCode = (code: string) => (code.length === 4 ? `${code}0` : code);

export class JQuantsProvider implements MarketDataProvider {
  id = 'jquants';
  label = 'J-Quants API（JPX公式）';
  private last = 0;
  private interval: number;
  constructor(private baseUrl: string, private token: string, plan: string, private fetchImpl: typeof fetch = fetch.bind(globalThis)) {
    if (!baseUrl) throw new ProviderConfigError('プロキシURLが設定されていません');
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.interval = Math.ceil(60000 / Math.min(PLAN_RPM[plan] ?? 5, 60)) + 200;
  }
  supports(country: string) { return country === 'JP'; }

  private async get<T>(path: string, params: Record<string, string>): Promise<T[]> {
    const out: T[] = [];
    let pagination: string | undefined;
    for (let page = 0; page < 20; page++) {
      const wait = this.last + this.interval - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.last = Date.now();
      const qs = new URLSearchParams({ ...params, ...(pagination ? { pagination_key: pagination } : {}) });
      const res = await this.fetchImpl(`${this.baseUrl}/v2${path}?${qs}`, { headers: this.token ? { 'x-kav-token': this.token } : {} });
      if (res.status === 429) throw new RateLimitError('J-Quantsのレート制限に達しました。2分以上待ってから再実行してください。');
      if (res.status === 401 || res.status === 403) throw new ProviderConfigError(`認証エラー（${res.status}）。プロキシのトークンまたはAPIキーを確認してください。`);
      if (!res.ok) throw new Error(`J-Quants ${path} がエラーを返しました（${res.status}）`);
      const body = (await res.json()) as { data?: T[]; pagination_key?: string; cursor?: string };
      out.push(...(body.data ?? []));
      pagination = body.pagination_key || undefined;
      if (!pagination) break;
    }
    return out;
  }

  async getQuote(code: string): Promise<QuoteResult | null> {
    const to = new Date();
    const from = new Date(to.getTime() - 1000 * 60 * 60 * 24 * 120); // 無料プランの12週間遅延も考慮
    const rows = await this.get<{ Date: string; C: number | null; MktCap?: number | null }>('/equities/bars/daily', { code: toJqCode(code), from: toYmd(from), to: toYmd(to) });
    const valid = rows.filter((r) => r.C !== null && r.C !== undefined).sort((a, b) => a.Date.localeCompare(b.Date));
    if (valid.length === 0) return null;
    const last = valid[valid.length - 1];
    const prev = valid.length > 1 ? valid[valid.length - 2] : null;
    return { date: last.Date, close: Number(last.C), prevClose: prev ? Number(prev.C) : null, marketCap: last.MktCap != null ? Number(last.MktCap) : null };
  }

  async getCompany(code: string): Promise<CompanyInfo | null> {
    const rows = await this.get<{ Code: string; CoName: string; MktNm: string; S33Nm: string }>('/equities/master', { code: toJqCode(code) });
    const r = rows[rows.length - 1];
    return r ? { code, name: r.CoName, marketName: r.MktNm, sector: r.S33Nm } : null;
  }

  async getFinSummaries(code: string): Promise<FinSummaryRecord[]> {
    return this.get<FinSummaryRecord>('/fins/summary', { code: toJqCode(code) });
  }

  async getEarningsCalendar() {
    const rows = await this.get<{ Date: string; Code: string; CoName: string }>('/equities/earnings-calendar', {});
    return rows.map((r) => ({ date: r.Date, code: r.Code, name: r.CoName }));
  }

  async ping(): Promise<string> {
    const res = await this.fetchImpl(`${this.baseUrl}/health`, { headers: this.token ? { 'x-kav-token': this.token } : {} });
    if (!res.ok) throw new Error(`プロキシに接続できません（${res.status}）`);
    return res.text();
  }
}
