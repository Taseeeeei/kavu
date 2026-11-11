export const round = (v: number, digits = 0): number => {
  const p = 10 ** digits;
  return Math.round((v + Number.EPSILON) * p) / p;
};

export const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

/** ローカル日付を YYYY-MM-DD で返す */
export const toYmd = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export const parseYmd = (s: string): Date => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export const addMonthsYmd = (ymd: string, months: number): string => {
  const d = parseYmd(ymd);
  const target = new Date(d.getFullYear(), d.getMonth() + months, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d.getDate(), last));
  return toYmd(target);
};

export const isValidYmd = (s: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = parseYmd(s);
  return toYmd(d) === s;
};

export const uid = (): string =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export const securityIdOf = (country: string, code: string): string => `${country}:${code.trim().toUpperCase()}`;
