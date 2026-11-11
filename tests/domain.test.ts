import { describe, it, expect } from 'vitest';
import { computePosition } from '../src/domain/position';
import { buildHolding, summarize, expectedMonthly, forecastDividendShare } from '../src/domain/portfolio';
import { withholdingTax, grossFromDps } from '../src/domain/tax';
import { byCompany, monthlyTotals, yearlyTotals, yearOverYear, inLast12Months, totalOf, cumulativeSeries } from '../src/domain/dividends';
import { detectDividendChange, toDpsPoints, dpsChanges, latestForecast } from '../src/domain/dividendChange';
import { jpHolidays, rightsDatesForMonth, isTseHoliday } from '../src/domain/jpCalendar';
import { parseCsv, toCsv, normalizeDate, parseNumber, parseMonths } from '../src/domain/csv';
import type { Trade, Security, DividendRecord, PriceQuote, DividendForecast } from '../src/domain/types';

const t = (side: 'buy' | 'sell', date: string, quantity: number, price: number, fee = 0, n = 0): Trade => ({
  id: `${date}-${side}-${n}`, securityId: 'JP:1111', side, date, quantity, price, fee, memo: '', createdAt: `2020-01-01T00:00:0${n}Z`,
});
const sec = (over: Partial<Security> = {}): Security => ({
  id: 'JP:1111', country: 'JP', code: '1111', name: 'A社', market: 'TSE_PRIME', currency: 'JPY', account: 'taxable',
  recordMonths: [3, 9], payMonths: [6, 12], memo: '', createdAt: '', updatedAt: '', ...over,
});
const price = (p: number, prev?: number): PriceQuote => ({ id: 'p', securityId: 'JP:1111', price: p, prevClose: prev ?? null, asOf: '2026-11-10', fetchedAt: '2026-11-10T00:00:00Z', source: 'manual' });
const fc = (v: number | null, fetchedAt = '2026-11-10T00:00:00Z'): DividendForecast => ({ id: fetchedAt, securityId: 'JP:1111', annualDps: v, asOf: '2026-11-10', fetchedAt, source: 'manual' });

describe('保有株数・平均取得単価（移動平均法）', () => {
  it('複数回購入で平均単価を計算する', () => {
    const p = computePosition([t('buy', '2024-01-10', 100, 1000), t('buy', '2024-02-10', 100, 1200)]);
    expect(p.quantity).toBe(200);
    expect(p.avgCost).toBe(1100);
    expect(p.costBasis).toBe(220000);
  });
  it('一部売却は平均単価を変えず、実現損益を計上する', () => {
    const p = computePosition([t('buy', '2024-01-10', 100, 1000), t('buy', '2024-02-10', 100, 1200), t('sell', '2024-03-01', 50, 1500)]);
    expect(p.quantity).toBe(150);
    expect(p.avgCost).toBe(1100);
    expect(p.costBasis).toBe(165000);
    expect(p.realizedPnl).toBe(20000); // (1500-1100)*50
  });
  it('売却後の追加購入で平均単価を再計算する', () => {
    const p = computePosition([t('buy', '2024-01-10', 100, 1000), t('sell', '2024-02-01', 50, 1200), t('buy', '2024-03-01', 50, 1300)]);
    expect(p.quantity).toBe(100);
    expect(p.avgCost).toBe(1150); // (50*1000 + 50*1300)/100
  });
  it('全株売却後の再購入は新しいポジションとして扱う', () => {
    const p = computePosition([t('buy', '2024-01-10', 100, 1000), t('sell', '2024-02-01', 100, 900), t('buy', '2024-05-01', 100, 800)]);
    expect(p.quantity).toBe(100);
    expect(p.avgCost).toBe(800);
    expect(p.realizedPnl).toBe(-10000);
    expect(p.firstAcquiredDate).toBe('2024-05-01');
  });
  it('手数料は取得額に含め、売却時は実現損益から差し引く', () => {
    const p = computePosition([t('buy', '2024-01-10', 100, 1000, 550), t('sell', '2024-02-01', 100, 1100, 550)]);
    expect(p.realizedPnl).toBeCloseTo(100 * 1100 - 550 - 100550, 6);
  });
  it('保有株数を超える売却はエラー', () => {
    const p = computePosition([t('buy', '2024-01-10', 100, 1000), t('sell', '2024-01-11', 200, 1000)]);
    expect(p.errors.length).toBe(1);
    expect(p.quantity).toBe(100);
  });
  it('同日の買いと売りは買いを先に処理する', () => {
    const p = computePosition([t('sell', '2024-01-10', 100, 1100, 0, 1), t('buy', '2024-01-10', 100, 1000, 0, 2)]);
    expect(p.errors).toEqual([]);
    expect(p.quantity).toBe(0);
    expect(p.realizedPnl).toBe(10000);
  });
});

