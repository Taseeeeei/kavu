import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db } from '../db/db';
import { loadHoldings } from '../db/repo';
import { loadSettings, DEFAULT_SETTINGS, type AppSettings } from '../db/settings';
import { toYmd } from '../domain/util';

/** DB変更に追従する保有銘柄ビュー（計算は domain 層） */
export function useHoldings(includeClosed = false) {
  return useLiveQuery(async () => {
    // 依存テーブルを読み取り、変更時に再計算させる
    await Promise.all([db.securities.count(), db.trades.count(), db.prices.count(), db.forecasts.count(), db.settings.count()]);
    return loadHoldings(includeClosed);
  }, [includeClosed]);
}

export function useSettings(): AppSettings {
  return useLiveQuery(() => loadSettings(), []) ?? DEFAULT_SETTINGS;
}

export const useDividends = () => useLiveQuery(() => db.dividends.toArray(), []);
export const useEvents = () => useLiveQuery(() => db.events.toArray(), []);
export const useUnreadCount = () => useLiveQuery(() => db.events.filter((e) => !e.read).count(), []) ?? 0;

export function useToday() {
  const [d, setD] = useState(toYmd(new Date()));
  useEffect(() => {
    const id = setInterval(() => setD(toYmd(new Date())), 60_000);
    return () => clearInterval(id);
  }, []);
  return d;
}

export function useOnline() {
  const [on, setOn] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const a = () => setOn(true), b = () => setOn(false);
    window.addEventListener('online', a); window.addEventListener('offline', b);
    return () => { window.removeEventListener('online', a); window.removeEventListener('offline', b); };
  }, []);
  return on;
}
