import type { DividendForecast, PriceQuote, Security, Trade, AccountType } from './types';
import { computePosition, type Position } from './position';
import { estimateNet, DEFAULT_TAX_RATE } from './tax';
import { sum } from './util';

export interface HoldingView {
  security: Security;
  position: Position;
  price: PriceQuote | null;
  forecast: DividendForecast | null;
  /** 現在の評価額（株価未入力なら null） */
  marketValue: number | null;
  unrealizedPnl: number | null;
  unrealizedPnlRate: number | null; // %
  annualDps: number | null; // 1株年間予想配当（未入力・未定は null）
  annualDividend: number; // 保有株数×年間予想配当（税引前）
  annualDividendNet: number; // 推定税引後
  /** 取得価格ベース利回り = 年間予想配当 ÷ 取得総額 × 100 */
  yieldOnCost: number | null;
  /** 時価ベース利回り = 年間予想配当 ÷ 評価額 × 100 */
  currentYield: number | null;
  dayChange: number | null;
  dayChangeRate: number | null;
}

/** 最新のスナップショットを選ぶ（日付→取得日時の順） */
export function latestBy<T extends { asOf: string; fetchedAt: string }>(xs: T[]): T | null {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => {
    if (a.asOf !== b.asOf) return a.asOf > b.asOf ? a : b;
    return a.fetchedAt >= b.fetchedAt ? a : b;
  });
}

/** 配当予想は「最後に記録されたもの」を現在値とする（後からの手動修正・新しい取得を優先） */
export function latestRecorded<T extends { fetchedAt: string }>(xs: T[]): T | null {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => (a.fetchedAt >= b.fetchedAt ? a : b));
}

export function buildHolding(
  security: Security,
  trades: Trade[],
  prices: PriceQuote[],
  forecasts: DividendForecast[],
  taxRate = DEFAULT_TAX_RATE,
): HoldingView {
  const position = computePosition(trades);
  const price = latestBy(prices);
  const forecast = latestRecorded(forecasts);
  const qty = position.quantity;
  const marketValue = price ? qty * price.price : null;
  const unrealizedPnl = marketValue !== null ? marketValue - position.costBasis : null;
  const unrealizedPnlRate =
    unrealizedPnl !== null && position.costBasis > 0 ? (unrealizedPnl / position.costBasis) * 100 : null;
  const annualDps = forecast ? forecast.annualDps : null;
  const annualDividend = annualDps !== null ? annualDps * qty : 0;
  const annualDividendNet = estimateNet(annualDividend, security.account, taxRate);
  const yieldOnCost =
    annualDps !== null && position.costBasis > 0 ? (annualDividend / position.costBasis) * 100 : null;
  const currentYield = annualDps !== null && price && price.price > 0 ? (annualDps / price.price) * 100 : null;
  const dayChange = price && price.prevClose ? price.price - price.prevClose : null;
  const dayChangeRate = price && price.prevClose ? ((price.price - price.prevClose) / price.prevClose) * 100 : null;
  return {
    security, position, price, forecast, marketValue, unrealizedPnl, unrealizedPnlRate,
    annualDps, annualDividend, annualDividendNet, yieldOnCost, currentYield, dayChange, dayChangeRate,
  };
}

export interface PortfolioSummary {
  holdingCount: number;
  totalCost: number;
  /** 株価が入力されている銘柄のみの評価額 */
  marketValue: number;
  /** 株価が入力されている銘柄の取得額（含み損益の計算対象） */
  pricedCost: number;
  pricedCount: number;
  unrealizedPnl: number;
  unrealizedPnlRate: number | null;
  annualDividend: number; // 税引前
  annualDividendNet: number; // 推定税引後
  monthlyAverageDividend: number;
  monthlyAverageDividendNet: number;
  /** 取得額ベース利回り = 年間予想配当金合計 ÷ 取得総額 × 100 */
  yieldOnCost: number | null;
  /** 時価ベース利回り = 年間予想配当金合計 ÷ 現在評価額 × 100（株価入力済み銘柄で計算） */
  currentYield: number | null;
  missingPrice: number;
  missingForecast: number;
}

export function summarize(holdings: HoldingView[]): PortfolioSummary {
  const active = holdings.filter((h) => h.position.quantity > 0);
  const priced = active.filter((h) => h.marketValue !== null);
  const totalCost = sum(active.map((h) => h.position.costBasis));
  const marketValue = sum(priced.map((h) => h.marketValue as number));
  const pricedCost = sum(priced.map((h) => h.position.costBasis));
  const annualDividend = sum(active.map((h) => h.annualDividend));
  const annualDividendNet = sum(active.map((h) => h.annualDividendNet));
  const pricedDividend = sum(priced.map((h) => h.annualDividend));
  const unrealizedPnl = marketValue - pricedCost;
  return {
    holdingCount: active.length,
    totalCost,
    marketValue,
    pricedCost,
    pricedCount: priced.length,
    unrealizedPnl,
    unrealizedPnlRate: pricedCost > 0 ? (unrealizedPnl / pricedCost) * 100 : null,
    annualDividend,
    annualDividendNet,
    monthlyAverageDividend: annualDividend / 12,
    monthlyAverageDividendNet: annualDividendNet / 12,
    yieldOnCost: totalCost > 0 ? (annualDividend / totalCost) * 100 : null,
    currentYield: marketValue > 0 ? (pricedDividend / marketValue) * 100 : null,
    missingPrice: active.length - priced.length,
    missingForecast: active.filter((h) => h.annualDps === null).length,
  };
}

/** 保有銘柄別の構成比（評価額。株価未入力は取得額で代用し、その旨を返す） */
export function allocation(holdings: HoldingView[]) {
  const active = holdings.filter((h) => h.position.quantity > 0);
  const rows = active.map((h) => ({
    id: h.security.id,
    name: h.security.name,
    code: h.security.code,
    value: h.marketValue ?? h.position.costBasis,
    estimated: h.marketValue === null,
  }));
  const total = sum(rows.map((r) => r.value));
  return rows
    .map((r) => ({ ...r, share: total > 0 ? (r.value / total) * 100 : 0 }))
    .sort((a, b) => b.value - a.value);
}

/** 年間予想配当金の企業別構成 */
export function forecastDividendShare(holdings: HoldingView[], net = false) {
  const rows = holdings
    .filter((h) => h.position.quantity > 0 && h.annualDividend > 0)
    .map((h) => ({ id: h.security.id, name: h.security.name, code: h.security.code, value: net ? h.annualDividendNet : h.annualDividend }));
  const total = sum(rows.map((r) => r.value));
  return rows.map((r) => ({ ...r, share: total > 0 ? (r.value / total) * 100 : 0 })).sort((a, b) => b.value - a.value);
}

/** 支払月に応じて年間予想配当を月別に按分（推定） */
export function expectedMonthly(holdings: HoldingView[], net = false): number[] {
  const months = new Array(12).fill(0);
  for (const h of holdings) {
    if (h.position.quantity <= 0 || h.annualDividend <= 0) continue;
    const pay = h.security.payMonths.length ? h.security.payMonths : [];
    if (pay.length === 0) continue;
    const v = (net ? h.annualDividendNet : h.annualDividend) / pay.length;
    for (const m of pay) months[m - 1] += v;
  }
  return months;
}

export const accountLabel = (a: AccountType) => (a === 'nisa' ? 'NISA' : '課税口座');
