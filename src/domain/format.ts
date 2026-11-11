const yenFmt = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 0 });
const yenFmt2 = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 2 });

export const yen = (v: number | null | undefined, digits = 0): string =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : `${(digits ? yenFmt2 : yenFmt).format(digits ? v : Math.round(v))}円`;

export const signedYen = (v: number | null | undefined): string =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : '±'}${yenFmt.format(Math.abs(Math.round(v)))}円`;

export const pct = (v: number | null | undefined, digits = 2): string =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v.toFixed(digits)}%`;

export const signedPct = (v: number | null | undefined, digits = 2): string =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(digits)}%`;

export const num = (v: number | null | undefined, digits = 0): string =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : new Intl.NumberFormat('ja-JP', { maximumFractionDigits: digits }).format(v);

export const dps = (v: number | null | undefined): string =>
  v === null || v === undefined ? '未定' : `${yenFmt2.format(v)}円`;

export const dateTime = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
};

export const shortYen = (v: number): string => {
  const a = Math.abs(v);
  if (a >= 1e8) return `${(v / 1e8).toFixed(1)}億`;
  if (a >= 1e4) return `${(v / 1e4).toFixed(a >= 1e5 ? 0 : 1)}万`;
  return `${Math.round(v)}`;
};

export const tone = (v: number | null | undefined): 'up' | 'down' | 'flat' =>
  v === null || v === undefined || v === 0 ? 'flat' : v > 0 ? 'up' : 'down';
