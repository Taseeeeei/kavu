// ドメイン型定義。UI・DBから独立した純粋な型。
export type Country = 'JP' | 'US';
export type Currency = 'JPY' | 'USD';
export type Market =
  | 'TSE_PRIME' | 'TSE_STANDARD' | 'TSE_GROWTH'
  | 'NSE' | 'FSE' | 'SSE' | 'US' | 'OTHER';

export const MARKET_LABELS: Record<Market, string> = {
  TSE_PRIME: '東証プライム',
  TSE_STANDARD: '東証スタンダード',
  TSE_GROWTH: '東証グロース',
  NSE: '名証',
  FSE: '福証',
  SSE: '札証',
  US: '米国',
  OTHER: 'その他',
};

export type AccountType = 'taxable' | 'nisa';

/** データの出所。表示時に必ず明示する。 */
/** 'jquants' と 'gsheet' は以前の版で保存されたデータの表示用（現在は取得しない） */
export type DataSource = 'manual' | 'eodhd' | 'csv' | 'jquants' | 'gsheet';
export const SOURCE_LABELS: Record<DataSource, string> = {
  manual: '手動入力',
  eodhd: 'EODHD API',
  jquants: 'J-Quants API（以前の版で取得）',
  csv: 'CSVインポート',
  gsheet: 'Googleスプレッドシート（以前の版で取得）',
};

export interface Security {
  id: string; // `${country}:${code}`
  country: Country;
  code: string;
  name: string;
  market: Market;
  currency: Currency;
  account: AccountType;
  recordMonths: number[]; // 配当権利確定月 (1-12)
  payMonths: number[]; // 配当支払月 (1-12)
  memo: string;
  /** 33業種（JPX一覧から自動入力） */
  sector?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null; // ゴミ箱（論理削除）
  /** 以前の版（J-Quants）で処理済みの最新開示日時。現在は使わない */
  lastDisclosureKey?: string;
}

export type TradeSide = 'buy' | 'sell';
export interface Trade {
  id: string;
  securityId: string;
  side: TradeSide;
  date: string; // YYYY-MM-DD
  quantity: number;
  price: number; // 1株あたり約定単価
  fee: number; // 手数料（任意）
  memo: string;
  createdAt: string;
}

export interface PriceQuote {
  id: string;
  securityId: string;
  price: number;
  prevClose?: number | null;
  marketCap?: number | null;
  asOf: string; // 株価の日付 YYYY-MM-DD
  fetchedAt: string; // 取得（入力）日時 ISO
  source: DataSource;
  sourceDetail?: string;
}

export interface DividendForecast {
  id: string;
  securityId: string;
  /** 1株あたり年間配当予想。null は「未定」 */
  annualDps: number | null;
  fiscalYearEnd?: string | null;
  asOf: string; // 開示日 or 入力日
  fetchedAt: string;
  source: DataSource;
  sourceDetail?: string;
}

export type DividendKind = 'interim' | 'final' | 'special' | 'commemorative' | 'quarterly' | 'other';
export const DIVIDEND_KIND_LABELS: Record<DividendKind, string> = {
  interim: '中間配当',
  final: '期末配当',
  special: '特別配当',
  commemorative: '記念配当',
  quarterly: '四半期配当',
  other: 'その他',
};

export interface DividendRecord {
  id: string;
  securityId: string;
  code: string;
  name: string;
  receivedDate: string; // YYYY-MM-DD
  dps: number;
  shares: number;
  gross: number; // 税引前
  tax: number;
  net: number; // 税引後（実受取）
  kind: DividendKind;
  memo: string;
  createdAt: string;
}

export type ChangeKind = 'increase' | 'decrease' | 'suspend' | 'resume';
export const CHANGE_KIND_LABELS: Record<ChangeKind, string> = {
  increase: '増配',
  decrease: '減配',
  suspend: '無配',
  resume: '復配',
};

export interface DividendChangeEvent {
  id: string;
  securityId: string;
  code: string;
  name: string;
  kind: ChangeKind;
  before: number;
  after: number;
  diffPerShare: number;
  rate: number | null; // % 変更前が0の場合 null
  sharesHeld: number;
  annualImpact: number; // 保有株数ベースの年間配当金増減額
  basis: string; // 比較の基準（例: 前回予想比 / 前期実績比）
  disclosureDate: string; // 開示日・入力日
  detectedAt: string; // アプリが取得・記録した日時
  source: DataSource;
  sourceDetail?: string;
  origin: 'auto' | 'history' | 'manual'; // 自動検知 / 過去開示からの取込 / 手動
  read: boolean;
}

export interface PortfolioSnapshot {
  date: string; // YYYY-MM-DD (1日1件)
  cost: number;
  value: number;
  pricedCount: number;
  holdingCount: number;
  annualDividend?: number;
}
