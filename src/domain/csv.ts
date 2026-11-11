/** RFC4180準拠の最小CSVパーサ／シリアライザ */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x !== '')) rows.push(row);
  return rows;
}

const esc = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(header: string[], rows: unknown[][]): string {
  return '﻿' + [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
}

/** ヘッダ行をキーにしたオブジェクト配列へ */
export function csvToObjects(text: string): { header: string[]; rows: Record<string, string>[] } {
  const all = parseCsv(text);
  if (all.length === 0) return { header: [], rows: [] };
  const header = all[0].map((h) => h.trim());
  const rows = all.slice(1).map((r) => {
    const o: Record<string, string> = {};
    header.forEach((h, i) => (o[h] = (r[i] ?? '').trim()));
    return o;
  });
  return { header, rows };
}

/** UTF-8（BOM可）優先、失敗したらShift_JISとして読む */
export function decodeCsvBytes(buf: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('shift_jis').decode(buf);
  }
}

export const parseNumber = (s: string): number | null => {
  if (s === undefined || s === null) return null;
  const t = String(s).replace(/[,，円¥￥\s]/g, '').replace(/[０-９．－]/g, (c) =>
    c === '．' ? '.' : c === '－' ? '-' : String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  if (t === '') return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
};

export const parseMonths = (s: string): number[] =>
  Array.from(new Set((s || '').split(/[\s,、・/|;]+/).map((x) => parseInt(x, 10)).filter((m) => m >= 1 && m <= 12))).sort((a, b) => a - b);

/** 2024/3/5 や 2024-03-05 を YYYY-MM-DD に */
export const normalizeDate = (s: string): string | null => {
  const m = (s || '').trim().match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/);
  if (!m) return null;
  const out = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getMonth() + 1 === Number(m[2]) && d.getDate() === Number(m[3]) ? out : null;
};
