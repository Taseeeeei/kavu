import { db } from './db';
import { DEFAULT_TAX_RATE } from '../domain/tax';

export interface AppSettings {
  taxRate: number;
  colorScheme: 'global' | 'japan'; // global: 上昇=緑 / japan: 上昇=赤
  /** カヴ バックエンド（Cloudflare Worker）のURL */
  backendUrl: string;
  /** バックエンドの合言葉（APP_TOKEN）。EODHDのAPIキーではない。バックアップには含めない */
  backendToken: string;
  autoSyncHours: number; // 0 = 自動同期しない
  lastSyncAt: string | null;
  notifyEnabled: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  taxRate: DEFAULT_TAX_RATE,
  colorScheme: 'global',
  backendUrl: '',
  backendToken: '',
  autoSyncHours: 12,
  lastSyncAt: null,
  notifyEnabled: false,
};

export async function loadSettings(): Promise<AppSettings> {
  const rows = await db.settings.toArray();
  const s: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) if (r.key in DEFAULT_SETTINGS) s[r.key] = r.value;
  return s as unknown as AppSettings;
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<void> {
  await db.settings.bulkPut(Object.entries(patch).map(([key, value]) => ({ key, value })));
}
