import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { useHoldings, useDividends, useEvents, useToday, useSettings } from '../hooks';
import { summarize, allocation, forecastDividendShare, expectedMonthly } from '../../domain/portfolio';
import { totalOf, inLast12Months, inYear, monthlyTotals, yearlyTotals, yearOverYear, cumulativeSeries, type Basis } from '../../domain/dividends';
import { yen, signedYen, pct, signedPct, num, dateTime } from '../../domain/format';
import { Card, Stat, Empty, Seg } from '../components/common';
import { DonutWithLegend, MonthlyBars, TrendLine } from '../components/charts';
import { SyncBar } from '../components/SyncBar';
import { CHANGE_KIND_LABELS } from '../../domain/types';

export default function Home() {
  const holdings = useHoldings();
  const dividends = useDividends();
  const events = useEvents();
  const snapshots = useLiveQuery(() => db.snapshots.orderBy('date').toArray(), []);
  const today = useToday();
  const settings = useSettings();
  const nav = useNavigate();
  const [basis, setBasis] = useState<Basis>('gross');
  const year = Number(today.slice(0, 4));

  const s = useMemo(() => (holdings ? summarize(holdings) : null), [holdings]);
  if (!holdings || !dividends || !s) return <div className="empty">読み込み中…</div>;

  const noData = holdings.length === 0 && dividends.length === 0;
  if (noData) {
    return (
      <>
        <Card className="hero">
          <Empty title="カヴへようこそ" text={<>保有株と受け取った配当金を登録すると、ここに資産状況・配当利回り・増配/減配の情報がまとまって表示されます。<br />データはこの端末内（IndexedDB）に保存され、オフラインでも閲覧できます。</>}
            action={<div className="grid2"><Link className="btn primary" to="/holdings/new">保有株を登録</Link><Link className="btn" to="/settings#data">CSV・バックアップから取り込む</Link></div>} />
        </Card>
        <div className="notice">株価や配当予想を自動で取得するには、設定でJ-Quants API用のプロキシを登録してください。未設定でも手動入力で全機能を使えます。</div>
      </>
    );
  }

  const thisYear = totalOf(dividends, basis, (r) => inYear(r, year));
  const last12 = totalOf(dividends, basis, (r) => inLast12Months(r, today));
  const cumulative = totalOf(dividends, basis);
  const yoy = yearOverYear(dividends, today, basis);
  const actualM = monthlyTotals(dividends, year, basis);
  const expM = expectedMonthly(holdings, basis === 'net');
  const monthData = actualM.map((v, i) => ({ label: `${i + 1}月`, actual: v, expected: Math.round(expM[i]) }));
  const yearly = yearlyTotals(dividends, basis, year).map((r) => ({ label: `${r.year}`, total: r.total }));
  const cum = cumulativeSeries(dividends, basis).map((r) => ({ label: r.date, cumulative: r.cumulative }));
  const unread = (events ?? []).filter((e) => !e.read).sort((a, b) => b.detectedAt.localeCompare(a.detectedAt));
  const alloc = allocation(holdings);
  const divShare = forecastDividendShare(holdings, basis === 'net');
  const pnlSeries = (snapshots ?? []).map((x) => ({ label: x.date.slice(5), pnl: Math.round(x.value - x.cost), value: Math.round(x.value) }));
  const latestPriceAt = holdings.map((h) => h.price?.fetchedAt).filter(Boolean).sort().at(-1);

  return (
    <>
      <SyncBar />
      {unread.length > 0 && (
        <Link to="/notifications" className="card" style={{ display: 'block', borderColor: 'var(--accent)' }}>
          <div className="row between"><strong>未確認の配当変更 {unread.length}件</strong><span className="small">確認する ›</span></div>
          {unread.slice(0, 3).map((e) => (
            <div key={e.id} className="small" style={{ marginTop: 4 }}>
              <span className={`pill ${e.kind === 'increase' || e.kind === 'resume' ? 'up' : 'down'}`}>{CHANGE_KIND_LABELS[e.kind]}</span> {e.name}　年間 <span className={e.annualImpact >= 0 ? 'up' : 'down'}>{signedYen(e.annualImpact)}</span>
            </div>
          ))}
        </Link>
      )}

      <Card className="hero">
        <div className="stat-label">現在の評価額</div>
        <div className="big num">{s.pricedCount > 0 ? yen(s.marketValue) : '—'}</div>
        <div className={`num ${s.unrealizedPnl > 0 ? 'up' : s.unrealizedPnl < 0 ? 'down' : 'flat'}`} style={{ fontWeight: 700 }}>
          {s.pricedCount > 0 ? <>含み損益 {signedYen(s.unrealizedPnl)}（{signedPct(s.unrealizedPnlRate)}）</> : '株価が未入力です'}
        </div>
        <div className="divider" />
        <div className="grid3">
          <Stat label="保有銘柄数" value={`${s.holdingCount}銘柄`} />
          <Stat label="取得総額" value={yen(s.totalCost)} />
          <Stat label="株価更新" value={<span className="small">{latestPriceAt ? dateTime(latestPriceAt).slice(5) : '—'}</span>} />
        </div>
        {s.missingPrice > 0 && <div className="notice warn" style={{ marginTop: 10 }}>株価未入力が{s.missingPrice}銘柄あります。評価額・含み損益・時価利回りは株価のある{s.pricedCount}銘柄で計算しています。</div>}
      </Card>

      <div className="row between" style={{ margin: '4px 2px 10px' }}>
        <span className="section-title" style={{ margin: 0 }}>配当</span>
        <Seg value={basis} onChange={setBasis} options={[{ value: 'gross', label: '税引前' }, { value: 'net', label: '税引後' }]} />
      </div>

      <div className="grid-md-2">
        <Card title="年間予想配当金">
          <div className="grid2">
            <Stat label="税引前" value={yen(s.annualDividend)} />
            <Stat label="税引後（推定）" value={yen(s.annualDividendNet)} sub={`税率${(settings.taxRate * 100).toFixed(3)}%・NISA非課税`} />
            <Stat label="取得額ベース利回り" value={pct(s.yieldOnCost)} />
            <Stat label="時価ベース利回り" value={pct(s.currentYield)} />
            <Stat label="月平均（税引前）" value={yen(s.monthlyAverageDividend)} />
            <Stat label="月平均（税引後）" value={yen(s.monthlyAverageDividendNet)} />
          </div>
          {s.missingForecast > 0 && <div className="notice warn" style={{ marginTop: 10 }}>配当予想が未入力の銘柄が{s.missingForecast}件あり、合計に含まれていません。</div>}
        </Card>
        <Card title={`受取配当金（${basis === 'gross' ? '税引前' : '税引後'}）`}>
          <div className="grid2">
            <Stat label={`${year}年の受取合計`} value={yen(thisYear)} />
            <Stat label="過去12か月" value={yen(last12)} />
            <Stat label="前年同期比" value={signedYen(yoy.diff)} toneOf={yoy.diff} sub={`前年同期 ${yen(yoy.lastYtd)}（${signedPct(yoy.rate, 1)}）`} />
            <Stat label="累計受取額" value={yen(cumulative)} sub={`${num(dividends.length)}件の記録`} />
          </div>
        </Card>
      </div>

      <Card title={`月別配当金（${year}年）`} right={<span className="tiny dim">棒をタップで詳細</span>}>
        {dividends.length === 0 && s.annualDividend === 0 ? <Empty title="配当データがありません" text="配当金の受取記録か、銘柄の配当予想・支払月を登録してください。" /> :
          <MonthlyBars data={monthData} series={[{ key: 'actual', name: '受取実績', color: '#2ed8ff' }, { key: 'expected', name: '予想（支払月で按分）', color: '#3d7dff' }]} />}
      </Card>

      <div className="grid-md-2">
        <Card title="保有銘柄別の資産構成">
          {alloc.length === 0 ? <Empty title="保有銘柄がありません" /> : (
            <>
              <DonutWithLegend rows={alloc.map((a) => ({ id: a.id, name: a.name, value: a.value, sub: a.estimated ? '取得額' : undefined }))} centerLabel="合計" onOpen={(id) => nav(`/holdings/${encodeURIComponent(id)}`)} />
              {alloc.some((a) => a.estimated) && <div className="tiny dim" style={{ marginTop: 6 }}>※株価未入力の銘柄は取得額で表示しています</div>}
            </>
          )}
        </Card>
        <Card title="企業別の年間予想配当金">
          {divShare.length === 0 ? <Empty title="配当予想がありません" text="銘柄詳細で1株あたり年間配当を入力すると表示されます。" /> :
            <DonutWithLegend rows={divShare} centerLabel="年間予想" onOpen={(id) => nav(`/holdings/${encodeURIComponent(id)}`)} />}
        </Card>
      </div>

      <div className="grid-md-2">
        <Card title="年別の配当金推移">
          {yearly.length === 0 ? <Empty title="受取記録がありません" /> : <TrendLine data={yearly} series={[{ key: 'total', name: '年間受取額', color: '#2ed8ff' }]} />}
        </Card>
        <Card title="配当金の累計推移">
          {cum.length === 0 ? <Empty title="受取記録がありません" /> : <TrendLine data={cum} area series={[{ key: 'cumulative', name: '累計', color: '#3d7dff' }]} />}
        </Card>
      </div>

      <Card title="含み損益の推移" right={<span className="tiny dim">1日1回記録</span>}>
        {pnlSeries.length < 2 ? <Empty title="推移データを蓄積中です" text="アプリを開いた日・株価を更新した日の評価額と含み損益を記録しています。2日分以上たまるとグラフになります。" /> :
          <TrendLine data={pnlSeries} series={[{ key: 'pnl', name: '含み損益', color: '#1fd39a' }]} />}
      </Card>
    </>
  );
}