describe('利回り・ポートフォリオ', () => {
  it('取得額ベース・時価ベース利回りを定義どおりに計算する', () => {
    const h = buildHolding(sec(), [t('buy', '2024-01-10', 100, 2000)], [price(2500, 2400)], [fc(100)]);
    expect(h.annualDividend).toBe(10000);
    expect(h.yieldOnCost).toBeCloseTo(10000 / 200000 * 100, 10); // 5%
    expect(h.currentYield).toBeCloseTo(4, 10); // 100/2500
    expect(h.marketValue).toBe(250000);
    expect(h.unrealizedPnl).toBe(50000);
    expect(h.unrealizedPnlRate).toBeCloseTo(25, 10);
    expect(h.dayChange).toBe(100);
    expect(h.annualDividendNet).toBeCloseTo(10000 * (1 - 0.20315), 6);
  });
  it('NISA口座は税引後=税引前', () => {
    const h = buildHolding(sec({ account: 'nisa' }), [t('buy', '2024-01-10', 100, 2000)], [], [fc(100)]);
    expect(h.annualDividendNet).toBe(10000);
  });
  it('最後に記録された配当予想を使う', () => {
    const h = buildHolding(sec(), [t('buy', '2024-01-10', 100, 2000)], [], [fc(100, '2026-01-01T00:00:00Z'), fc(120, '2026-02-01T00:00:00Z')]);
    expect(h.annualDps).toBe(120);
  });
  it('ポートフォリオ全体の利回りは合計値で計算する（単純平均ではない）', () => {
    const a = buildHolding(sec(), [t('buy', '2024-01-10', 100, 1000)], [price(1000)], [fc(50)]); // 5000円, cost 100000
    const b = buildHolding(sec({ id: 'JP:2222', code: '2222' }), [{ ...t('buy', '2024-01-10', 100, 3000), securityId: 'JP:2222' }], [price(4000)], [fc(30)]); // 3000円, cost 300000, mv 400000
    const s = summarize([a, b]);
    expect(s.totalCost).toBe(400000);
    expect(s.marketValue).toBe(500000);
    expect(s.annualDividend).toBe(8000);
    expect(s.yieldOnCost).toBeCloseTo(2, 10);
    expect(s.currentYield).toBeCloseTo(1.6, 10);
    expect(s.unrealizedPnl).toBe(100000);
    expect(s.monthlyAverageDividend).toBeCloseTo(8000 / 12, 10);
  });
  it('株価未入力の銘柄は評価額・含み損益から除外し件数を返す', () => {
    const a = buildHolding(sec(), [t('buy', '2024-01-10', 100, 1000)], [], [fc(50)]);
    const s = summarize([a]);
    expect(s.missingPrice).toBe(1);
    expect(s.currentYield).toBeNull();
    expect(s.yieldOnCost).toBeCloseTo(5, 10);
  });
  it('予想配当の月別按分と企業別構成', () => {
    const a = buildHolding(sec(), [t('buy', '2024-01-10', 100, 1000)], [], [fc(50)]);
    const m = expectedMonthly([a]);
    expect(m[5]).toBe(2500);
    expect(m[11]).toBe(2500);
    expect(forecastDividendShare([a])[0].share).toBe(100);
  });
});

