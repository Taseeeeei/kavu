import { useEffect, useMemo, useState } from 'react';
import { Sheet, useConfirm, useToast } from './common';
import { saveDividend, findDuplicateDividend, deleteDividend } from '../../db/repo';
import { DIVIDEND_KIND_LABELS, type DividendKind, type DividendRecord } from '../../domain/types';
import type { HoldingView } from '../../domain/portfolio';
import { db } from '../../db/db';
import { quantityAt } from '../../domain/position';
import { withholdingTax, grossFromDps } from '../../domain/tax';
import { toYmd, isValidYmd } from '../../domain/util';
import { parseNumber } from '../../domain/csv';
import { yen } from '../../domain/format';

export function DividendSheet({ open, onClose, holdings, record, presetSecurityId }: { open: boolean; onClose: () => void; holdings: HoldingView[]; record?: DividendRecord | null; presetSecurityId?: string | null }) {
  const [sid, setSid] = useState('');
  const [date, setDate] = useState(toYmd(new Date()));
  const [dpsV, setDps] = useState('');
  const [shares, setShares] = useState('');
  const [gross, setGross] = useState('');
  const [tax, setTax] = useState('');
  const [net, setNet] = useState('');
  const [kind, setKind] = useState<DividendKind>('final');
  const [memo, setMemo] = useState('');
  const [manualAmounts, setManualAmounts] = useState(false);
  const [err, setErr] = useState('');
  const confirm = useConfirm();
  const toast = useToast();
  const options = useMemo(() => [...holdings].sort((a, b) => a.security.code.localeCompare(b.security.code)), [holdings]);
  const h = options.find((x) => x.security.id === sid);

  useEffect(() => {
    if (!open) return;
    setErr('');
    if (record) {
      setSid(record.securityId); setDate(record.receivedDate); setDps(String(record.dps)); setShares(String(record.shares));
      setGross(String(record.gross)); setTax(String(record.tax)); setNet(String(record.net)); setKind(record.kind); setMemo(record.memo); setManualAmounts(true);
    } else {
      setSid(presetSecurityId ?? options[0]?.security.id ?? ''); setDate(toYmd(new Date())); setDps(''); setShares(''); setGross(''); setTax(''); setNet(''); setKind('final'); setMemo(''); setManualAmounts(false);
    }
  }, [open, record, presetSecurityId, options]);

  // 配当対象株数の初期値：受取日時点の保有株数
  useEffect(() => {
    if (!open || record || !sid) return;
    db.trades.where('securityId').equals(sid).toArray().then((ts) => setShares(String(quantityAt(ts, date))));
  }, [sid, date, open, record]);

  // 自動計算（税引前＝1株配当×株数、税金＝所得税・住民税を各々切り捨て）
  useEffect(() => {
    if (manualAmounts) return;
    const d = parseNumber(dpsV), s = parseNumber(shares);
    if (d === null || s === null) { setGross(''); setTax(''); setNet(''); return; }
    const g = grossFromDps(d, s);
    const t = withholdingTax(g, h?.security.account ?? 'taxable');
    setGross(String(g)); setTax(String(t)); setNet(String(g - t));
  }, [dpsV, shares, manualAmounts, h]);

  const fillFromForecast = () => {
    if (!h || h.annualDps === null) return;
    const n = Math.max(1, h.security.payMonths.length || 2);
    setDps(String(Math.round((h.annualDps / n) * 100) / 100));
    toast('年間配当予想を支払回数で割った値を入れました。実際の金額に合わせて修正してください');
  };

  const submit = async () => {
    if (!h) return setErr('銘柄を選択してください');
    if (!isValidYmd(date)) return setErr('受取日を入力してください');
    const g = parseNumber(gross), t = parseNumber(tax) ?? 0, n = parseNumber(net);
    if (g === null || g < 0 || n === null) return setErr('金額を入力してください');
    if (Math.abs(g - t - n) > 1 && !(await confirm({ title: '金額の確認', message: `税引前（${yen(g)}）−税金（${yen(t)}）と税引後（${yen(n)}）が一致しません。このまま保存しますか？`, okLabel: '保存する' }))) return;
    const input = { securityId: h.security.id, code: h.security.code, name: h.security.name, receivedDate: date, dps: parseNumber(dpsV) ?? 0, shares: parseNumber(shares) ?? 0, gross: g, tax: t, net: n, kind, memo };
    const dup = await findDuplicateDividend(input, record?.id);
    if (dup && !(await confirm({ title: '重複の可能性', message: '同じ銘柄・受取日・区分・金額の記録が既にあります。それでも登録しますか？', okLabel: '登録する' }))) return;
    await saveDividend(input, record?.id);
    toast(record ? '配当記録を更新しました' : '配当を記録しました');
    onClose();
  };
  const remove = async () => {
    if (!record) return;
    if (!(await confirm({ title: '配当記録を削除', message: `${record.receivedDate} ${record.name} の記録（${yen(record.gross)}）を削除します。削除前に自動バックアップを作成します。`, okLabel: '削除', danger: true }))) return;
    await deleteDividend(record.id); toast('削除しました'); onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title={record ? '配当記録を編集' : '配当金を記録'}>
      {options.length === 0 ? <div className="notice">先に保有銘柄を登録してください。</div> : (
        <>
          <div className="field"><label>銘柄</label>
            <select value={sid} onChange={(e) => setSid(e.target.value)} disabled={!!record}>
              {options.map((o) => <option key={o.security.id} value={o.security.id}>{o.security.code} {o.security.name}{o.position.quantity === 0 ? '（売却済み）' : ''}</option>)}
            </select></div>
          <div className="grid2">
            <div className="field"><label>配当受取日</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div className="field"><label>配当区分</label>
              <select value={kind} onChange={(e) => setKind(e.target.value as DividendKind)}>{Object.entries(DIVIDEND_KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          </div>
          <div className="grid2">
            <div className="field"><label>1株あたり配当金（円）</label><input type="number" inputMode="decimal" value={dpsV} onChange={(e) => setDps(e.target.value)} />
              {h && h.annualDps !== null && !record && <button type="button" className="btn small ghost" onClick={fillFromForecast}>予想から入力</button>}</div>
            <div className="field"><label>配当対象株数</label><input type="number" inputMode="decimal" value={shares} onChange={(e) => setShares(e.target.value)} /><span className="hint">受取日時点の保有株数を初期表示</span></div>
          </div>
          <label className="row small muted" style={{ marginBottom: 10 }}><input type="checkbox" checked={manualAmounts} onChange={(e) => setManualAmounts(e.target.checked)} />金額を手動で入力する（配当金計算書の金額に合わせる）</label>
          <div className="grid3">
            <div className="field"><label>税引前</label><input type="number" inputMode="decimal" value={gross} disabled={!manualAmounts} onChange={(e) => setGross(e.target.value)} /></div>
            <div className="field"><label>税金</label><input type="number" inputMode="decimal" value={tax} disabled={!manualAmounts} onChange={(e) => setTax(e.target.value)} /></div>
            <div className="field"><label>税引後</label><input type="number" inputMode="decimal" value={net} disabled={!manualAmounts} onChange={(e) => setNet(e.target.value)} /></div>
          </div>
          {!manualAmounts && h && <div className="tiny dim" style={{ marginBottom: 10 }}>{h.security.account === 'nisa' ? 'NISA口座のため非課税で計算' : '所得税等15.315%・住民税5%（各1円未満切り捨て）で計算'}</div>}
          <div className="field"><label>メモ</label><input type="text" value={memo} onChange={(e) => setMemo(e.target.value)} /></div>
          {err && <div className="notice warn" style={{ marginBottom: 12 }}>{err}</div>}
          <div className={record ? 'grid3' : 'grid2'}>
            {record && <button className="btn danger" onClick={remove}>削除</button>}
            <button className="btn" onClick={onClose}>キャンセル</button>
            <button className="btn primary" onClick={submit}>保存</button>
          </div>
        </>
      )}
    </Sheet>
  );
}
