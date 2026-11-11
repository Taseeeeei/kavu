import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useHoldings, useDividends, useToday } from '../hooks';
import { byCompany, monthlyTotals, yearlyTotals, totalOf, inYear, inLast12Months, type Basis } from '../../domain/dividends';
import { yen, pct } from '../../domain/format';
import { DIVIDEND_KIND_LABELS, type DividendRecord } from '../../domain/types';
import { Card, Empty, Seg, Stat } from '../components/common';
import { DonutWithLegend, MonthlyBars, TrendLine, RankBars } from '../components/charts';
import { DividendSheet } from '../components/DividendSheet';
import { DividendCalendar } from '../components/DividendCalendar';
import { IPlus } from '../icons';

type Tab = 'list' | 'company' | 'charts' | 'calendar';
type Period = 'all' | 'year' | 'last12';

export default function Dividends() {
  const holdings = useHoldings(true);
  const dividends = useDividends();
  const today = useToday();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>((params.get('tab') as Tab) || 'list');
  const [basis, setBasis] = useState<Basis>('gross');
  const [period, setPeriod] = useState<Period>('all');
  const thisYear = Number(today.slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [sheet, setSheet] = useState<{ record: DividendRecord | null; preset: string | null } | null>(null);
  const [filterYear, setFilterYear] = useState<string>('all');

  useEffect(() => {
    const preset = params.get('new');
    if (preset) { setSheet({ record: null, preset }); params.delete('new'); setParams(params, { replace: true }); }
  }, [params, setParams]);
  useEffect(() => { params.set('tab', tab); setParams(params, { replace: true }); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const years = useMemo(() => Array.from(new Set([thisYear, ...(dividends ?? []).map((d) => Number(d.receivedDate.slice(0, 4)))])).sort((a, b) => b - a), [dividends, thisYear]);
  if (!holdings || !dividends) return <div className="empty">読み込み中…</div>;

  const companyRows = byCompany(dividends, today, basis);
  const forecastBy = new Map(holdings.map((h) => [h.security.id, basis === 'gross' ? h.annualDividend : h.annualDividendNet]));
  const totalForecast = [...forecastBy.values()].reduce((a, b) => a + b, 0);
  const periodRows = companyRows.map((r) => ({ ...r, value: period === 'year' ? r.thisYear : period === 'last12' ? r.last12 : r.cumulative })).filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
  const periodTotal = periodRows.reduce((a, b) => a + b.value, 0);
  const sorted = [...dividends].sort((a, b) => b.receivedDate.localeCompare(a.receivedDate)).filter((d) => filterYear === 'all' || d.receivedDate.startsWith(filterYear));
  const openCompany = (id: string) => nav(`/dividends/company/${encodeURIComponent(id)}`);

  const basisSeg = <Seg value={basis} onChange={setBasis} options={[{ value: 'gross', label: '税引前' }, { value: 'net', label: '税引後' }]} />;
  const periodSeg = <Seg value={period} onChange={setPeriod} options={[{ value: 'all', label: '累計' }, { value: 'year', label: '今年' }, { value: 'last12', label: '12か月' }]} />;

  return (
    <>
      <div className="tabs" role="tablist">
        {([['list', '受取記録'], ['company', '企業別'], ['charts', 'グラフ'], ['calendar', 'カレンダー']] as [Tab, string][]).map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      <div className="row between wrap" style={{ marginBottom: 10, gap: 8 }}>{basisSeg}{(tab === 'company' || tab === 'charts') && periodSeg}</div>

      {tab === 'list' && (
        <>
          <div className="grid3" style={{ marginBottom: 12 }}>
            <div className="card" style={{ margin: 0, padding: 10 }}><Stat label={`${thisYear}年`} value={<span style={{ fontSize: 15 }}>{yen(totalOf(dividends, basis, (r) => inYear(r, thisYear)))}</span>} /></div>
            <div className="card" style={{ margin: 0, padding: 10 }}><Stat label="過去12か月" value={<span style={{ fontSize: 15 }}>{yen(totalOf(dividends, basis, (r) => inLast12Months(r, today)))}</span>} /></div>
            <div className="card" style={{ margin: 0, padding: 10 }}><Stat label="累計" value={<span style={{ fontSize: 15 }}>{yen(totalOf(dividends, basis))}</span>} /></div>
          </div>
          <Card title="受取記録" right={<select value={filterYear} onChange={(e) => setFilterYear(e.target.value)} style={{ width: 'auto', minHeight: 32, padding: '2px 8px', fontSize: 13 }} aria-label="年で絞り込み"><option value="all">すべての年</option>{years.map((y) => <option key={y} value={String(y)}>{y}年</option>)}</select>}>
            {sorted.length === 0 ? <Empty title="配当の受取記録がありません" text="受け取った配当金を記録すると、企業別集計やグラフに反映されます。証券会社の受取データは自動取得できないため、手動入力またはCSVインポートで登録してください。" action={<button className="btn primary" onClick={() => setSheet({ record: null, preset: null })}>配当を記録</button>} /> : (
              <div className="list">
                {sorted.map((d) => (
                  <div key={d.id} className="list-item" onClick={() => setSheet({ record: d, preset: null })}>
                    <div className="grow">
                      <div className="name">{d.name} <span className="code">{d.code}</span></div>
                      <div className="tiny dim">{d.receivedDate}・{DIVIDEND_KIND_LABELS[d.kind]}・{d.shares}株×{d.dps}円</div>
                    </div>
                    <div className="right"><div className="num" style={{ fontWeight: 700 }}>{yen(basis === 'gross' ? d.gross : d.net)}</div><div className="tiny dim num">{basis === 'gross' ? `税引後 ${yen(d.net)}` : `税引前 ${yen(d.gross)}`}</div></div>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <button className="fab" aria-label="配当を記録" onClick={() => setSheet({ record: null, preset: null })}><IPlus /></button>
        </>
      )}

      {tab === 'company' && (
        <>
          <Card title="企業別の配当金">
            {companyRows.length === 0 && totalForecast === 0 ? <Empty title="データがありません" /> : (
              <div className="scroll-x">
                <table className="t">
                  <thead><tr><th>企業</th><th className="r">累計</th><th className="r">今年</th><th className="r">12か月</th><th className="r">年間予想</th><th className="r">割合</th></tr></thead>
                  <tbody>
                    {[...new Set([...companyRows.map((r) => r.securityId), ...holdings.filter((h) => h.annualDividend > 0).map((h) => h.security.id)])].map((id) => {
                      const r = companyRows.find((x) => x.securityId === id);
                      const h = holdings.find((x) => x.security.id === id);
                      const fc = forecastBy.get(id) ?? 0;
                      const pv = r ? (period === 'year' ? r.thisYear : period === 'last12' ? r.last12 : r.cumulative) : 0;
                      return (
                        <tr key={id} onClick={() => openCompany(id)} style={{ cursor: 'pointer' }}>
                          <td><div style={{ fontWeight: 600 }}>{r?.name ?? h?.security.name}</div><span className="code">{r?.code ?? h?.security.code}</span></td>
                          <td className="r">{yen(r?.cumulative ?? 0)}</td><td className="r">{yen(r?.thisYear ?? 0)}</td><td className="r">{yen(r?.last12 ?? 0)}</td>
                          <td className="r">{yen(fc)}<div className="tiny dim">{pct(totalForecast > 0 ? (fc / totalForecast) * 100 : null, 1)}</div></td>
                          <td className="r">{pct(periodTotal > 0 ? (pv / periodTotal) * 100 : null, 1)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="tiny dim" style={{ marginTop: 6 }}>「割合」は選択中の期間（{period === 'all' ? '累計' : period === 'year' ? '今年' : '過去12か月'}）の受取額に占める割合、「年間予想」の下段は年間予想配当金に占める割合です。行をタップで企業別履歴。</div>
              </div>
            )}
          </Card>
          <Card title="年間予想配当金の内訳">
            {totalForecast === 0 ? <Empty title="配当予想が未入力です" /> : (
              <div className="list">{holdings.filter((h) => h.annualDividend > 0).sort((a, b) => b.annualDividend - a.annualDividend).map((h) => {
                const v = basis === 'gross' ? h.annualDividend : h.annualDividendNet;
                return <div key={h.security.id} className="list-item" onClick={() => openCompany(h.security.id)}><span className="grow name">{h.security.name}</span><span className="num">{yen(v)}（{pct((v / totalForecast) * 100, 1)}）</span></div>;
              })}</div>
            )}
          </Card>
        </>
      )}

      {tab === 'charts' && (
        <>
          <Card title="企業別配当金の割合">
            {periodRows.length === 0 ? <Empty title="この期間の受取記録がありません" /> : <DonutWithLegend rows={periodRows.map((r) => ({ id: r.securityId, name: r.name, value: r.value }))} centerLabel={period === 'all' ? '累計' : period === 'year' ? '今年' : '12か月'} onOpen={openCompany} />}
          </Card>
          <Card title="月別の配当金受取額" right={<select value={year} onChange={(e) => setYear(Number(e.target.value))} style={{ width: 'auto', minHeight: 32, padding: '2px 8px', fontSize: 13 }} aria-label="年">{years.map((y) => <option key={y} value={y}>{y}年</option>)}</select>}>
            <MonthlyBars data={monthlyTotals(dividends, year, basis).map((v, i) => ({ label: `${i + 1}月`, v, prev: monthlyTotals(dividends, year - 1, basis)[i] }))} series={[{ key: 'prev', name: `${year - 1}年`, color: '#33508f' }, { key: 'v', name: `${year}年`, color: '#2ed8ff' }]} />
          </Card>
          <Card title="年別の配当金受取額">
            {dividends.length === 0 ? <Empty title="受取記録がありません" /> : <TrendLine data={yearlyTotals(dividends, basis, thisYear).map((r) => ({ label: `${r.year}年`, total: r.total, cumulative: r.cumulative }))} series={[{ key: 'total', name: '年間', color: '#2ed8ff' }, { key: 'cumulative', name: '累計', color: '#8b7bff' }]} />}
          </Card>
          <Card title="企業別の受取額ランキング">
            {periodRows.length === 0 ? <Empty title="この期間の受取記録がありません" /> : <RankBars rows={periodRows.map((r) => ({ id: r.securityId, name: r.name, value: r.value, sub: `${pct(periodTotal > 0 ? (r.value / periodTotal) * 100 : 0, 1)}・${r.count}回` }))} onOpen={openCompany} />}
          </Card>
        </>
      )}

      {tab === 'calendar' && <DividendCalendar holdings={holdings} dividends={dividends} today={today} basis={basis} />}

      <DividendSheet open={!!sheet} onClose={() => setSheet(null)} holdings={holdings} record={sheet?.record} presetSecurityId={sheet?.preset} />
    </>
  );
}
