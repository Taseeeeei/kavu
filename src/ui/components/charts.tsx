import { useState, type ReactNode } from 'react';
import {
  PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, LineChart, Line, Legend, AreaChart, Area,
} from 'recharts';
import { shortYen, yen, pct } from '../../domain/format';

export const PALETTE = ['#3d7dff', '#2ed8ff', '#8b7bff', '#1fd39a', '#ffb547', '#ff7ab6', '#5fb3ff', '#c38bff', '#7be4b0', '#ffd36b'];
const OTHER = '#5f729e';
const AXIS = { stroke: '#5f729e', fontSize: 11, tickLine: false, axisLine: false } as const;

export interface PieRow { id: string; name: string; value: number; sub?: string }

/** 円グラフ：上位8件＋その他。タップ（クリック）で詳細を表示 */
export function DonutWithLegend({ rows, centerLabel, onOpen, renderDetail }: {
  rows: PieRow[]; centerLabel: string; onOpen?: (id: string) => void; renderDetail?: (r: PieRow & { share: number }) => ReactNode;
}) {
  const [sel, setSel] = useState<string | null>(null);
  const total = rows.reduce((a, b) => a + b.value, 0);
  const top = rows.slice(0, 8);
  const rest = rows.slice(8);
  const data = [...top, ...(rest.length ? [{ id: '__other', name: `その他（${rest.length}銘柄）`, value: rest.reduce((a, b) => a + b.value, 0) }] : [])]
    .map((r) => ({ ...r, share: total > 0 ? (r.value / total) * 100 : 0 }));
  const selected = data.find((d) => d.id === sel) ?? null;
  return (
    <div>
      <div style={{ position: 'relative', height: 210 }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="92%" paddingAngle={data.length > 1 ? 1.5 : 0} stroke="none"
              onClick={(_, i) => setSel(data[i].id === sel ? null : data[i].id)} isAnimationActive={false}>
              {data.map((d, i) => <Cell key={d.id} fill={d.id === '__other' ? OTHER : PALETTE[i % PALETTE.length]} opacity={sel && sel !== d.id ? 0.35 : 1} style={{ cursor: 'pointer', outline: 'none' }} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none', textAlign: 'center' }}>
          <div>
            <div className="tiny muted">{selected ? selected.name : centerLabel}</div>
            <div className="num" style={{ fontWeight: 800, fontSize: 17 }}>{yen(selected ? selected.value : total)}</div>
            {selected && <div className="small" style={{ color: 'var(--accent)' }}>{pct(selected.share, 1)}</div>}
          </div>
        </div>
      </div>
      <div className="legend">
        {data.map((d, i) => (
          <div key={d.id} className={`legend-row ${sel === d.id ? 'on' : ''}`} onClick={() => setSel(d.id === sel ? null : d.id)}>
            <span className="sw" style={{ background: d.id === '__other' ? OTHER : PALETTE[i % PALETTE.length] }} />
            <span className="nm">{d.name}{d.sub && <span className="dim tiny"> {d.sub}</span>}</span>
            <span className="num">{yen(d.value)}</span>
            <span className="num muted" style={{ width: 54, textAlign: 'right' }}>{pct(d.share, 1)}</span>
          </div>
        ))}
      </div>
      {selected && (
        <div className="chart-detail">
          {renderDetail ? renderDetail(selected) : <div>{selected.name}：{yen(selected.value)}（{pct(selected.share, 1)}）</div>}
          {onOpen && selected.id !== '__other' && <button className="btn small" style={{ marginTop: 8 }} onClick={() => onOpen(selected.id)}>詳細を開く</button>}
        </div>
      )}
    </div>
  );
}

function TT({ active, payload, label, labelFmt }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string; labelFmt?: (l: string) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="tt">
      <div className="h">{labelFmt ? labelFmt(String(label)) : label}</div>
      {payload.map((p) => <div key={p.name} className="num"><span style={{ color: p.color }}>●</span> {p.name}：{yen(p.value)}</div>)}
    </div>
  );
}

export function MonthlyBars({ data, series, height = 220, onSelect }: {
  data: Record<string, number | string>[]; series: { key: string; name: string; color: string }[]; height?: number; onSelect?: (label: string) => void;
}) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 4, left: -8, bottom: 0 }} onClick={(e) => e?.activeLabel && onSelect?.(String(e.activeLabel))}>
          <CartesianGrid vertical={false} stroke="#1d3263" strokeDasharray="3 4" />
          <XAxis dataKey="label" {...AXIS} interval={0} />
          <YAxis {...AXIS} tickFormatter={shortYen} width={44} />
          <Tooltip content={<TT />} cursor={{ fill: 'rgba(46,216,255,.08)' }} />
          {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {series.map((s) => <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={22} />)}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function TrendLine({ data, series, height = 220, xKey = 'label', area = false, valueFmt }: {
  data: Record<string, number | string>[]; series: { key: string; name: string; color: string }[]; height?: number; xKey?: string; area?: boolean; valueFmt?: (v: number) => string;
}) {
  const yFmt = valueFmt ?? shortYen;
  const Tip = ({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) =>
    valueFmt
      ? (active && payload?.length ? <div className="tt"><div className="h">{label}</div>{payload.map((p) => <div key={p.name} className="num"><span style={{ color: p.color }}>●</span> {p.name}：{valueFmt(p.value)}</div>)}</div> : null)
      : <TT active={active} payload={payload} label={label} />;
  return (
    <div style={{ height }}>
      <ResponsiveContainer>
        {area ? (
          <AreaChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
            <defs>{series.map((s) => <linearGradient key={s.key} id={`g-${s.key}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={s.color} stopOpacity={0.35} /><stop offset="1" stopColor={s.color} stopOpacity={0} /></linearGradient>)}</defs>
            <CartesianGrid vertical={false} stroke="#1d3263" strokeDasharray="3 4" />
            <XAxis dataKey={xKey} {...AXIS} minTickGap={24} />
            <YAxis {...AXIS} tickFormatter={yFmt} width={48} />
            <Tooltip content={<Tip />} />
            {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
            {series.map((s) => <Area key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} fill={`url(#g-${s.key})`} dot={data.length < 16} activeDot={{ r: 5 }} />)}
          </AreaChart>
        ) : (
          <LineChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="#1d3263" strokeDasharray="3 4" />
            <XAxis dataKey={xKey} {...AXIS} minTickGap={16} />
            <YAxis {...AXIS} tickFormatter={yFmt} width={48} />
            <Tooltip content={<Tip />} />
            {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
            {series.map((s) => <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2.2} dot={{ r: 3 }} activeDot={{ r: 6 }} />)}
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

export function RankBars({ rows, onOpen }: { rows: { id: string; name: string; value: number; sub?: string }[]; onOpen?: (id: string) => void }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="list">
      {rows.map((r, i) => (
        <div key={r.id} className="list-item" onClick={() => onOpen?.(r.id)}>
          <div className="num dim" style={{ width: 20, textAlign: 'center', fontWeight: 700 }}>{i + 1}</div>
          <div className="grow">
            <div className="row between"><span className="name">{r.name}</span><span className="num">{yen(r.value)}</span></div>
            <div className="bar-track" style={{ marginTop: 6 }}><div className="bar-fill" style={{ width: `${(r.value / max) * 100}%` }} /></div>
            {r.sub && <div className="tiny dim" style={{ marginTop: 3 }}>{r.sub}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
