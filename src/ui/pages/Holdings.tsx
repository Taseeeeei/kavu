import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useHoldings } from '../hooks';
import { yen, signedPct, pct, num, tone } from '../../domain/format';
import { Card, Empty, Seg } from '../components/common';
import { IPlus } from '../icons';
import { MARKET_LABELS } from '../../domain/types';
import { summarize } from '../../domain/portfolio';

type SortKey = 'value' | 'pnl' | 'yield' | 'dividend' | 'code';

export default function Holdings() {
  const [showClosed, setShowClosed] = useState(false);
  const holdings = useHoldings(showClosed);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('value');
  const nav = useNavigate();
  const rows = useMemo(() => {
    if (!holdings) return [];
    const k = q.trim().toLowerCase();
    const f = holdings.filter((h) => !k || h.security.name.toLowerCase().includes(k) || h.security.code.toLowerCase().includes(k));
    const v = (h: (typeof f)[number]) =>
      sort === 'value' ? (h.marketValue ?? h.position.costBasis) : sort === 'pnl' ? (h.unrealizedPnlRate ?? -Infinity) : sort === 'yield' ? (h.yieldOnCost ?? -Infinity) : sort === 'dividend' ? h.annualDividend : 0;
    return [...f].sort((a, b) => (sort === 'code' ? a.security.code.localeCompare(b.security.code) : v(b) - v(a)));
  }, [holdings, q, sort]);
  if (!holdings) return <div className="empty">読み込み中…</div>;
  const s = summarize(holdings);

  return (
    <>
      <div className="grid3" style={{ marginBottom: 12 }}>
        <div className="card" style={{ margin: 0, padding: 10 }}><div className="stat-label">銘柄数</div><div className="stat-value">{s.holdingCount}</div></div>
        <div className="card" style={{ margin: 0, padding: 10 }}><div className="stat-label">取得総額</div><div className="stat-value" style={{ fontSize: 15 }}>{yen(s.totalCost)}</div></div>
        <div className="card" style={{ margin: 0, padding: 10 }}><div className="stat-label">年間予想配当</div><div className="stat-value" style={{ fontSize: 15 }}>{yen(s.annualDividend)}</div></div>
      </div>
      <div className="search"><input type="search" placeholder="企業名・銘柄コードで検索" value={q} onChange={(e) => setQ(e.target.value)} aria-label="検索" /></div>
      <div className="row wrap" style={{ marginBottom: 10, gap: 8 }}>
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} style={{ width: 'auto', minHeight: 36, padding: '4px 10px', fontSize: 14 }} aria-label="並び替え">
          <option value="value">評価額順</option><option value="pnl">損益率順</option><option value="yield">取得利回り順</option><option value="dividend">予想配当順</option><option value="code">コード順</option>
        </select>
        <span className="grow" />
        <Seg value={showClosed ? 'all' : 'open'} onChange={(v) => setShowClosed(v === 'all')} options={[{ value: 'open', label: '保有中' }, { value: 'all', label: '売却済みも' }]} />
      </div>
      <Card>
        {rows.length === 0 ? (
          <Empty title={q ? '該当する銘柄がありません' : '保有銘柄がまだありません'} text={q ? undefined : '右下の＋から保有株を登録しましょう。CSVでの一括登録は設定画面から行えます。'}
            action={!q && <Link to="/holdings/new" className="btn primary">保有株を登録</Link>} />
        ) : (
          <div className="list">
            {rows.map((h) => (
              <div key={h.security.id} className="list-item" onClick={() => nav(`/holdings/${encodeURIComponent(h.security.id)}`)}>
                <div className="grow">
                  <div className="row" style={{ gap: 6 }}><span className="name">{h.security.name}</span>{h.security.account === 'nisa' && <span className="pill gray">NISA</span>}</div>
                  <div className="tiny dim row" style={{ gap: 6 }}>
                    <span className="code">{h.security.code}</span>{MARKET_LABELS[h.security.market]}・{num(h.position.quantity)}株
                    {h.position.quantity === 0 && <span className="pill gray">売却済み</span>}
                  </div>
                  <div className="tiny muted" style={{ marginTop: 2 }}>
                    利回り 取得{pct(h.yieldOnCost)} / 時価{pct(h.currentYield)}・年{yen(h.annualDividend)}
                  </div>
                </div>
                <div className="right">
                  <div className="num" style={{ fontWeight: 700 }}>{h.marketValue !== null ? yen(h.marketValue) : <span className="warn small">株価未入力</span>}</div>
                  <div className={`num small ${tone(h.unrealizedPnl)}`}>{signedPct(h.unrealizedPnlRate)}</div>
                  {h.dayChangeRate !== null && <div className={`num tiny ${tone(h.dayChange)}`}>前日比 {signedPct(h.dayChangeRate)}</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
      <button className="fab" aria-label="銘柄を登録" onClick={() => nav('/holdings/new')}><IPlus /></button>
    </>
  );
}
