import { useEffect, useState } from 'react';
import { Sheet, useToast } from './common';
import { addPrice, setForecastManual } from '../../db/repo';
import { toYmd, isValidYmd } from '../../domain/util';
import { parseNumber } from '../../domain/csv';
import { signedYen, signedPct, dps } from '../../domain/format';
import { CHANGE_KIND_LABELS } from '../../domain/types';

export function PriceSheet({ open, onClose, securityId, current }: { open: boolean; onClose: () => void; securityId: string; current?: number | null }) {
  const [price, setPrice] = useState(''); const [prev, setPrev] = useState(''); const [date, setDate] = useState(toYmd(new Date())); const [err, setErr] = useState('');
  const toast = useToast();
  useEffect(() => { if (open) { setPrice(current ? String(current) : ''); setPrev(''); setDate(toYmd(new Date())); setErr(''); } }, [open, current]);
  const save = async () => {
    const p = parseNumber(price);
    if (!p || p <= 0) return setErr('株価を入力してください');
    if (!isValidYmd(date)) return setErr('日付を入力してください');
    await addPrice({ securityId, price: p, prevClose: parseNumber(prev), asOf: date, source: 'manual' });
    toast('株価を保存しました（手動入力）'); onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title="株価を手動入力">
      <div className="grid2">
        <div className="field"><label>株価（円）</label><input type="number" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} autoFocus /></div>
        <div className="field"><label>前日終値（任意）</label><input type="number" inputMode="decimal" value={prev} onChange={(e) => setPrev(e.target.value)} /></div>
      </div>
      <div className="field"><label>株価の日付</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
      {err && <div className="notice warn" style={{ marginBottom: 12 }}>{err}</div>}
      <div className="grid2"><button className="btn" onClick={onClose}>キャンセル</button><button className="btn primary" onClick={save}>保存</button></div>
    </Sheet>
  );
}

export function ForecastSheet({ open, onClose, securityId, current }: { open: boolean; onClose: () => void; securityId: string; current?: number | null }) {
  const [v, setV] = useState(''); const [undecided, setUndecided] = useState(false); const [note, setNote] = useState(''); const [date, setDate] = useState(toYmd(new Date())); const [err, setErr] = useState('');
  const toast = useToast();
  useEffect(() => { if (open) { setV(current != null ? String(current) : ''); setUndecided(false); setNote(''); setDate(toYmd(new Date())); setErr(''); } }, [open, current]);
  const save = async () => {
    const n = undecided ? null : parseNumber(v);
    if (!undecided && (n === null || n < 0)) return setErr('0以上の数値を入力してください');
    const ev = await setForecastManual(securityId, n, 'manual', date, note || undefined);
    toast(ev ? `${CHANGE_KIND_LABELS[ev.kind]}を記録：${dps(ev.before)}→${dps(ev.after)}（${signedPct(ev.rate, 1)}・年間${signedYen(ev.annualImpact)}）` : '配当予想を保存しました');
    onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title="1株当たり年間配当予想">
      <div className="field"><label>年間配当（円／株）</label><input type="number" inputMode="decimal" value={v} disabled={undecided} onChange={(e) => setV(e.target.value)} autoFocus /></div>
      <label className="row small muted" style={{ marginBottom: 12 }}><input type="checkbox" checked={undecided} onChange={(e) => setUndecided(e.target.checked)} />未定</label>
      <div className="grid2">
        <div className="field"><label>開示日・確認日</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="field"><label>確認した情報源（任意）</label><input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="例: 決算短信 2026/11/5" /></div>
      </div>
      <div className="notice" style={{ marginBottom: 12 }}>前回の値と異なる場合は、増配・減配として通知履歴に「手動入力」の情報源つきで記録します。</div>
      {err && <div className="notice warn" style={{ marginBottom: 12 }}>{err}</div>}
      <div className="grid2"><button className="btn" onClick={onClose}>キャンセル</button><button className="btn primary" onClick={save}>保存</button></div>
    </Sheet>
  );
}
