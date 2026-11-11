import type { Market } from '../domain/types';

/**
 * JPX「東証上場銘柄一覧」から作った銘柄辞書（public/stocks.json）。
 * 公開時（GitHub Actions）に毎回JPXから取得して同梱する。オフラインでも使えるようキャッシュされる。
 */
export interface ListedStock { code: string; name: string; market: Market; marketLabel: string; sector: string }
export interface StockList { asOf: string; source: string; sourceUrl: string; byCode: Map<string, ListedStock> }

let cache: Promise<StockList | null> | null = null;

export function loadStockList(fetchImpl: typeof fetch = fetch.bind(globalThis)): Promise<StockList | null> {
  if (!cache) {
    cache = (async () => {
      try {
        const res = await fetchImpl('stocks.json');
        if (!res.ok) return null;
        const j = (await res.json()) as { asOf: string; source: string; sourceUrl: string; data: [string, string, Market, string, string][] };
        const byCode = new Map<string, ListedStock>();
        for (const [code, name, market, marketLabel, sector] of j.data) byCode.set(code, { code, name, market, marketLabel, sector });
        return { asOf: j.asOf, source: j.source, sourceUrl: j.sourceUrl, byCode };
      } catch {
        return null;
      }
    })();
    cache.then((v) => { if (!v) cache = null; }); // 取得失敗時は次回再試行
  }
  return cache;
}

export async function lookupStock(code: string): Promise<{ stock: ListedStock | null; list: StockList | null }> {
  const list = await loadStockList();
  return { stock: list?.byCode.get(code.trim().toUpperCase()) ?? null, list };
}

/** テスト用 */
export const _resetStockList = () => { cache = null; };
