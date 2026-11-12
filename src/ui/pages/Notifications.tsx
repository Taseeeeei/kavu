import { useState } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../../db/db';
import { useEvents } from '../hooks';
import { CHANGE_KIND_LABELS, SOURCE_LABELS, type DividendChangeEvent } from '../../domain/types';
import { dps, signedYen, signedPct, dateTime, num } from '../../domain/format';
import { Card, Empty, Seg, useConfirm } from '../components/common';

const ORIGIN = { auto: '自動検知', history: '過去の開示から取込', manual: '手動入力による変更' } as const;
type Filter = 'all' | 'unread' | 'up' | 'down';

export default function Notifications() {
  const events = useEvents();
  const [filter, setFilter] = useState<Filter>('all');
  const confirm = useConfirm();
  if (!events) return <div className="empty">読み込み中…</div>;
  const list = [...events].sort((a, b) => (b.disclosureDate === a.disclosureDate ? b.detectedAt.localeCompare(a.detectedAt) : b.disclosureDate.localeCompare(a.disclosureDate)))
    .filter((e) => filter === 'all' || (filter === 'unread' ? !e.read : filter === 'up' ? e.kind === 'increase' || e.kind === 'resume' : e.kind === 'decrease' || e.kind === 'suspend'));
  const unread = events.filter((e) => !e.read).length;
  const markAll = async () => { await db.events.bulkUpdate(events.filter((e) => !e.read).map((e) => ({ key: e.id, changes: { read: true } }))); };
  const remove = async (e: DividendChangeEvent) => {
    if (await confirm({ title: '通知を削除', message: `${e.name} の${CHANGE_KIND_LABELS[e.kind]}の記録を削除します。`, okLabel: '削除', danger: true })) await db.events.delete(e.id);
  };
  return (
    <>
      <div className="row between wrap" style={{ marginBottom: 10, gap: 8 }}>
        <Seg value={filter} onChange={setFilter} options={[{ value: 'all', label: 'すべて' }, { value: 'unread', label: `未確認${unread ? `(${unread})` : ''}` }, { value: 'up', label: '増配' }, { value: 'down', label: '減配・無配' }]} />
        {unread > 0 && <button className="btn small" onClick={markAll}>すべて確認済みにする</button>}
      </div>
      {list.length === 0 ? (
        <Card><Empty title="増配・減配の記録はありません" text={<>EODHDの配当履歴による増配・減配の検知は準備中です。手動で配当予想を更新した場合は記録されます。<br />確認できていない変更は表示しません。</>} action={<Link className="btn" to="/settings#data-source">EODHD接続を見る</Link>} /></Card>
      ) : list.map((e) => (
        <div key={e.id} className={`event ${e.kind} ${e.read ? '' : 'unread'}`} onClick={() => !e.read && db.events.update(e.id, { read: true })}>
          <div className="row between">
            <div className="row" style={{ gap: 6 }}>
              <span className={`pill ${e.kind === 'increase' || e.kind === 'resume' ? 'up' : 'down'}`}>{CHANGE_KIND_LABELS[e.kind]}</span>
              {!e.read && <span className="pill">未確認</span>}
            </div>
            <span className="tiny dim">{ORIGIN[e.origin]}</span>
          </div>
          <div style={{ fontWeight: 700, margin: '6px 0 4px' }}><Link to={`/holdings/${encodeURIComponent(e.securityId)}`}>{e.name}</Link> <span className="code">{e.code}</span></div>
          <dl className="kv">
            <dt>変更前の年間配当</dt><dd className="num">{dps(e.before)}</dd>
            <dt>変更後の年間配当</dt><dd className="num">{dps(e.after)}</dd>
            <dt>1株あたり{e.diffPerShare >= 0 ? '増配' : '減配'}額</dt><dd className={`num ${e.diffPerShare >= 0 ? 'up' : 'down'}`}>{signedYen(e.diffPerShare).replace('円', '')}円</dd>
            <dt>{e.diffPerShare >= 0 ? '増配率' : '減配率'}</dt><dd className={`num ${e.diffPerShare >= 0 ? 'up' : 'down'}`}>{e.rate === null ? '—（前回0円）' : signedPct(e.rate, 1)}</dd>
            <dt>保有株数（検知時）</dt><dd className="num">{num(e.sharesHeld)}株</dd>
            <dt>年間配当金の{e.annualImpact >= 0 ? '増加' : '減少'}額</dt><dd className={`num ${e.annualImpact >= 0 ? 'up' : 'down'}`} style={{ fontWeight: 800 }}>{signedYen(e.annualImpact)}</dd>
          </dl>
          <div className="divider" style={{ margin: '8px 0' }} />
          <div className="tiny dim">比較基準：{e.basis}</div>
          <div className="tiny dim">開示日・確認日：{e.disclosureDate}／記録日時：{dateTime(e.detectedAt)}</div>
          <div className="tiny dim">情報源：{SOURCE_LABELS[e.source]}{e.sourceDetail ? `（${e.sourceDetail}）` : ''}</div>
          {e.origin === 'manual' && <div className="row" style={{ justifyContent: 'flex-end', marginTop: 4 }}><button className="btn small ghost" onClick={(ev) => { ev.stopPropagation(); remove(e); }}>削除</button></div>}
        </div>
      ))}
    </>
  );
}
