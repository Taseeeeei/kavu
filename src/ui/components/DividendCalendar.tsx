import { useMemo, useState } from 'react';
import type { HoldingView } from '../../domain/portfolio';
import type { DividendRecord } from '../../domain/types';
import { rightsDatesForMonth, isTseHoliday } from '../../domain/jpCalendar';
import { toYmd } from '../../domain/util';
import { yen } from '../../domain/format';
import { Card } from './common';
import { MonthlyBars } from './charts';

type Ev = { date: string; type: 'rec' | 'last' | 'ex' | 'got'; name: string; amount?: number };
const TYPE_LABEL = { rec: '権利確定日', last: '権利付き最終日', ex: '権利落ち日', got: '配当受取' } as const;

export function DividendCalendar({ holdings, dividends, today, basis }: { holdings: HoldingView[]; dividends: DividendRecord[]; today: string; basis: 'gross' | 'net' }) {
  const [ym, setYm] = useState(() => ({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) }));
  const [sel, setSel] = useState<string | null>(today);
  const active = holdings.filter((h) => h.position.quantity > 0);

  const { events, payPlans } = useMemo(() => {
    const evs: Ev[] = [];
    for (const h of active) {
      if (h.security.country !== 'JP') continue;
      for (const m of h.security.recordMonths) {
        if (m !== ym.m) continue;
        const r = rightsDatesForMonth(ym.y, m);
        evs.push({ date: r.lastCumDate, type: 'last', name: h.security.name }, { date: r.exDate, type: 'ex', name: h.security.name }, { date: r.recordDate, type: 'rec', name: h.security.name });
      }
    }
    for (const d of dividends) if (d.receivedDate.startsWith(`${ym.y}-${String(ym.m).padStart(2, '0')}`)) evs.push({ date: d.receivedDate, type: 'got', name: d.name, amount: basis === 'gross' ? d.gross : d.net });
    const plans = active.filter((h) => h.security.payMonths.includes(ym.m) && h.annualDividend > 0).map((h) => ({
      name: h.security.name, amount: (basis === 'gross' ? h.annualDividend : h.annualDividendNet) / h.security.payMonths.length,
    }));
    return { events: evs, payPlans: plans };
  }, [active, dividends, ym, basis]);

  const first = new Date(ym.y, ym.m - 1, 1);
  const start = new Date(first); start.setDate(1 - first.getDay());
  const cells = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  const byDate = new Map<string, Ev[]>();
  for (const e of events) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);
  const move = (n: number) => { const d = new Date(ym.y, ym.m - 1 + n, 1); setYm({ y: d.getFullYear(), m: d.getMonth() + 1 }); setSel(null); };
  const expectedTotal = payPlans.reduce((a, b) => a + b.amount, 0);
  const actualTotal = events.filter((e) => e.type === 'got').reduce((a, b) => a + (b.amount ?? 0), 0);

  // 年間の予想と実績
  const yearRows = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    const exp = active.filter((h) => h.security.payMonths.includes(m)).reduce((a, h) => a + (basis === 'gross' ? h.annualDividend : h.annualDividendNet) / h.security.payMonths.length, 0);
    const act = dividends.filter((d) => d.receivedDate.startsWith(`${ym.y}-${String(m).padStart(2, '0')}`)).reduce((a, d) => a + (basis === 'gross' ? d.gross : d.net), 0);
    const names = active.filter((h) => h.security.payMonths.includes(m) && h.annualDividend > 0).map((h) => h.security.name);
    return { label: `${m}月`, expected: Math.round(exp), actual: act, names };
  });
  const selEvents = sel ? byDate.get(sel) ?? [] : [];

  return (
    <>
      <Card title={<span>{ym.y}年{ym.m}月</span>} right={<div className="row" style={{ gap: 6 }}><button className="btn small" onClick={() => move(-1)} aria-label="前の月">‹</button><button className="btn small" onClick={() => { setYm({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) }); setSel(today); }}>今月</button><button className="btn small" onClick={() => move(1)} aria-label="次の月">›</button></div>}>
        <div className="cal">
          {['日', '月', '火', '水', '木', '金', '土'].map((d) => <div key={d} className="dow">{d}</div>)}
          {cells.map((d) => {
            const k = toYmd(d);
            const evs = byDate.get(k) ?? [];
            const out = d.getMonth() !== ym.m - 1;
            return (
              <div key={k} className={`day ${out ? 'out' : ''} ${k === today ? 'today' : ''} ${sel === k ? 'sel' : ''} ${isTseHoliday(d) ? 'hol' : ''}`} onClick={() => setSel(k)}>
                <span className="d">{d.getDate()}</span>
                <div className="dots">{evs.slice(0, 6).map((e, i) => <span key={i} className={`dot k-${e.type}`} />)}</div>
              </div>
            );
          })}
        </div>
        <div className="row wrap tiny muted" style={{ gap: 10, marginTop: 8 }}>
          <span><span className="dot k-last" style={{ display: 'inline-block' }} /> 権利付き最終日</span>
          <span><span className="dot k-ex" style={{ display: 'inline-block' }} /> 権利落ち日</span>
          <span><span className="dot k-rec" style={{ display: 'inline-block' }} /> 権利確定日</span>
          <span><span className="dot k-got" style={{ display: 'inline-block' }} /> 受取実績</span>
        </div>
        {sel && (
          <div className="chart-detail">
            <div className="small muted">{sel}</div>
            {selEvents.length === 0 ? <div className="small">予定はありません</div> : selEvents.map((e, i) => <div key={i} className="small">{TYPE_LABEL[e.type]}：{e.name}{e.amount !== undefined && <strong className="num"> {yen(e.amount)}</strong>}</div>)}
          </div>
        )}
        <div className="tiny dim" style={{ marginTop: 8 }}>※権利関連日は「月末が基準日」と仮定し、土日祝・年末年始を除いた受渡（T+2）から算出した推定です。基準日が月末でない企業もあるため、正確な日付は企業の開示で確認してください。</div>
      </Card>

      <Card title={`${ym.m}月の配当（${basis === 'gross' ? '税引前' : '税引後'}）`}>
        <div className="grid2" style={{ marginBottom: 8 }}>
          <div><div className="stat-label">予想（支払月で按分）</div><div className="stat-value">{yen(expectedTotal)}</div></div>
          <div><div className="stat-label">受取実績</div><div className="stat-value">{yen(actualTotal)}</div></div>
        </div>
        {payPlans.length === 0 ? <div className="small muted">この月に支払予定の銘柄はありません（支払月の設定に基づく）</div> : (
          <div className="list">{payPlans.map((p) => <div key={p.name} className="list-item" style={{ cursor: 'default' }}><span className="grow name">{p.name}<div className="tiny dim">支払予定（日付は企業の開示で確定）</div></span><span className="num">{yen(p.amount)}</span></div>)}</div>
        )}
      </Card>

      <Card title={`${ym.y}年の予想と実績`}>
        <MonthlyBars data={yearRows.map(({ names: _n, ...r }) => r)} series={[{ key: 'expected', name: '予想', color: '#3d7dff' }, { key: 'actual', name: '実績', color: '#2ed8ff' }]} onSelect={(l) => { const m = parseInt(l, 10); setYm({ y: ym.y, m }); setSel(null); }} />
        <div className="scroll-x"><table className="t">
          <thead><tr><th>月</th><th className="r">予想</th><th className="r">実績</th><th>支払予定の企業</th></tr></thead>
          <tbody>{yearRows.map((r) => <tr key={r.label}><td>{r.label}</td><td className="r">{yen(r.expected)}</td><td className="r">{yen(r.actual)}</td><td className="tiny">{r.names.join('、') || '—'}</td></tr>)}</tbody>
        </table></div>
      </Card>
    </>
  );
}
