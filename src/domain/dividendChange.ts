import type { ChangeKind } from './types';

export interface ChangeResult {
  kind: ChangeKind;
  before: number;
  after: number;
  diffPerShare: number;
  rate: number | null;
  annualImpact: number;
}

/**
 * 1株あたり年間配当の変更を判定する。
 * - before が未知（undefined/null=未定）や after が null（未定）の場合は判定しない
 * - 同額なら変更なし
 */
export function detectDividendChange(
  before: number | null | undefined,
  after: number | null | undefined,
  sharesHeld: number,
): ChangeResult | null {
  if (before === null || before === undefined || after === null || after === undefined) return null;
  if (!Number.isFinite(before) || !Number.isFinite(after)) return null;
  const diff = Math.round((after - before) * 1e6) / 1e6;
  if (diff === 0) return null;
  let kind: ChangeKind;
  if (after === 0) kind = 'suspend';
  else if (before === 0) kind = 'resume';
  else kind = diff > 0 ? 'increase' : 'decrease';
  return {
    kind,
    before,
    after,
    diffPerShare: diff,
    rate: before > 0 ? (diff / before) * 100 : null,
    annualImpact: diff * sharesHeld,
  };
}

/** J-Quants 決算短信サマリー（/v2/fins/summary）のレコード（使う項目のみ） */
export interface FinSummaryRecord {
  DiscDate: string;
  DiscTime?: string;
  Code: string;
  DocType?: string;
  CurPerType?: string;
  CurFYEn?: string;
  NxtFYEn?: string;
  DivAnn?: string;
  FDivAnn?: string;
  NxFDivAnn?: string;
}

export interface DpsPoint {
  key: string; // 開示日時（並び順・処理済み判定用）
  discDate: string;
  fyEnd: string;
  value: number | null; // null は「未定」（空欄・"－"等）
  type: 'forecast' | 'actual';
  docType: string;
}

const num = (s: string | undefined): number | null | undefined => {
  if (s === undefined) return undefined;
  const t = s.trim();
  if (t === '') return undefined; // 項目なし
  const v = Number(t);
  return Number.isFinite(v) ? v : null; // 数値以外（"－" 等）は未定扱い
};

/** 開示レコード群から年間配当（予想・実績）の時系列を作る */
export function toDpsPoints(records: FinSummaryRecord[]): DpsPoint[] {
  const pts: DpsPoint[] = [];
  for (const r of records) {
    const key = `${r.DiscDate}T${r.DiscTime ?? '00:00:00'}`;
    const docType = r.DocType ?? '';
    if (r.CurPerType === 'FY') {
      const act = num(r.DivAnn);
      if (act !== undefined && r.CurFYEn) pts.push({ key, discDate: r.DiscDate, fyEnd: r.CurFYEn, value: act, type: 'actual', docType });
      const nx = num(r.NxFDivAnn);
      if (nx !== undefined && r.NxtFYEn) pts.push({ key, discDate: r.DiscDate, fyEnd: r.NxtFYEn, value: nx, type: 'forecast', docType });
    } else {
      const f = num(r.FDivAnn);
      if (f !== undefined && r.CurFYEn) pts.push({ key, discDate: r.DiscDate, fyEnd: r.CurFYEn, value: f, type: 'forecast', docType });
    }
  }
  return pts.sort((a, b) => (a.key === b.key ? a.fyEnd.localeCompare(b.fyEnd) : a.key.localeCompare(b.key)));
}

export interface PointChange {
  point: DpsPoint;
  reference: DpsPoint;
  basis: string;
}

/**
 * 各予想値を「比較対象」と比べて変化を列挙する。
 * 比較対象: 同じ事業年度の直前の予想（予想修正） → なければ前期の実績（前期実績比）。
 */
export function dpsChanges(points: DpsPoint[]): PointChange[] {
  const out: PointChange[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.type !== 'forecast' || p.value === null) continue;
    const earlier = points.slice(0, i).filter((q) => q.key < p.key || (q.key === p.key && q !== p));
    const sameFy = earlier.filter((q) => q.type === 'forecast' && q.fyEnd === p.fyEnd && q.value !== null);
    let reference: DpsPoint | undefined = sameFy[sameFy.length - 1];
    let basis = '前回予想比（配当予想の修正）';
    if (!reference) {
      const prevActual = earlier.filter((q) => q.type === 'actual' && q.fyEnd < p.fyEnd && q.value !== null);
      reference = prevActual.sort((a, b) => a.fyEnd.localeCompare(b.fyEnd))[prevActual.length - 1];
      basis = '前期実績比（新年度の配当予想）';
    }
    if (!reference || reference.value === null) continue;
    if (Math.abs(reference.value - p.value) < 1e-9) continue;
    out.push({ point: p, reference, basis });
  }
  return out;
}

/** 最新の年間配当予想（最も新しい開示の、最も先の事業年度の予想） */
export function latestForecast(points: DpsPoint[]): DpsPoint | null {
  const f = points.filter((p) => p.type === 'forecast');
  if (f.length === 0) return null;
  return f.reduce((a, b) => (a.key !== b.key ? (a.key > b.key ? a : b) : a.fyEnd >= b.fyEnd ? a : b));
}
