import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { db } from '../../db/db';
import { createSecurity, updateSecurity, saveTrade, addPrice, setForecastManual, DuplicateError, restoreSecurity } from '../../db/repo';
import { MARKET_LABELS, type Market, type Country, type AccountType, type Trade } from '../../domain/types';
import { toYmd, isValidYmd, securityIdOf } from '../../domain/util';
import { computePosition } from '../../domain/position';
import { latestRecorded, latestBy } from '../../domain/portfolio';
import { Card, MonthsPicker, useToast } from '../components/common';
import { parseNumber } from '../../domain/csv';
import { lookupStock } from '../../data/stockList';
import { loadSettings } from '../../db/settings';
import { JQuantsProvider } from '../../data/jquants';

interface FormState {
  country: Country; code: string; name: string; market: Market; account: AccountType;
  quantity: string; avgPrice: string; acquiredDate: string; currentPrice: string; annualDps: string; dpsUndecided: boolean;
  recordMonths: number[]; payMonths: number[]; memo: string; sector: string;
}

const empty: FormState = { country: 'JP', code: '', name: '', market: 'TSE_PRIME', account: 'taxable', quantity: '', avgPrice: '', acquiredDate: toYmd(new Date()), currentPrice: '', annualDps: '', dpsUndecided: false, recordMonths: [], payMonths: [], memo: '', sector: '' };

