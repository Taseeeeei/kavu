import type { Trade } from './types';

export interface Position {
  quantity: number;
  /** 保有分の取得総額（移動平均法・手数料込み） */
  costBasis: number;
  /** 平均取得単価 */
  avgCost: number;
  /** 実現損益（売却分） */
  realizedPnl: number;
  /** 現在のポジションを持ち始めた日（全株売却後に再購入した場合はその日） */
  firstAcquiredDate: string | null;
  totalBought: number;
  totalSold: number;
  errors: string[];
}

export const sortTrades = (trades: Trade[]): Trade[] =>
  [...trades].sort((a, b) =>
    a.date === b.date
      ? (a.side === b.side ? a.createdAt.localeCompare(b.createdAt) : a.side === 'buy' ? -1 : 1)
      : a.date.localeCompare(b.date),
  );

/**
 * 売買履歴から保有株数・平均取得単価を計算する（移動平均法）。
 * - 買付: 取得総額 += 株数×単価 + 手数料、平均単価 = 取得総額 ÷ 株数
 * - 売却: 平均単価は変わらず、取得総額 -= 平均単価×売却株数
 *         実現損益 += 売却株数×売却単価 − 手数料 − 平均単価×売却株数
 * 同日の買いと売りは買いを先に処理する。
 */
export function computePosition(trades: Trade[]): Position {
  let qty = 0;
  let cost = 0;
  let realized = 0;
  let first: string | null = null;
  let bought = 0;
  let sold = 0;
  const errors: string[] = [];

  for (const t of sortTrades(trades)) {
    if (!(t.quantity > 0) || !(t.price >= 0)) {
      errors.push(`${t.date} の取引の株数または単価が不正です`);
      continue;
    }
    const fee = t.fee || 0;
    if (t.side === 'buy') {
      if (qty === 0) first = t.date;
      qty += t.quantity;
      cost += t.quantity * t.price + fee;
      bought += t.quantity;
    } else {
      if (t.quantity > qty + 1e-9) {
        errors.push(`${t.date} の売却株数（${t.quantity}）が保有株数（${qty}）を超えています`);
        continue;
      }
      const avg = qty > 0 ? cost / qty : 0;
      realized += t.quantity * t.price - fee - avg * t.quantity;
      cost -= avg * t.quantity;
      qty -= t.quantity;
      sold += t.quantity;
      if (qty < 1e-9) {
        qty = 0;
        cost = 0;
        first = null;
      }
    }
  }
  return {
    quantity: qty,
    costBasis: cost,
    avgCost: qty > 0 ? cost / qty : 0,
    realizedPnl: realized,
    firstAcquiredDate: first,
    totalBought: bought,
    totalSold: sold,
    errors,
  };
}

/** 指定日時点の保有株数（配当対象株数の初期値に使う） */
export function quantityAt(trades: Trade[], date: string): number {
  return computePosition(trades.filter((t) => t.date <= date)).quantity;
}
