import { db } from '../db/db';
import { loadSettings, saveSettings } from '../db/settings';
import { BackendClient } from '../data/backend';
import type { DividendChangeEvent } from '../domain/types';

/**
 * データ取得の入口。
 * 株価・配当の取得元は EODHD API（カヴ バックエンド経由）だけ。
 * フェーズ1ではバックエンドへの接続と回数の確認まで。株価・配当の取り込みはフェーズ2・3で実装する。
 */
export interface SyncReport {
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  prices: number;
  forecasts: number;
  newEvents: DividendChangeEvent[];
  historyEvents: number;
  errors: string[];
  skipped: string[];
}

export const PRICE_SYNC_IMPLEMENTED = false;

const log = (level: 'info' | 'warn' | 'error', message: string) => db.syncLogs.add({ at: new Date().toISOString(), level, message });

export function isSyncConfigured(s: { backendUrl: string; backendToken: string }) { return !!s.backendUrl.trim() && !!s.backendToken.trim(); }

let running: Promise<SyncReport> | null = null;

export function syncAll(opts: { onProgress?: (msg: string) => void; reg?: ServiceWorkerRegistration } = {}): Promise<SyncReport> {
  if (running) return running;
  running = doSync(opts).finally(() => { running = null; });
  return running;
}

async function doSync({ onProgress }: { onProgress?: (msg: string) => void; reg?: ServiceWorkerRegistration }): Promise<SyncReport> {
  const s = await loadSettings();
  const report: SyncReport = { ok: true, startedAt: new Date().toISOString(), finishedAt: '', prices: 0, forecasts: 0, newEvents: [], historyEvents: 0, errors: [], skipped: [] };
  if (!isSyncConfigured(s)) {
    report.ok = false;
    report.errors.push('EODHDとの接続が未設定です（設定 → EODHD接続 で登録してください）');
    return report;
  }
  onProgress?.('バックエンドに接続中…');
  try {
    const { usage } = await new BackendClient(s.backendUrl, s.backendToken).status();
    report.skipped.push(`株価・配当の取り込みは未実装です（フェーズ2で対応）。本日のEODHD使用回数 ${usage.used}/${usage.limit}`);
  } catch (e) {
    report.ok = false;
    report.errors.push((e as Error).message);
    await log('error', `バックエンド: ${(e as Error).message}`);
  }
  report.finishedAt = new Date().toISOString();
  await saveSettings({ lastSyncAt: report.finishedAt });
  return report;
}

export async function shouldAutoSync() {
  if (!PRICE_SYNC_IMPLEMENTED) return false;
  const s = await loadSettings();
  if (!isSyncConfigured(s) || s.autoSyncHours <= 0) return false;
  if (!s.lastSyncAt) return true;
  return Date.now() - new Date(s.lastSyncAt).getTime() > s.autoSyncHours * 3600 * 1000;
}
