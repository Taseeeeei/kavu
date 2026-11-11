import Dexie, { type Table } from 'dexie';
import type {
  DividendChangeEvent, DividendForecast, DividendRecord, PortfolioSnapshot, PriceQuote, Security, Trade,
} from '../domain/types';

export interface SettingRow { key: string; value: unknown }
export interface LocalBackup { id?: number; createdAt: string; reason: string; json: string }
export interface SyncLog { id?: number; at: string; level: 'info' | 'warn' | 'error'; message: string }

export class KavDB extends Dexie {
  securities!: Table<Security, string>;
  trades!: Table<Trade, string>;
  prices!: Table<PriceQuote, string>;
  forecasts!: Table<DividendForecast, string>;
  dividends!: Table<DividendRecord, string>;
  events!: Table<DividendChangeEvent, string>;
  snapshots!: Table<PortfolioSnapshot, string>;
  settings!: Table<SettingRow, string>;
  backups!: Table<LocalBackup, number>;
  syncLogs!: Table<SyncLog, number>;

  constructor(name = 'kav') {
    super(name);
    this.version(1).stores({
      securities: 'id, code, country, deletedAt',
      trades: 'id, securityId, date',
      prices: 'id, securityId, asOf',
      forecasts: 'id, securityId, asOf',
      dividends: 'id, securityId, receivedDate',
      events: 'id, securityId, disclosureDate',
      snapshots: 'date',
      settings: 'key',
      backups: '++id, createdAt',
      syncLogs: '++id, at',
    });
  }
}

export const db = new KavDB();

/** ブラウザに永続ストレージを要求（自動削除の防止） */
export async function requestPersistence(): Promise<boolean | null> {
  try {
    if (navigator.storage?.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch { /* noop */ }
  return null;
}
