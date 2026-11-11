import type { FinSummaryRecord } from '../domain/dividendChange';

/** 市場データ提供元の抽象インターフェース（米国株など他の提供元を追加できるように） */
export interface QuoteResult { date: string; close: number; prevClose: number | null; marketCap: number | null }
export interface CompanyInfo { code: string; name: string; marketName: string; sector: string }

export interface MarketDataProvider {
  id: string;
  label: string;
  supports(country: string): boolean;
  getQuote(code: string): Promise<QuoteResult | null>;
  getCompany(code: string): Promise<CompanyInfo | null>;
  getFinSummaries(code: string): Promise<FinSummaryRecord[]>;
  /** 指定期間の決算発表予定（任意） */
  getEarningsCalendar?(): Promise<{ date: string; code: string; name: string }[]>;
}

export class RateLimitError extends Error {}
export class ProviderConfigError extends Error {}
