import { parseCsv, parseNumber } from '../domain/csv';

/**
 * Googleスプレッドシート（GOOGLEFINANCE関数）を「ウェブに公開（CSV）」したものから株価を読む。
 * 列: A=銘柄コード, B=株価(price), C=前日終値(closeyest・任意), D=取引時刻(tradetime・任意)
 * 1行目が見出しでもよい（コード列が銘柄コードの形でない行は無視する）。
 * GOOGLEFINANCE の株価は最大20分程度遅延する（Google の仕様）。
 */
export interface SheetQuote { code: string; price: number; prevClose: number | null; date: string | null }
export interface SheetParseResult { quotes: SheetQuote[]; invalid: string[] }

const CODE_RE = /^(?:TYO:)?([0-9][0-9A-Z]{3})$/i;

const toDate = (s: string): string | null => {
  const m = (s || '').trim().match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null;
};

export function parseSheetCsv(text: string): SheetParseResult {
  const quotes: SheetQuote[] = [];
  const invalid: string[] = [];
  for (const row of parseCsv(text)) {
    const m = (row[0] ?? '').trim().match(CODE_RE);
    if (!m) continue;
    const code = m[1].toUpperCase();
    const price = parseNumber(row[1] ?? '');
    if (price === null || price <= 0) { invalid.push(code); continue; }
    const prev = parseNumber(row[2] ?? '');
    quotes.push({ code, price, prevClose: prev !== null && prev > 0 ? prev : null, date: toDate(row[3] ?? '') });
  }
  return { quotes, invalid };
}

export function checkSheetUrl(url: string): string | null {
  const u = url.trim();
  if (!u) return null;
  if (!/^https:\/\/docs\.google\.com\/spreadsheets\//.test(u)) return 'Googleスプレッドシートの「ウェブに公開」で作ったURLを貼ってください';
  if (/\/edit/.test(u) || !/output=csv/.test(u)) return '「ウェブに公開」で形式を「カンマ区切り形式（.csv）」にしたURLを貼ってください（/edit で終わるURLは使えません）';
  return null;
}

export async function fetchSheetQuotes(url: string, fetchImpl: typeof fetch = fetch.bind(globalThis)): Promise<SheetParseResult> {
  const sep = url.includes('?') ? '&' : '?';
  let res: Response;
  try {
    res = await fetchImpl(`${url}${sep}_=${Date.now()}`, { cache: 'no-store' });
  } catch {
    throw new Error('スプレッドシートに接続できません（URL・公開設定・ネット接続を確認してください）');
  }
  if (!res.ok) throw new Error(`スプレッドシートを読み込めません（${res.status}）。「ウェブに公開」されているか確認してください`);
  const text = await res.text();
  if (/^\s*<!DOCTYPE html|<html/i.test(text)) throw new Error('CSVではなくWebページが返りました。公開形式を「カンマ区切り形式（.csv）」にしてください');
  return parseSheetCsv(text);
}
