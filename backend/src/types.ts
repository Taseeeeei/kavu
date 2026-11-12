/** Cloudflare Workers / D1 の最小限の型（@cloudflare/workers-types を入れずに済ませるため） */
export interface D1Result<T = unknown> { results: T[]; success: boolean; meta: { changes?: number; last_row_id?: number } }
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}
export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}
export interface ExecutionContext { waitUntil(p: Promise<unknown>): void }

export interface Env {
  DB: D1Database;
  /** EODHDのAPIキー（Workerのシークレット。コードやリポジトリには書かない） */
  EODHD_API_KEY?: string;
  /** PWAからの利用を許可する合言葉（Workerのシークレット） */
  APP_TOKEN?: string;
  /** CORSを許可するオリジン（カンマ区切り） */
  ALLOWED_ORIGIN?: string;
  /** 1日のAPI呼び出し上限（EODHD無料プランは20） */
  DAILY_CALL_LIMIT?: string;
  /** 自動取得では使わずに残しておく回数（手動操作用の予備） */
  CALL_RESERVE?: string;
  /** テスト用：EODHDのベースURLを差し替える */
  EODHD_BASE_URL?: string;
}

export type SecurityKind = 'stock' | 'index' | 'fund';
export type EodhdStatus = 'unverified' | 'listed' | 'supported' | 'unsupported';

export interface SecurityRow {
  id: number;
  symbol: string;
  code: string | null;
  name: string;
  eodhd_name: string | null;
  kind: SecurityKind;
  exchange: string | null;
  currency: string | null;
  eodhd_status: EodhdStatus;
  status_note: string | null;
  verified_at: string | null;
}
