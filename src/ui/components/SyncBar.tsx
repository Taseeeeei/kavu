import { Link } from 'react-router-dom';
import { useSettings } from '../hooks';
import { isSyncConfigured, PRICE_SYNC_IMPLEMENTED } from '../../services/sync';

/** データ取得の状態。実装済みの機能と未実装の機能を区別して表示する */
export function SyncBar() {
  const s = useSettings();
  if (!isSyncConfigured(s)) {
    return (
      <div className="sync-bar">
        <span className="pill gray">EODHD：未接続</span>
        <span>表示中の株価・配当予想は手動入力などで登録した値です。</span>
        <Link to="/settings#data-source">接続する</Link>
      </div>
    );
  }
  return (
    <div className="sync-bar">
      <span className="pill">EODHD接続済み</span>
      <span>{PRICE_SYNC_IMPLEMENTED ? '' : '株価・配当の自動取り込みは準備中です（次の段階で対応）。表示中の値は手動入力などで登録したものです。'}</span>
      <span className="grow" />
      <Link to="/settings#data-source">状態を見る</Link>
    </div>
  );
}