describe('税金', () => {
  it('所得税と住民税をそれぞれ切り捨てる', () => {
    expect(withholdingTax(10000)).toBe(1531 + 500);
    expect(withholdingTax(3333)).toBe(Math.floor(3333 * 0.15315) + Math.floor(3333 * 0.05));
    expect(withholdingTax(10000, 'nisa')).toBe(0);
    expect(grossFromDps(12.5, 100)).toBe(1250);
    expect(grossFromDps(0.1 * 3, 10)).toBe(3);
  });
});

const d = (code: string, date: string, gross: number, net = Math.round(gross * 0.8)): DividendRecord => ({
  id: `${code}${date}`, securityId: `JP:${code}`, code, name: `${code}社`, receivedDate: date, dps: 0, shares: 0, gross, tax: gross - net, net, kind: 'final', memo: '', createdAt: '',
});

describe('配当集計', () => {
  const recs = [d('A', '2025-06-20', 30000), d('A', '2025-12-05', 20000), d('B', '2026-03-10', 30000), d('C', '2026-06-25', 20000), d('A', '2026-06-20', 0)];
  it('企業別の累計と割合', () => {
    const rows = byCompany([d('A', '2026-06-20', 50000), d('B', '2026-06-20', 30000), d('C', '2026-06-20', 20000)], '2026-11-11', 'gross');
    expect(rows.map((r) => [r.code, r.cumulative, r.share])).toEqual([['A', 50000, 50], ['B', 30000, 30], ['C', 20000, 20]]);
  });
  it('今年・過去12か月・月別・年別', () => {
    expect(totalOf(recs, 'gross', (r) => r.receivedDate.startsWith('2026'))).toBe(50000);
    expect(totalOf(recs, 'gross', (r) => inLast12Months(r, '2026-11-11'))).toBe(70000); // 2025-12-05以降
    expect(inLast12Months(d('X', '2025-11-11', 1), '2026-11-11')).toBe(false);
    expect(inLast12Months(d('X', '2025-11-12', 1), '2026-11-11')).toBe(true);
    const m = monthlyTotals(recs, 2026, 'gross');
    expect(m[2]).toBe(30000); expect(m[5]).toBe(20000);
    const y = yearlyTotals(recs, 'gross', 2026);
    expect(y).toEqual([{ year: 2025, total: 50000, cumulative: 50000 }, { year: 2026, total: 50000, cumulative: 100000 }]);
    expect(cumulativeSeries(recs, 'gross').at(-1)?.cumulative).toBe(100000);
  });
  it('前年同期比', () => {
    const r = yearOverYear(recs, '2026-07-01', 'gross');
    expect(r.thisYtd).toBe(50000);
    expect(r.lastYtd).toBe(30000);
    expect(r.diff).toBe(20000);
    expect(r.rate).toBeCloseTo(66.666, 2);
    expect(r.lastFull).toBe(50000);
  });
  it('税引後でも集計できる', () => {
    expect(totalOf([d('A', '2026-01-01', 10000, 7969)], 'net')).toBe(7969);
  });
});

