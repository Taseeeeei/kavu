import type { DividendRecord } from './types';
import { addMonthsYmd, sum } from './util';

export type Basis = 'gross' | 'net';
const val = (r: DividendRecord, b: Basis) => (b === 'gross' ? r.gross : r.net);

export const inYear = (r: DividendRecord, year: number) => r.receivedDate.startsWith(`${year}-`);

/** 過去12か月：基準日の12か月前の翌日〜基準日 */
export const inLast12Months = (r: DividendRecord, today: string) =>
  r.receivedDate > addMonthsYmd(today, -12) && r.receivedDate <= today;

export function totalOf(records: DividendRecord[], basis: Basis, pred: (r: DividendRecord) => boolean = () => true) {
  return sum(records.filter(pred).map((r) => val(r, basis)));
}

/** 指定年の月別合計（12要素） */
export function monthlyTotals(records: DividendRecord[], year: number, basis: Basis): number[] {
  const out = new Array(12).fill(0);
  for (const r of records) {
    if (!inYear(r, year)) continue;
    const m = Number(r.receivedDate.slice(5, 7));
    out[m - 1] += val(r, basis);
  }
  return out;
}

/** 年別合計（古い順、記録のある最初の年〜指定年まで空の年も含む） */
export function yearlyTotals(records: DividendRecord[], basis: Basis, untilYear: number) {
  if (records.length === 0) return [] as { year: number; total: number; cumulative: number }[];
  const years = records.map((r) => Number(r.receivedDate.slice(0, 4)));
  const from = Math.min(...years);
  const to = Math.max(untilYear, Math.max(...years));
  const rows: { year: number; total: number; cumulative: number }[] = [];
  let cum = 0;
  for (let y = from; y <= to; y++) {
    const t = totalOf(records, basis, (r) => inYear(r, y));
    cum += t;
    rows.push({ year: y, total: t, cumulative: cum });
  }
  return rows;
}

/** 累計推移（受取日ごと） */
export function cumulativeSeries(records: DividendRecord[], basis: Basis) {
  const sorted = [...records].sort((a, b) => a.receivedDate.localeCompare(b.receivedDate));
  let cum = 0;
  const out: { date: string; cumulative: number }[] = [];
  for (const r of sorted) {
    cum += val(r, basis);
    const last = out[out.length - 1];
    if (last && last.date === r.receivedDate) last.cumulative = cum;
    else out.push({ date: r.receivedDate, cumulative: cum });
  }
  return out;
}

/** 前年同期比：今年の年初〜今日 と 前年の同期間 */
export function yearOverYear(records: DividendRecord[], today: string, basis: Basis) {
  const year = Number(today.slice(0, 4));
  const mmdd = today.slice(5);
  const thisYtd = totalOf(records, basis, (r) => inYear(r, year) && r.receivedDate.slice(5) <= mmdd);
  const lastYtd = totalOf(records, basis, (r) => inYear(r, year - 1) && r.receivedDate.slice(5) <= mmdd);
  const lastFull = totalOf(records, basis, (r) => inYear(r, year - 1));
  return {
    thisYtd,
    lastYtd,
    lastFull,
    diff: thisYtd - lastYtd,
    rate: lastYtd > 0 ? ((thisYtd - lastYtd) / lastYtd) * 100 : null,
  };
}

export interface CompanyDividendRow {
  securityId: string;
  code: string;
  name: string;
  cumulative: number;
  thisYear: number;
  last12: number;
  count: number;
  share: number; // 累計に占める割合 %
}

export function byCompany(records: DividendRecord[], today: string, basis: Basis): CompanyDividendRow[] {
  const year = Number(today.slice(0, 4));
  const map = new Map<string, DividendRecord[]>();
  for (const r of records) {
    const list = map.get(r.securityId) ?? [];
    list.push(r);
    map.set(r.securityId, list);
  }
  const rows: CompanyDividendRow[] = [];
  for (const [securityId, list] of map) {
    const latest = list.reduce((a, b) => (a.receivedDate >= b.receivedDate ? a : b));
    rows.push({
      securityId,
      code: latest.code,
      name: latest.name,
      cumulative: totalOf(list, basis),
      thisYear: totalOf(list, basis, (r) => inYear(r, year)),
      last12: totalOf(list, basis, (r) => inLast12Months(r, today)),
      count: list.length,
      share: 0,
    });
  }
  const total = sum(rows.map((r) => r.cumulative));
  for (const r of rows) r.share = total > 0 ? (r.cumulative / total) * 100 : 0;
  return rows.sort((a, b) => b.cumulative - a.cumulative);
}

/** 重複判定キー（同一銘柄・同一受取日・同一区分・同一税引前金額） */
export const dividendDedupKey = (r: Pick<DividendRecord, 'securityId' | 'receivedDate' | 'kind' | 'gross'>) =>
  `${r.securityId}|${r.receivedDate}|${r.kind}|${Math.round(r.gross)}`;
