import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { useHoldings, useToday } from '../hooks';
import { totalOf, inYear, inLast12Months, yearlyTotals, type Basis } from '../../domain/dividends';
import { yen, dps } from '../../domain/format';
import { DIVIDEND_KIND_LABELS, type DividendRecord } from '../../domain/types';
import { Card, Empty, Seg, Stat } from '../components/common';
import { TrendLine } from '../components/charts';
import { DividendSheet } from '../components/DividendSheet';

export default function CompanyDividends() {
  const { id = '' } = useParams();
  const sid = decodeURIComponent(id);
  const today = useToday();
  const holdings = useHoldings(true);
  const recs = useLiveQuery(() => db.dividends.where('securityId').equals(sid).toArray(), [sid]);
  const [basis, setBasis] = useState<Basis>('gross');
  const [edit, setEdit] = useState<DividendRecord | null | undefined>(undefined);
  if (!recs || !holdings) return <div className="empty">読み込み中…</div>;
  const h = holdings.find((x) => x.security.id === sid);
  const name = h?.security.name ?? recs[0]?.name ?? sid;
  const year = Number(today.slice(0, 4));
  const sorted = [...recs].sort((a, b) => b.receivedDate.localeCompare(a.receivedDate));
  const yearly = yearlyTotals(recs, basis, year).map((r) => ({ label: `${r.year}`, total: r.total }));
  return (
    <>
      <Card className="hero">
        <div className="row between"><div><div style={{ fontSize: 18, fontWeight: 800 }}>{name}</div><span className="code">{h?.security.code ?? recs[0]?.code}</span></div>{h && <Link className="btn small" to={`/holdings/${encodeURIComponent(sid)}`}>銘柄詳細</Link>}</div>
        <div className="divider" />
        <div className="row between" style={{ marginBottom: 8 }}><span className="small muted">集計</span><Seg value={basis} onChange={setBasis} options={[{ value: 'gross', label: '税引前' }, { value: 'net', label: '税引後' }]} /></div>
        <div className="grid2">
          <Stat label="累計受取額" value={yen(totalOf(recs, basis))} />
          <Stat label={`${year}年`} value={yen(totalOf(recs, basis, (r) => inYear(r, year)))} />
          <Stat label="過去12か月" value={yen(totalOf(recs, basis, (r) => inLast12Months(r, today)))} />
          <Stat label="年間予想配当金" value={yen(h ? (basis === 'gross' ? h.annualDividend : h.annualDividendNet) : 0)} sub={h ? `1株 ${dps(h.annualDps)}` : undefined} />
        </div>
      </Card>
      <Card title="年別の受取額">{yearly.length === 0 ? <Empty title="受取記録がありません" /> : <TrendLine data={yearly} series={[{ key: 'total', name: '受取額', color: '#2ed8ff' }]} height={180} />}</Card>
      <Card title="配当履歴" right={h && <button className="btn small" onClick={() => setEdit(null)}>＋記録</button>}>
        {sorted.length === 0 ? <Empty title="受取記録がありません" /> : (
          <div className="scroll-x"><table className="t">
            <thead><tr><th>受取日</th><th>区分</th><th className="r">1株</th><th className="r">株数</th><th className="r">税引前</th><th className="r">税金</th><th className="r">税引後</th></tr></thead>
            <tbody>{sorted.map((d) => <tr key={d.id} onClick={() => setEdit(d)} style={{ cursor: 'pointer' }}><td>{d.receivedDate}</td><td className="tiny">{DIVIDEND_KIND_LABELS[d.kind]}</td><td className="r">{d.dps}</td><td className="r">{d.shares}</td><td className="r">{yen(d.gross)}</td><td className="r">{yen(d.tax)}</td><td className="r">{yen(d.net)}</td></tr>)}</tbody>
          </table></div>
        )}
      </Card>
      <DividendSheet open={edit !== undefined} onClose={() => setEdit(undefined)} holdings={holdings} record={edit ?? null} presetSecurityId={sid} />
    </>
  );
}
