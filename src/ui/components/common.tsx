import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { tone } from '../../domain/format';
import { SOURCE_LABELS, type DataSource } from '../../domain/types';
import { dateTime } from '../../domain/format';

export function Card({ title, right, children, className = '' }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {title !== undefined && <h2>{title}<span className="spacer" />{right}</h2>}
      {children}
    </section>
  );
}

export function Stat({ label, value, sub, toneOf, onClick }: { label: ReactNode; value: ReactNode; sub?: ReactNode; toneOf?: number | null; onClick?: () => void }) {
  const cls = toneOf === undefined ? '' : tone(toneOf);
  return (
    <div className="stat" onClick={onClick} style={onClick ? { cursor: 'pointer' } : undefined}>
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${cls}`}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function Empty({ title, text, action }: { title: string; text?: ReactNode; action?: ReactNode }) {
  return <div className="empty"><div className="t">{title}</div>{text && <p>{text}</p>}{action}</div>;
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="tablist">
      {options.map((o) => <button key={o.value} type="button" className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>{o.label}</button>)}
    </div>
  );
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = ''; };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <h3>{title}</h3>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** 確認ダイアログ（誤操作防止）。window.confirm は使わない。 */
interface ConfirmOpts { title: string; message: ReactNode; okLabel?: string; danger?: boolean; requireText?: string }
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false);
const ToastCtx = createContext<(msg: string) => void>(() => {});
export const useConfirm = () => useContext(ConfirmCtx);
export const useToast = () => useContext(ToastCtx);

export function UiProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const [typed, setTyped] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const confirm = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => { setTyped(''); setState({ ...o, resolve }); }), []);
  const showToast = useCallback((m: string) => { setToast(m); }, []);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 3200); return () => clearTimeout(id); }, [toast]);
  const close = (v: boolean) => { state?.resolve(v); setState(null); };
  return (
    <ConfirmCtx.Provider value={confirm}>
      <ToastCtx.Provider value={showToast}>
        {children}
        <Sheet open={!!state} onClose={() => close(false)} title={state?.title ?? ''}>
          <div style={{ marginBottom: 14, fontSize: 14 }}>{state?.message}</div>
          {state?.requireText && (
            <div className="field">
              <label>確認のため「{state.requireText}」と入力してください</label>
              <input type="text" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
            </div>
          )}
          <div className="grid2">
            <button className="btn" onClick={() => close(false)}>キャンセル</button>
            <button className={`btn ${state?.danger ? 'danger' : 'primary'}`} disabled={!!state?.requireText && typed !== state.requireText} onClick={() => close(true)}>{state?.okLabel ?? 'OK'}</button>
          </div>
        </Sheet>
        {toast && <div className="toast" role="status">{toast}</div>}
      </ToastCtx.Provider>
    </ConfirmCtx.Provider>
  );
}

export function SourceTag({ source, at, detail }: { source: DataSource; at?: string; detail?: string }) {
  return (
    <span className="tiny dim" title={detail}>
      情報源: {SOURCE_LABELS[source]}{at ? `・${source === 'manual' ? '入力' : '取得'} ${dateTime(at)}` : ''}
    </span>
  );
}

export function MonthsPicker({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  return (
    <div className="months">
      {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
        <button key={m} type="button" className={value.includes(m) ? 'on' : ''}
          onClick={() => onChange(value.includes(m) ? value.filter((x) => x !== m) : [...value, m].sort((a, b) => a - b))}>{m}月</button>
      ))}
    </div>
  );
}

export const download = (filename: string, content: string, mime = 'text/csv;charset=utf-8') => {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
