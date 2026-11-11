import { useEffect, useState } from 'react';
import { Sheet, useConfirm, useToast } from './common';
import { saveTrade, deleteTrade, findDuplicateTrade } from '../../db/repo';
import type { Trade } from '../../domain/types';
import { toYmd, isValidYmd } from '../../domain/util';
import { parseNumber } from '../../domain/csv';
import { yen } from '../../domain/format';

export function TradeSheet({ open, onClose, securityId, trade, defaultSide = 'buy' }: { open: boolean; onClose: () => void; securityId: string; trade?: Trade | null; defaultSide?: 'buy' | 'sell' }) {
  const [side, setSide] = useState<'buy' | 'sell'>(defaultSide);
  const [date, setDate] = useState(toYmd(new Date()));
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
  const [fee, setFee] = useState('');
  const [memo, setMemo] = useState('');
  const [err, setErr] = useState('');
  const confirm = useConfirm();
  const toast = useToast();
  useEffect(() => {
    if (!open) return;
    setErr('');
    setSide(trade?.side ?? defaultSide); setDate(trade?.date ?? toYmd(new Date()));
    setQty(trade ? String(trade.quantity) : ''); setPrice(trade ? String(trade.price) : ''); setFee(trade?.fee ? String(trade.fee) : ''); setMemo(trade?.memo ?? '');
  }, [open, trade, defaultSide]);
  const q = parseNumber(qty), p = parseNumber(price);
  const submit = async () => {
    if (!isValidYmd(date)) return setErr('日付を入力してください');
    if (!q || q <= 0) return setErr('株数を入力してください');
    if (p === null || p < 0) return setErr('単価を入力してください');
    const input = { securityId, side, date, quantity: q, price: p, fee: parseNumber(fee) ?? 0, memo };
    const dup = await findDuplicateTrade(input, trade?.id);
    if (dup && !(await confirm({ title: '重複の可能性', message: '同じ日付・株数・単価の取引が既に登録されています。それでも登録しますか？', okLabel: '登録する' }))) return;
    try {
      await saveTrade(input, trade?.id);
      toast(trade ? '取引を更新しました' : side === 'buy' ? '購入を記録しました' : '売却を記録しました');
      onClose();
    } catch (e) { setErr((e as Error).message); }
  };
  const remove = async () => {
    if (!trade) return;
    if (!(await confirm({ title: '取引を削除', message: `${trade.date} の${trade.side === 'buy' ? '購入' : '売却'}（${trade.quantity}株）を削除します。保有株数と平均取得単価が再計算されます。`, okLabel: '削除', danger: true }))) return;
    try { await deleteTrade(trade.id); toast('取引を削除しました'); onClose(); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <Sheet open={open} onClose={onClose} title={trade ? '取引を編集' : '売買を記録'}>
      <div className="seg" style={{ width: '100%', marginBottom: 12 }}>
        <button type="button" style={{ flex: 1 }} className={side === 'buy' ? 'on' : ''} onClick={() => setSide('buy')}>購入</button>
        <button type="button" style={{ flex: 1 }} className={side === 'sell' ? 'on' : ''} onClick={() => setSide('sell')}>売却</button>
      </div>
      <div className="field"><label>{side === 'buy' ? '購入日' : '売却日'}</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
      <div className="grid2">
        <div className="field"><label>{side === 'buy' ? '購入株数' : '売却株数'}</label><input type="number" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
        <div className="field"><label>{side === 'buy' ? '購入単価（円）' : '売却単価（円）'}</label><input type="number" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
      </div>
      <div className="grid2">
        <div className="field"><label>手数料（円・任意）</label><input type="number" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} /></div>
        <div className="field"><label>約定金額</label><div className="num" style={{ paddingTop: 10 }}>{q && p !== null ? yen(q * p) : '—'}</div></div>
      </div>
      <div className="field"><label>メモ</label><input type="text" value={memo} onChange={(e) => setMemo(e.target.value)} /></div>
      {err && <div className="notice warn" style={{ marginBottom: 12 }}>{err}</div>}
      <div className={trade ? 'grid3' : 'grid2'}>
        {trade && <button className="btn danger" onClick={remove}>削除</button>}
        <button className="btn" onClick={onClose}>キャンセル</button>
        <button className="btn primary" onClick={submit}>保存</button>
      </div>
    </Sheet>
  );
}
