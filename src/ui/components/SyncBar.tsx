import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSettings, useOnline } from '../hooks';
import { syncAll, isSyncConfigured } from '../../services/sync';
import { dateTime } from '../../domain/format';
import { useToast } from './common';
import { IRefresh } from '../icons';

export function SyncBar() {
  const s = useSettings();
  const online = useOnline();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  if (!isSyncConfigured(s)) {
    return (
      <div className="sync-bar">
        <span className="pill gray">自動取得：未設定</span>
        <span>株価・配当予想は手動入力の値を表示しています。</span>
        <Link to="/settings#data-source">設定する</Link>
      </div>
    );
  }
  const run = async () => {
    setBusy('開始中…');
    const r = await syncAll({ onProgress: setBusy });
    setBusy(null);
    toast(r.ok ? `更新完了：株価${r.prices}件・配当予想${r.forecasts}件・新しい増減配${r.newEvents.length}件` : `一部取得できませんでした：${r.errors[0] ?? ''}`);
  };
  return (
    <div className="sync-bar">
      <span className="pill">J-Quants</span>
      <span>最終取得 {dateTime(s.lastSyncAt)}</span>
      <span className="grow" />
      <button className="btn small" onClick={run} disabled={!!busy || !online}><IRefresh width={16} height={16} />{busy ?? (online ? '今すぐ更新' : 'オフライン')}</button>
    </div>
  );
}
