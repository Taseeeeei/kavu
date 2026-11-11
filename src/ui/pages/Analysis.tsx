import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { useHoldings, useDividends, useToday, useSettings } from '../hooks';
import { summarize } from '../../domain/portfolio';
import { totalOf, inLast12Months } from '../../domain/dividends';
import { yen, pct, signedYen, signedPct, dps, tone } from '../../domain/format';
import { Card, Empty, Stat, Seg } from '../components/common';
import { TrendLine } from '../components/charts';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend, Cell } from 'recharts';

type SortKey = 'yoc' | 'cy' | 'div' | 'pnl';

export default function Analysis() {
  const holdings = useHoldings();
  const dividends = useDividends();
  const snapshots = useLiveQuery(() => db.snapshots.orderBy('date').toArray(), []);
  const today = useToday();
  const settings = useSettings();
  const nav = useNavigate();
  const [sort, setSort] = useState<SortKey>('yoc');
  if (!holdings || !dividends) return <div className="empty">読み込み中…</div>;
  if (holdings.length === 0) return <Card><Empty title="分析できる保有銘柄がありません" text="保有銘柄を登録すると、利回りやポートフォリオの分析が表示されます。" /></Card>;
  const s = summarize(holdings);
  const actual12 = new Map<string, number>();
  for (const h of holdings) actual12.set(h.security.id, totalOf(dividends.filter((d) => d.securityId === h.security.id), 'gross', (r) => inLast12Months(r, today)));
  const key = (h: (typeof holdings)[number]) => sort === 'yoc' ? h.yieldOnCost ?? -1 : sort === 'cy' ? h.currentYield ?? -1 : sort === 'div' ? h.annualDividend : h.unrealizedPnlRate ?? -1e9;
  const rows = [...holdings].sort((a, b) => key(b) - key(a));
  const yieldChart = rows.filter((h) => h.yieldOnCost !== null || h.currentYield !== null).slice(0, 15).map((h) => ({ name: h.security.name.length > 6 ? h.security.name.slice(0, 6) + '…' : h.security.name, yoc: h.yieldOnCost ? Math.round(h.yieldOnCost * 100) / 100 : 0, cy: h.currentYield ? Math.round(h.currentYield * 100) / 100 : 0 }));
  const pnlChart = [...holdings].filter((h) => h.unrealizedPnl !== null).sort((a, b) => (b.unrealizedPnl ?? 0) - (a.unrealizedPnl ?? 0)).map((h) => ({ name: h.security.name.length > 6 ? h.security.name.slice(0, 6) + '…' : h.security.name, pnl: Math.round(h.unrealizedPnl ?? 0) }));
  const ySeries = (snapshots ?? []).filter((x) => x.annualDividend !== undefined && x.cost > 0).map((x) => ({ label: x.date.slice(5), yoc: Math.round(((x.annualDividend ?? 0) / x.cost) * 10000) / 100, cy: x.value > 0 ? Math.round(((x.annualDividend ?? 0) / x.value) * 10000) / 100 : 0 }));
  const upColor = getComputedStyle(document.documentElement).getPropertyValue('--up').trim() || '#1fd39a';
  const downColor = getComputedStyle(document.documentElement).getPropertyValue('--down').trim() || '#ff5d7d';

  return (
    <>
      <Card title="ポートフォリオ全体の利回り" className="hero">
        <div className="grid2">
          <Stat label="取得額ベース利回り" value={<span style={{ fontSize: 24 }}>{pct(s.yieldOnCost)}</span>} sub="年間予想配当金 ÷ 取得総額 × 100" />
          <Stat label="時価ベース利回り" value={<span style={{ fontSize: 24 }}>{pct(s.currentYield)}</span>} sub="年間予想配当金 ÷ 現在評価額 × 100" />
          <Stat label="年間予想配当金（税引前）" value={yen(s.annualDividend)} />
          <Stat label="税引後の年間予想配当金" value={yen(s.annualDividendNet)} sub={`税率 ${(settings.taxRate * 100).toFixed(3)}%（NISAは非課税）`} />
          <Stat label="月平均予想配当金" value={yen(s.monthlyAverageDividend)} sub={`税引後 ${yen(s.monthlyAverageDividendNet)}`} />
          <Stat label="取得総額 / 評価額" value={<span className="small">{yen(s.totalCost)} / {yen(s.marketValue)}</span>} />
        </div>
        {(s.missingPrice > 0 || s.missingForecast > 0) && <div className="notice warn" style={{ marginTop: 10 }}>
          {s.missingPrice > 0 && <>株価未入力{s.missingPrice}銘柄は時価ベース利回り・評価額の計算から除いています。</>}
          {s.missingForecast > 0 && <>配当予想未入力{s.missingForecast}銘柄は予想配当0円として扱っています。</>}
        </div>}
      </Card>

      <Card title="銘柄別の配当利回り">
        <div style={{ marginBottom: 10 }}><Seg value={sort} onChange={setSort} options={[{ value: 'yoc', label: '取得利回り順' }, { value: 'cy', label: '時価利回り順' }, { value: 'div', label: '配当額順' }, { value: 'pnl', label: '損益順' }]} /></div>
        <div className="scroll-x">
          <table className="t">
            <thead><tr><th>銘柄</th><th className="r">1株予想</th><th className="r">年間予想</th><th className="r">取得利回り</th><th className="r">時価利回り</th><th className="r">12か月実績</th><th className="r">含み損益</th></tr></thead>
            <tbody>
              {rows.map((h) => (
                <tr key={h.security.id} onClick={() => nav(`/holdings/${encodeURIComponent(h.security.id)}`)} style={{ cursor: 'pointer' }}>
                  <td><div style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{h.security.name}</div><span className="code">{h.security.code}</span></td>
                  <td className="r">{h.forecast ? dps(h.annualDps) : '—'}</td>
                  <td className="r">{yen(h.annualDividend)}</td>
                  <td className="r" style={{ color: 'var(--accent)' }}>{pct(h.yieldOnCost)}</td>
                  <td className="r">{pct(h.currentYield)}</td>
                  <td className="r">{yen(actual12.get(h.security.id) ?? 0)}</td>
                  <td className={`r ${tone(h.unrealizedPnl)}`}>{signedYen(h.unrealizedPnl)}<div className="tiny">{signedPct(h.unrealizedPnlRate)}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="tiny dim" style={{ marginTop: 6 }}>保有株数・取得単価・株価・配当予想が変わると自動で再計算されます。行をタップで銘柄詳細（利回り推移）へ。</div>
      </Card>

      <Card title="取得利回りと時価利回りの比較">
        {yieldChart.length === 0 ? <Empty title="配当予想が入力された銘柄がありません" /> : (
          <div style={{ height: Math.max(200, yieldChart.length * 34) }}>
            <ResponsiveContainer>
              <BarChart data={yieldChart} layout="vertical" margin={{ left: 8, right: 12 }}>
                <CartesianGrid horizontal={false} stroke="#1d3263" strokeDasharray="3 4" />
                <XAxis type="number" stroke="#5f729e" fontSize={11} tickFormatter={(v) => `${v}%`} />
                <YAxis type="category" dataKey="name" stroke="#5f729e" fontSize={11} width={80} />
                <Tooltip formatter={(v: number) => `${v.toFixed(2)}%`} contentStyle={{ background: '#0b1730', border: '1px solid #3d7dff', borderRadius: 10 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="yoc" name="取得利回り" fill="#2ed8ff" radius={[0, 4, 4, 0]} />
                <Bar dataKey="cy" name="時価利回り" fill="#3d7dff" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <Card title="銘柄別の含み損益">
        {pnlChart.length === 0 ? <Empty title="株価が入力された銘柄がありません" /> : (
          <div style={{ height: Math.max(200, pnlChart.length * 30) }}>
            <ResponsiveContainer>
              <BarChart data={pnlChart} layout="vertical" margin={{ left: 8, right: 12 }}>
                <CartesianGrid horizontal={false} stroke="#1d3263" strokeDasharray="3 4" />
                <XAxis type="number" stroke="#5f729e" fontSize={11} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                <YAxis type="category" dataKey="name" stroke="#5f729e" fontSize={11} width={80} />
                <Tooltip formatter={(v: number) => signedYen(v)} contentStyle={{ background: '#0b1730', border: '1px solid #3d7dff', borderRadius: 10 }} />
                <Bar dataKey="pnl" name="含み損益">{pnlChart.map((r) => <Cell key={r.name} fill={r.pnl >= 0 ? upColor : downColor} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <Card title="ポートフォリオ利回りの推移" right={<span className="tiny dim">1日1回記録</span>}>
        {ySeries.length < 2 ? <Empty title="推移データを蓄積中です" text="毎日の取得総額・評価額・年間予想配当を記録し、2日分以上で表示します。" /> :
          <TrendLine data={ySeries} series={[{ key: 'yoc', name: '取得利回り', color: '#2ed8ff' }, { key: 'cy', name: '時価利回り', color: '#3d7dff' }]} valueFmt={(v) => `${v.toFixed(2)}%`} />}
      </Card>
    </>
  );
}