describe('増配・減配の判定', () => {
  it('100円→120円・100株で増配額2,000円・増配率20%', () => {
    const r = detectDividendChange(100, 120, 100)!;
    expect(r.kind).toBe('increase');
    expect(r.diffPerShare).toBe(20);
    expect(r.rate).toBeCloseTo(20, 10);
    expect(r.annualImpact).toBe(2000);
  });
  it('減配・無配・復配・変化なし・未定', () => {
    expect(detectDividendChange(100, 80, 100)).toMatchObject({ kind: 'decrease', diffPerShare: -20, rate: -20, annualImpact: -2000 });
    expect(detectDividendChange(100, 0, 100)).toMatchObject({ kind: 'suspend', rate: -100, annualImpact: -10000 });
    expect(detectDividendChange(0, 30, 100)).toMatchObject({ kind: 'resume', rate: null, annualImpact: 3000 });
    expect(detectDividendChange(100, 100, 100)).toBeNull();
    expect(detectDividendChange(undefined, 100, 100)).toBeNull();
    expect(detectDividendChange(100, null, 100)).toBeNull();
  });
  it('J-Quants開示データから予想修正・前期実績比を検出する', () => {
    const recs = [
      { DiscDate: '2025-05-10', DiscTime: '15:00:00', Code: '11110', CurPerType: 'FY', CurFYEn: '2025-03-31', NxtFYEn: '2026-03-31', DivAnn: '100', NxFDivAnn: '110', DocType: 'FYFinancialStatements' },
      { DiscDate: '2025-08-05', DiscTime: '15:00:00', Code: '11110', CurPerType: '1Q', CurFYEn: '2026-03-31', FDivAnn: '110', DocType: '1QFinancialStatements' },
      { DiscDate: '2025-11-05', DiscTime: '15:00:00', Code: '11110', CurPerType: '2Q', CurFYEn: '2026-03-31', FDivAnn: '120', DocType: '2QFinancialStatements' },
      { DiscDate: '2026-02-05', DiscTime: '15:00:00', Code: '11110', CurPerType: '3Q', CurFYEn: '2026-03-31', FDivAnn: '', DocType: '3QFinancialStatements' },
    ];
    const pts = toDpsPoints(recs);
    const ch = dpsChanges(pts);
    expect(ch.map((c) => [c.reference.value, c.point.value, c.basis.slice(0, 4)])).toEqual([[100, 110, '前期実績'], [110, 120, '前回予想']]);
    expect(latestForecast(pts)?.value).toBe(120);
  });
});

describe('東証カレンダー', () => {
  it('祝日・振替休日', () => {
    const h = jpHolidays(2026);
    expect(h.has('2026-01-12')).toBe(true); // 成人の日
    expect(h.has('2026-03-20')).toBe(true); // 春分の日
    expect(h.has('2026-05-06')).toBe(true); // 振替休日（5/3が日曜）
    expect(h.has('2026-09-22')).toBe(true); // 国民の休日（敬老の日9/21と秋分9/23に挟まれる）
    expect(h.has('2026-09-23')).toBe(true);
    expect(isTseHoliday(new Date(2026, 11, 31))).toBe(true);
  });
  it('3月末基準の権利付き最終日・権利落ち日', () => {
    // 2026-03-31(火) → 権利付最終日 3/27(金)、権利落ち日 3/30(月)
    expect(rightsDatesForMonth(2026, 3)).toEqual({ recordDate: '2026-03-31', lastCumDate: '2026-03-27', exDate: '2026-03-30' });
    // 2025-09-30(火) → 9/26(金), 9/29(月)
    expect(rightsDatesForMonth(2025, 9)).toEqual({ recordDate: '2025-09-30', lastCumDate: '2025-09-26', exDate: '2025-09-29' });
    // 2024-03-31(日)は休業日 → 権利確定日 3/29(金)、最終日 3/27、落ち日 3/28
    expect(rightsDatesForMonth(2024, 3)).toEqual({ recordDate: '2024-03-29', lastCumDate: '2024-03-27', exDate: '2024-03-28' });
  });
});

describe('CSV', () => {
  it('引用符・改行・カンマを往復できる', () => {
    const csv = toCsv(['a', 'b'], [['x,"y"', '1\n2']]);
    expect(parseCsv(csv)).toEqual([['a', 'b'], ['x,"y"', '1\n2']]);
  });
  it('日付・数値・月の正規化', () => {
    expect(normalizeDate('2024/3/5')).toBe('2024-03-05');
    expect(normalizeDate('2024-02-30')).toBeNull();
    expect(parseNumber('1,234円')).toBe(1234);
    expect(parseNumber('１２．５')).toBe(12.5);
    expect(parseMonths('3、9')).toEqual([3, 9]);
  });
});
