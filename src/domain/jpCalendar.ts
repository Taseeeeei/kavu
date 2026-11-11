import { parseYmd, toYmd } from './util';

/** 春分日・秋分日（1980-2099年の近似式） */
const vernalEquinox = (y: number) => Math.floor(20.8431 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
const autumnalEquinox = (y: number) => Math.floor(23.2488 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));

/** 第n月曜日 */
const nthMonday = (y: number, m: number, n: number) => {
  const first = new Date(y, m - 1, 1).getDay();
  const offset = (8 - first) % 7; // 最初の月曜までの日数
  return 1 + offset + (n - 1) * 7;
};

const cache = new Map<number, Set<string>>();

/** 日本の国民の祝日（振替休日・国民の休日を含む）。2020年以降のルールに基づく。 */
export function jpHolidays(y: number): Set<string> {
  const hit = cache.get(y);
  if (hit) return hit;
  const ymd = (m: number, d: number) => toYmd(new Date(y, m - 1, d));
  const base: string[] = [
    ymd(1, 1),
    ymd(1, nthMonday(y, 1, 2)), // 成人の日
    ymd(2, 11),
    ymd(2, 23), // 天皇誕生日
    ymd(3, vernalEquinox(y)),
    ymd(4, 29),
    ymd(5, 3), ymd(5, 4), ymd(5, 5),
    ymd(7, nthMonday(y, 7, 3)), // 海の日
    ymd(8, 11), // 山の日
    ymd(9, nthMonday(y, 9, 3)), // 敬老の日
    ymd(9, autumnalEquinox(y)),
    ymd(10, nthMonday(y, 10, 2)), // スポーツの日
    ymd(11, 3),
    ymd(11, 23),
  ];
  const set = new Set(base);
  // 国民の休日：祝日に挟まれた平日
  for (const d of base) {
    const next2 = parseYmd(d);
    next2.setDate(next2.getDate() + 2);
    const mid = parseYmd(d);
    mid.setDate(mid.getDate() + 1);
    if (set.has(toYmd(next2)) && !set.has(toYmd(mid)) && mid.getDay() !== 0) set.add(toYmd(mid));
  }
  // 振替休日：祝日が日曜なら、その後の最初の祝日でない日
  for (const d of [...set].sort()) {
    const dt = parseYmd(d);
    if (dt.getDay() === 0) {
      const sub = new Date(dt);
      do sub.setDate(sub.getDate() + 1);
      while (set.has(toYmd(sub)));
      set.add(toYmd(sub));
    }
  }
  cache.set(y, set);
  return set;
}

/** 東証の休業日（土日・祝日・年末年始 12/31〜1/3） */
export function isTseHoliday(d: Date): boolean {
  const day = d.getDay();
  if (day === 0 || day === 6) return true;
  const m = d.getMonth() + 1;
  const dd = d.getDate();
  if ((m === 12 && dd === 31) || (m === 1 && dd <= 3)) return true;
  return jpHolidays(d.getFullYear()).has(toYmd(d));
}

export const isBusinessDay = (d: Date) => !isTseHoliday(d);

export function shiftBusinessDays(ymd: string, n: number): string {
  const d = parseYmd(ymd);
  const step = n >= 0 ? 1 : -1;
  let left = Math.abs(n);
  while (left > 0) {
    d.setDate(d.getDate() + step);
    if (isBusinessDay(d)) left--;
  }
  return toYmd(d);
}

/** 月末の最終営業日 */
export function lastBusinessDayOfMonth(year: number, month: number): string {
  const d = new Date(year, month, 0);
  while (!isBusinessDay(d)) d.setDate(d.getDate() - 1);
  return toYmd(d);
}

export interface RightsDates {
  recordDate: string; // 権利確定日（月末基準日と仮定・推定）
  lastCumDate: string; // 権利付き最終日（2営業日前）
  exDate: string; // 権利落ち日（1営業日前）
}

/**
 * 月末を基準日とする場合の権利関連日（推定）。
 * 基準日が休業日の場合は直前の営業日を権利確定日とする（受渡はT+2）。
 */
export function rightsDatesForMonth(year: number, month: number): RightsDates {
  const recordDate = lastBusinessDayOfMonth(year, month);
  return {
    recordDate,
    lastCumDate: shiftBusinessDays(recordDate, -2),
    exDate: shiftBusinessDays(recordDate, -1),
  };
}