export default function HoldingForm() {
  const { id } = useParams();
  const secId = id ? decodeURIComponent(id) : null;
  const nav = useNavigate();
  const toast = useToast();
  const [f, setF] = useState<FormState>(empty);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [trashed, setTrashed] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [lookup, setLookup] = useState<{ state: 'idle' | 'loading' | 'found' | 'notfound' | 'nolist'; text?: string }>({ state: 'idle' });
  const [autoName, setAutoName] = useState('');
  const edit = !!secId;

  useEffect(() => {
    if (!secId) return;
    (async () => {
      const s = await db.securities.get(secId);
      if (!s) return;
      const ts = await db.trades.where('securityId').equals(secId).toArray();
      const fc = latestRecorded(await db.forecasts.where('securityId').equals(secId).toArray());
      const pr = latestBy(await db.prices.where('securityId').equals(secId).toArray());
      const pos = computePosition(ts);
      setTrades(ts);
      setF({
        country: s.country, code: s.code, name: s.name, market: s.market, account: s.account,
        quantity: String(pos.quantity), avgPrice: pos.avgCost ? String(Math.round(pos.avgCost * 100) / 100) : '', acquiredDate: ts[0]?.date ?? toYmd(new Date()),
        currentPrice: pr ? String(pr.price) : '', annualDps: fc?.annualDps != null ? String(fc.annualDps) : '', dpsUndecided: !!fc && fc.annualDps === null,
        recordMonths: s.recordMonths, payMonths: s.payMonths, memo: s.memo, sector: s.sector ?? '',
      });
    })();
  }, [secId]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((p) => ({ ...p, [k]: v }));
  const singleTrade = trades.length === 1 && trades[0].side === 'buy';
  const qtyEditable = !edit || singleTrade || trades.length === 0;

  const validate = () => {
    const e: Record<string, string> = {};
    if (!f.code.trim()) e.code = '銘柄コードを入力してください';
    else if (f.country === 'JP' && !/^[0-9][0-9A-Z]{3}$/.test(f.code.trim().toUpperCase())) e.code = '日本株の銘柄コードは4桁です（例: 7203, 130A）';
    if (!f.name.trim()) e.name = '企業名を入力してください';
    if (qtyEditable) {
      const q = parseNumber(f.quantity), p = parseNumber(f.avgPrice);
      if (!edit || f.quantity) {
        if (q === null || q <= 0) e.quantity = '保有株数を入力してください';
        if (p === null || p < 0) e.avgPrice = '平均取得単価を入力してください';
        if (!isValidYmd(f.acquiredDate)) e.acquiredDate = '取得日を入力してください';
      }
    }
    if (f.currentPrice && (parseNumber(f.currentPrice) ?? -1) <= 0) e.currentPrice = '株価は正の数で入力してください';
    if (f.annualDps && !f.dpsUndecided && (parseNumber(f.annualDps) ?? -1) < 0) e.annualDps = '0以上の数値で入力してください';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate() || saving) return;
    setSaving(true);
    try {
      const base = { country: f.country, code: f.code.trim().toUpperCase(), name: f.name.trim(), market: f.market, account: f.account, recordMonths: f.recordMonths, payMonths: f.payMonths, memo: f.memo, sector: f.sector || undefined };
      let sid = secId;
      if (!edit) {
        const s = await createSecurity(base);
        sid = s.id;
        await saveTrade({ securityId: s.id, side: 'buy', date: f.acquiredDate, quantity: parseNumber(f.quantity)!, price: parseNumber(f.avgPrice)!, fee: 0, memo: '初回登録' });
      } else {
        await updateSecurity(sid!, base);
        if (qtyEditable && f.quantity) {
          const q = parseNumber(f.quantity)!, p = parseNumber(f.avgPrice)!;
          await saveTrade({ securityId: sid!, side: 'buy', date: f.acquiredDate, quantity: q, price: p, fee: trades[0]?.fee ?? 0, memo: trades[0]?.memo ?? '' }, trades[0]?.id);
        }
      }
      const cp = parseNumber(f.currentPrice);
      if (cp && cp > 0) {
        const prev = latestBy(await db.prices.where('securityId').equals(sid!).toArray());
        if (!prev || prev.price !== cp) await addPrice({ securityId: sid!, price: cp, prevClose: null, asOf: toYmd(new Date()), source: 'manual' });
      }
      if (f.dpsUndecided) await setForecastManual(sid!, null, 'manual');
      else if (f.annualDps !== '') {
        const ev2 = await setForecastManual(sid!, parseNumber(f.annualDps), 'manual');
        if (ev2) toast('配当予想の変更を通知履歴に記録しました（手動入力）');
      }
      toast(edit ? '保存しました' : '登録しました');
      nav(`/holdings/${encodeURIComponent(sid!)}`, { replace: true });
    } catch (e) {
      if (e instanceof DuplicateError) setErrors({ code: e.message });
      else setErrors({ form: (e as Error).message });
    } finally { setSaving(false); }
  };

  // 銘柄コードから企業名・市場・業種を自動入力（JPX上場銘柄一覧 → 見つからなければJ-Quants）
  useEffect(() => {
    if (edit || f.country !== 'JP') { setLookup({ state: 'idle' }); return; }
    const code = f.code.trim().toUpperCase();
    if (!/^[0-9][0-9A-Z]{3}$/.test(code)) { setLookup({ state: 'idle' }); return; }
    let cancelled = false;
    setLookup({ state: 'loading' });
    (async () => {
      const apply = (name: string, market: Market | null, sector: string, text: string) => {
        if (cancelled) return;
        setF((p) => ({ ...p, name: !p.name.trim() || p.name === autoName ? name : p.name, market: market ?? p.market, sector }));
        setAutoName(name);
        setLookup({ state: 'found', text });
      };
      const { stock, list } = await lookupStock(code);
      if (stock) return apply(stock.name, stock.market === 'OTHER' ? 'OTHER' : stock.market, stock.sector, `${list!.source}（${list!.asOf}時点）から入力：${stock.marketLabel}${stock.sector ? `・${stock.sector}` : ''}`);
      const s = await loadSettings();
      if (s.proxyUrl && navigator.onLine) {
        try {
          const info = await new JQuantsProvider(s.proxyUrl, s.proxyToken, s.jquantsPlan).getCompany(code);
          if (info) {
            const mk: Market | null = info.marketName.includes('プライム') ? 'TSE_PRIME' : info.marketName.includes('スタンダード') ? 'TSE_STANDARD' : info.marketName.includes('グロース') ? 'TSE_GROWTH' : null;
            return apply(info.name, mk, info.sector, `J-Quants（JPX公式）から入力：${info.marketName}・${info.sector}`);
          }
        } catch { /* 下で未検出として表示 */ }
      }
      if (cancelled) return;
      setF((p) => (autoName && p.name === autoName ? { ...p, name: '', sector: '' } : p));
      setLookup(list ? { state: 'notfound', text: `${list.source}（${list.asOf}時点）に見つかりません。新規上場の銘柄などは企業名を手入力してください` } : { state: 'nolist', text: '銘柄一覧を読み込めませんでした。企業名を手入力してください' });
    })();
    return () => { cancelled = true; };
  }, [f.code, f.country, edit]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (edit || !f.code.trim()) { setTrashed(null); return; }
    const sid = securityIdOf(f.country, f.code);
    db.securities.get(sid).then((s) => setTrashed(s?.deletedAt ? sid : null));
  }, [f.code, f.country, edit]);

  return (
    <form onSubmit={submit} noValidate>
      <Card title="銘柄情報">
        <div className="grid2">
          <div className="field"><label>国・地域</label>
            <select value={f.country} onChange={(e) => { const c = e.target.value as Country; set('country', c); set('market', c === 'US' ? 'US' : 'TSE_PRIME'); }}>
              <option value="JP">日本</option><option value="US">米国（手動入力）</option>
            </select></div>
          <div className="field"><label htmlFor="code">銘柄コード</label>
            <input id="code" type="text" inputMode={f.country === 'JP' ? 'text' : 'text'} autoCapitalize="characters" value={f.code} onChange={(e) => set('code', e.target.value)} disabled={edit} placeholder={f.country === 'JP' ? '例: 8058' : '例: KO'} />
            {errors.code && <span className="err">{errors.code}</span>}</div>
        </div>
        {lookup.state !== 'idle' && <div className={`tiny ${lookup.state === 'found' ? 'muted' : lookup.state === 'loading' ? 'dim' : 'warn'}`} style={{ margin: '-4px 0 12px' }}>{lookup.state === 'loading' ? '銘柄を検索中…' : lookup.text}</div>}
        {trashed && <div className="notice warn" style={{ marginBottom: 12 }}>この銘柄はゴミ箱にあります。<button type="button" className="btn small" onClick={async () => { await restoreSecurity(trashed); nav(`/holdings/${encodeURIComponent(trashed)}`); }}>復元する</button></div>}
        <div className="field"><label htmlFor="name">企業名</label><input id="name" type="text" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder={f.country === 'JP' ? '銘柄コードを入れると自動入力されます' : '例: Coca-Cola'} />{errors.name && <span className="err">{errors.name}</span>}</div>
        <div className="grid2">
          <div className="field"><label>市場</label>
            <select value={f.market} onChange={(e) => set('market', e.target.value as Market)}>
              {Object.entries(MARKET_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></div>
          <div className="field"><label>口座区分</label>
            <select value={f.account} onChange={(e) => set('account', e.target.value as AccountType)}>
              <option value="taxable">特定・一般（課税）</option><option value="nisa">NISA（非課税）</option>
            </select></div>
        </div>
      </Card>

      <Card title="保有内容">
        {qtyEditable ? (
          <>
            <div className="grid2">
              <div className="field"><label htmlFor="qty">保有株数</label><input id="qty" type="number" inputMode="decimal" min="0" step="any" value={f.quantity} onChange={(e) => set('quantity', e.target.value)} />{errors.quantity && <span className="err">{errors.quantity}</span>}</div>
              <div className="field"><label htmlFor="avg">平均取得単価（円）</label><input id="avg" type="number" inputMode="decimal" min="0" step="any" value={f.avgPrice} onChange={(e) => set('avgPrice', e.target.value)} />{errors.avgPrice && <span className="err">{errors.avgPrice}</span>}</div>
            </div>
            <div className="field"><label htmlFor="acq">取得日</label><input id="acq" type="date" value={f.acquiredDate} onChange={(e) => set('acquiredDate', e.target.value)} />{errors.acquiredDate && <span className="err">{errors.acquiredDate}</span>}</div>
            <div className="hint tiny dim">追加購入・売却は登録後に銘柄詳細の「売買履歴」から記録できます。保有株数と平均取得単価は売買履歴から自動計算されます。</div>
          </>
        ) : (
          <div className="notice">この銘柄は売買履歴が{trades.length}件あるため、保有株数（{f.quantity}株）と平均取得単価（{f.avgPrice}円）は売買履歴から自動計算されます。<Link to={`/holdings/${encodeURIComponent(secId!)}`}>売買履歴を編集する</Link></div>
        )}
      </Card>

      <Card title="株価・配当">
        <div className="grid2">
          <div className="field"><label htmlFor="cp">現在株価（円）</label><input id="cp" type="number" inputMode="decimal" min="0" step="any" value={f.currentPrice} onChange={(e) => set('currentPrice', e.target.value)} placeholder="手動入力" />{errors.currentPrice && <span className="err">{errors.currentPrice}</span>}</div>
          <div className="field"><label htmlFor="dps">1株当たり年間配当（円）</label><input id="dps" type="number" inputMode="decimal" min="0" step="any" value={f.annualDps} disabled={f.dpsUndecided} onChange={(e) => set('annualDps', e.target.value)} placeholder="会社予想" />{errors.annualDps && <span className="err">{errors.annualDps}</span>}</div>
        </div>
        <label className="row small muted" style={{ marginBottom: 12 }}><input type="checkbox" checked={f.dpsUndecided} onChange={(e) => set('dpsUndecided', e.target.checked)} />配当予想は「未定」</label>
        <div className="hint tiny dim" style={{ marginBottom: 12 }}>入力値は「手動入力」として入力日時とともに保存されます。自動取得を設定すると J-Quants の値で更新されます。</div>
        <div className="field"><label>配当権利確定月</label><MonthsPicker value={f.recordMonths} onChange={(v) => set('recordMonths', v)} /></div>
        <div className="field"><label>配当支払月</label><MonthsPicker value={f.payMonths} onChange={(v) => set('payMonths', v)} /><span className="hint">月別の予想配当・カレンダーで使います（例：3月・9月権利 → 6月・12月支払）</span></div>
      </Card>

      <Card title="メモ"><textarea value={f.memo} onChange={(e) => set('memo', e.target.value)} placeholder="株主優待、投資理由など" /></Card>
      {errors.form && <div className="notice warn" style={{ marginBottom: 12 }}>{errors.form}</div>}
      <div className="grid2" style={{ marginBottom: 20 }}>
        <button type="button" className="btn" onClick={() => nav(-1)}>キャンセル</button>
        <button type="submit" className="btn primary" disabled={saving}>{edit ? '保存' : '登録'}</button>
      </div>
    </form>
  );
}
