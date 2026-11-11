import type { AccountType } from './types';

/** 上場株式等の配当にかかる源泉徴収税率（所得税・復興特別所得税15.315% + 住民税5%） */
export const INCOME_TAX_RATE = 0.15315;
export const RESIDENT_TAX_RATE = 0.05;
export const DEFAULT_TAX_RATE = INCOME_TAX_RATE + RESIDENT_TAX_RATE; // 0.20315

/**
 * 実際の源泉徴収額（所得税と住民税をそれぞれ1円未満切り捨て）。
 * NISA口座（株式数比例配分方式）は非課税。
 */
export function withholdingTax(gross: number, account: AccountType = 'taxable'): number {
  if (account === 'nisa' || gross <= 0) return 0;
  const g = Math.floor(gross);
  return Math.floor(g * INCOME_TAX_RATE) + Math.floor(g * RESIDENT_TAX_RATE);
}

/** 推定の税引後金額（予想配当など、端数処理なしの推計用） */
export function estimateNet(gross: number, account: AccountType = 'taxable', rate = DEFAULT_TAX_RATE): number {
  if (account === 'nisa') return gross;
  return gross * (1 - rate);
}

/** 1株配当×株数から税引前配当金（1円未満切り捨て） */
export const grossFromDps = (dps: number, shares: number): number => Math.floor(dps * shares + 1e-9);
