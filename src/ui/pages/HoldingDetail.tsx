import { useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { useHoldings, useToday } from '../hooks';
import { trashSecurity } from '../../db/repo';
import { sortTrades } from '../../domain/position';
import { latestRecorded } from '../../domain/portfolio';
import { totalOf, inLast12Months } from '../../domain/dividends';
import { yen, signedYen, pct, signedPct, num, dps, dateTime, tone } from '../../domain/format';
import { MARKET_LABELS, SOURCE_LABELS, CHANGE_KIND_LABELS, type Trade } from '../../domain/types';
import { Card, Stat, Empty, useConfirm, useToast, SourceTag } from '../components/common';
import { TrendLine } from '../components/charts';
import { TradeSheet } from '../components/TradeSheet';
import { PriceSheet, ForecastSheet } from '../components/QuoteSheets';
import { externalLinks } from '../../data/links';
import { IExt } from '../icons';

export default function HoldingDetail() {
  const { id = '' } = useParams();
  const sid = decodeURIComponent(id);
  const holdings = useHoldings(true);
  const today = useToday();
  const nav = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();
  const trades = useLiveQuery(() => db.trades.where('securityId').equals(sid).toArray(), [sid]);
  const prices = useLiveQuery(() => db.prices.where('securityId').equals(sid).toArray(), [sid]);
  const forecasts = useLiveQuery(() => db.forecasts.where('securityId').equals(sid).toArray(), [sid]);
  const divs = useLiveQuery(() => db.dividends.where('securityId').equals(sid).toArray(), [sid]);
  const events = useLiveQuery(() => db.events.where('securityId').equals(sid).toArray(), [sid]);
  const [tradeOpen, setTradeOpen] = useState<{ trade: Trade | null; side: 'buy' | 'sell' } | null>(null);
  const [priceOpen, setPriceOpen] = useState(false);
  const [fcOpen, setFcOpen] = useState(false);

  if (!holdings || !trades || !prices || !forecasts || !divs || !events) return <div className="empty">読み込み中…</div>;
  const h = holdings.find((x) => x.security.id === sid);
  if (!h) return <Card><Empty title="銘柄が見つかりません" text="削除されたか、ゴミ箱に移動された可能性があります。" action={<Link className="btn" to="/holdings">保有銘柄へ</Link>} /></Card>;
  const s = h.security;
  const pos = h.position;
  const last12 = totalOf(divs, 'gross', (r) => inLast12Months(r, today));
  const last12Net = totalOf(divs, 'net', (r) => inLast12Months(r, today));

  // 時価ベース利回りの推移：各株価時点で有効だった配当予想を使う
  const yieldHistory = [...prices].sort((a, b) => a.asOf.localeCompare(b.asOf)).map((p) => {
    const f = latestRecorded(forecasts.filter((x) => x.asOf <= p.asOf || x.fetchedAt <= p.fetchedAt));
    return { label: p.asOf, yield: f && f.annualDps !== null && p.price > 0 ? Math.round((f.annualDps / p.price) * 10000) / 100 : null };
  }).filter((x) => x.yield !== null) as { label: string; yield: number }[];
  const dpsHistory = [...forecasts].sort((a, b) => a.fetchedAt.localeCompare(b.fetchedAt));

  const remove = async () => {
    if (!(await confirm({ title: '銘柄をゴミ箱へ移動', message: <>「{s.name}」をゴミ箱へ移動します。売買履歴・配当履歴は保持され、設定 → ゴミ箱 からいつでも復元できます。</>, okLabel: 'ゴミ箱へ移動', danger: true }))) return;
    await trashSecurity(s.id);
    toast('ゴミ箱へ移動しました');
    nav('/holdings', { replace: true });
  };

  return (
    <>
      <Card className="hero">
        <div className="row between">
          <div className="grow">
            <div style={{ fontSize: 19, fontWeight: 800 }}>{s.name}</div>
            <div className="tiny muted row wrap" style={{ gap: 6 }}><span className="code">{s.code}</span>{MARKET_LABELS[s.market]}{s.sector ? `・${s.sector}` : ''}・{s.account === 'nisa' ? 'NISA' : '課税口座'}</div>
          </div>
          <Link className="btn small" to={`/holdings/${encodeURIComponent(s.id)}/edit`}>編集</Link>
        </div>
        <div className="divider" />
        <div className="row between">
          <div>
            <div className="stat-label">現在株価</div>
            <div className="num" style={{ fontSize: 24, fontWeight: 800 }}>{h.price ? yen(h.price.price, 2) : '—'}</div>
            {h.dayChange !== null && <div className={`num small ${tone(h.dayChange)}`}>前日比 {signedYen(h.dayChange)}（{signedPct(h.dayChangeRate)}）</div>}
          </div>
          <button className="btn small" onClick={() => setPriceOpen(true)}>株価を入力</button>
        </div>
        {h.price ? <div style={{ marginTop: 6 }}><SourceTag source={h.price.source} at={h.price.fetchedAt} detail={h.price.sourceDetail} /><div className="tiny dim">株価の日付：{h.price.asOf}{h.price.marketCap ? `・時価総額 ${yen(h.price.marketCap * 1e6)}` : ''}</div></div> : <div className="tiny warn" style={{ marginTop: 6 }}>株価が未入力です（自動取得が未設定、または対象外）</div>}
      </Card>

      <Card title="保有状況">
        <div className="grid3">
          <Stat label="保有株数" value={`${num(pos.quantity)}株`} />
          <Stat label="平均取得単価" value={yen(pos.avgCost, 2)} />
          <Stat label="取得総額" value={yen(pos.costBasis)} />
          <Stat label="評価額" value={yen(h.marketValue)} />
          <Stat label="含み損益" value={signedYen(h.unrealizedPnl)} toneOf={h.unrealizedPnl} sub={signedPct(h.unrealizedPnlRate)} />
          <Stat label="実現損益" value={signedYen(pos.realizedPnl)} toneOf={pos.realizedPnl} />
        </div>
        {pos.firstAcquiredDate && <div className="tiny dim" style={{ marginTop: 8 }}>取得日（現在の保有を開始した日）：{pos.firstAcquiredDate}</div>}
        {pos.errors.length > 0 && <div className="notice warn" style={{ marginTop: 8 }}>{pos.errors.join(' / ')}</div>}
      </Card>

      <Card title="配当・利回り" right={<button className="btn small" onClick={() => setFcOpen(true)}>配当予想を入力</button>}>
        <div className="grid2">
          <Stat label="1株年間配当予想" value={h.forecast ? dps(h.annualDps) : '未入力'} />
          <Stat label="年間予想配当金" value={yen(h.annualDividend)} sub={`税引後 ${yen(h.annualDividendNet)}`} />
          <Stat label="取得価格ベース利回り" value={pct(h.yieldOnCost)} />
          <Stat label="現在株価ベース利回り" value={pct(h.currentYield)} />
          <Stat label="過去12か月の受取額" value={yen(last12)} sub={`税引後 ${yen(last12Net)}`} />
          <Stat label="権利確定月 / 支払月" value={<span className="small">{s.recordMonths.length ? s.recordMonths.map((m) => `${m}月`).join('・') : '未設定'} / {s.payMonths.length ? s.payMonths.map((m) => `${m}月`).join('・') : '未設定'}</span>} />
        </div>
        {h.forecast && <div style={{ marginTop: 8 }}><SourceTag source={h.forecast.source} at={h.forecast.fetchedAt} detail={h.forecast.sourceDetail} />{h.forecast.sourceDetail && <div className="tiny dim">{h.forecast.sourceDetail}</div>}</div>}
        {yieldHistory.length >= 2 && (<><div className="section-title">時価ベース配当利回りの推移</div><TrendLine data={yieldHistory} series={[{ key: 'yield', name: '利回り', color: '#2ed8ff' }]} height={180} valueFmt={(v) => `${v.toFixed(2)}%`} /></>)}
        {dpsHistory.length > 0 && (
          <>
            <div className="section-title">配当予想の記録</div>
            <div className="scroll-x"><table className="t"><thead><tr><th>日付</th><th className="r">年間配当</th><th>情報源</th></tr></thead>
              <tbody>{[...dpsHistory].reverse().map((f) => <tr key={f.id}><td>{f.asOf}</td><td className="r">{dps(f.annualDps)}</td><td className="tiny">{SOURCE_LABELS[f.source]}<div className="dim">{dateTime(f.fetchedAt)}</div></td></tr>)}</tbody></table></div>
          </>
        )}
      </Card>

      <Card title="売買履歴" right={<div className="row" style={{ gap: 6 }}><button className="btn small" onClick={() => setTradeOpen({ trade: null, side: 'buy' })}>＋購入</button><button className="btn small" onClick={() => setTradeOpen({ trade: null, side: 'sell' })} disabled={pos.quantity <= 0}>＋売却</button></div>}>
        {trades.length === 0 ? <Empty title="売買履歴がありません" /> : (
          <div className="scroll-x">
            <table className="t">
              <thead><tr><th>日付</th><th>区分</th><th className="r">株数</th><th className="r">単価</th><th className="r">金額</th></tr></thead>
              <tbody>
                {sortTrades(trades).reverse().map((t) => (
                  <tr key={t.id} onClick={() => setTradeOpen({ trade: t, side: t.side })} style={{ cursor: 'pointer' }}>
                    <td>{t.date}</td>
                    <td><span className={`pill ${t.side === 'buy' ? '' : 'warn'}`}>{t.side === 'buy' ? '購入' : '売却'}</span></td>
                    <td className="r">{num(t.quantity)}</td><td className="r">{yen(t.price, 2)}</td><td className="r">{yen(t.quantity * t.price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="tiny dim" style={{ marginTop: 6 }}>行をタップすると編集・削除できます。平均取得単価は移動平均法（手数料込み）で計算しています。</div>
          </div>
        )}
      </Card>

      <Card title="配当の受取履歴" right={<Link className="small" to={`/dividends/company/${encodeURIComponent(s.id)}`}>すべて見る ›</Link>}>
        {divs.length === 0 ? <Empty title="受取記録がありません" action={<Link className="btn small" to={`/dividends?new=${encodeURIComponent(s.id)}`}>配当を記録</Link>} /> : (
          <div className="list">{[...divs].sort((a, b) => b.receivedDate.localeCompare(a.receivedDate)).slice(0, 5).map((d) => (
            <div key={d.id} className="list-item" style={{ cursor: 'default' }}><div className="grow">{d.receivedDate}<div className="tiny dim">{d.shares}株 × {d.dps}円</div></div><div className="right num">{yen(d.gross)}<div className="tiny dim">税引後 {yen(d.net)}</div></div></div>
          ))}</div>
        )}
      </Card>

      {events.length > 0 && (
        <Card title="増配・減配の履歴" right={<Link className="small" to="/notifications">通知一覧 ›</Link>}>
          {[...events].sort((a, b) => b.disclosureDate.localeCompare(a.disclosureDate)).map((e) => (
            <div key={e.id} className="row between small" style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
              <span><span className={`pill ${e.kind === 'increase' || e.kind === 'resume' ? 'up' : 'down'}`}>{CHANGE_KIND_LABELS[e.kind]}</span> {e.disclosureDate}</span>
              <span className="num">{dps(e.before)} → {dps(e.after)}</span>
            </div>
          ))}
        </Card>
      )}

      <Card title="外部サイトで調べる">
        <div className="tiny dim" style={{ marginBottom: 8 }}>各サイトの利用規約を尊重し、自動収集は行わずリンクで開きます。</div>
        <div className="grid2">
          {externalLinks(s.country, s.code).map((l) => (
            <a key={l.label} className="btn small" href={l.url} target="_blank" rel="noopener noreferrer" style={{ justifyContent: 'space-between' }}>
              <span>{l.label}<span className="tiny dim" style={{ display: 'block', fontWeight: 400 }}>{l.note}</span></span><IExt />
            </a>
          ))}
        </div>
      </Card>

      {s.memo && <Card title="メモ"><div style={{ whiteSpace: 'pre-wrap' }}>{s.memo}</div></Card>}
      <button className="btn danger block" onClick={remove} style={{ marginBottom: 20 }}>この銘柄をゴミ箱へ移動</button>

      <TradeSheet open={!!tradeOpen} onClose={() => setTradeOpen(null)} securityId={s.id} trade={tradeOpen?.trade} defaultSide={tradeOpen?.side} />
      <PriceSheet open={priceOpen} onClose={() => setPriceOpen(false)} securityId={s.id} current={h.price?.price} />
      <ForecastSheet open={fcOpen} onClose={() => setFcOpen(false)} securityId={s.id} current={h.annualDps} />
    </>
  );
}
