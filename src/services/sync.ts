import { db } from '../db/db';
import { loadSettings, saveSettings } from '../db/settings';
import { addPrice, laterThan } from '../db/repo';
import { latestRecorded } from '../domain/portfolio';
import { JQuantsProvider, PLAN_LABEL } from '../data/jquants';
import { fetchSheetQuotes } from '../data/sheetPrices';
import { toYmd } from '../domain/util';
import { RateLimitError, ProviderConfigError } from '../data/provider';
import { toDpsPoints, dpsChanges, latestForecast, detectDividendChange } from '../domain/dividendChange';
import { computePosition } from '../domain/position';
import type { DividendChangeEvent, Security, Market } from '../domain/types';
import { showSystemNotifications } from './notify';

export interface SyncReport {
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  prices: number;
  forecasts: number;
  newEvents: DividendChangeEvent[];
  historyEvents: number;
  errors: string[];
  skipped: string[];
}

const log = (level: 'info' | 'warn' | 'error', message: string) => db.syncLogs.add({ at: new Date().toISOString(), level, message });

const marketFromName = (n: string): Market | null =>
  n.includes('プライム') ? 'TSE_PRIME' : n.includes('スタンダード') ? 'TSE_STANDARD' : n.includes('グロース') ? 'TSE_GROWTH' : null;

export function isSyncConfigured(s: { proxyUrl: string; sheetUrl?: string }) { return !!s.proxyUrl.trim() || !!s.sheetUrl?.trim(); }

let running: Promise<SyncReport> | null = null;

/** 保有中の日本株について株価・配当予想を取得し、増減配を検知する */
export function syncAll(opts: { onProgress?: (msg: string) => void; reg?: ServiceWorkerRegistration } = {}): Promise<SyncReport> {
  if (running) return running;
  running = doSync(opts).finally(() => { running = null; });
  return running;
}

async function doSync({ onProgress, reg }: { onProgress?: (msg: string) => void; reg?: ServiceWorkerRegistration }): Promise<SyncReport> {
  const settings = await loadSettings();
  const report: SyncReport = { ok: true, startedAt: new Date().toISOString(), finishedAt: '', prices: 0, forecasts: 0, newEvents: [], historyEvents: 0, errors: [], skipped: [] };
  if (!isSyncConfigured(settings)) {
    report.ok = false;
    report.errors.push('自動取得は未設定です（設定 → データ取得 で登録してください）');
    return report;
  }
  const secs = (await db.securities.toArray()).filter((s) => !s.deletedAt);
  const trades = await db.trades.toArray();
  const held: { sec: Security; shares: number }[] = [];
  for (const sec of secs) {
    const shares = computePosition(trades.filter((t) => t.securityId === sec.id)).quantity;
    if (shares > 0) held.push({ sec, shares });
  }

  // 1) Googleスプレッドシート（無料・最大20分遅延）の株価
  const sheetPriced = new Set<string>();
  if (settings.sheetUrl.trim()) {
    onProgress?.('スプレッドシートから株価を取得中…');
    try {
      const { quotes, invalid } = await fetchSheetQuotes(settings.sheetUrl.trim());
      const byCode = new Map(quotes.map((q) => [q.code, q]));
      for (const { sec } of held) {
        if (sec.country !== 'JP') continue;
        const q = byCode.get(sec.code);
        if (!q) { if (!invalid.includes(sec.code)) report.skipped.push(`${sec.name}（${sec.code}）: スプレッドシートにコードがありません`); continue; }
        const asOf = q.date ?? toYmd(new Date());
        await addPrice({ securityId: sec.id, price: q.price, prevClose: q.prevClose, asOf, source: 'gsheet', sourceDetail: `GOOGLEFINANCE（最大20分遅延）・${q.date ? `取引時刻 ${q.date}` : '取引時刻不明'}` });
        sheetPriced.add(sec.id);
        report.prices++;
      }
      for (const c of invalid) report.skipped.push(`${c}: スプレッドシートの株価が数値ではありません（#N/A など）`);
    } catch (e) {
      const msg = `スプレッドシート: ${(e as Error).message}`;
      report.errors.push(msg);
      await log('error', msg);
    }
  }
  if (!settings.proxyUrl.trim()) return finish(report, settings);

  // 2) J-Quants（株価はスプレッドシートで取れた銘柄は省略、配当予想と増減配はすべて）
  const provider = new JQuantsProvider(settings.proxyUrl, settings.proxyToken, settings.jquantsPlan);
  const planNote = `プラン: ${PLAN_LABEL[settings.jquantsPlan] ?? settings.jquantsPlan}`;
  const targets: { sec: Security; shares: number }[] = [];
  for (const t of held) {
    if (!provider.supports(t.sec.country)) { report.skipped.push(`${t.sec.name}（${t.sec.code}）: 自動取得の対象外の市場です`); continue; }
    targets.push(t);
  }

  for (let i = 0; i < targets.length; i++) {
    const { sec, shares } = targets[i];
    onProgress?.(`${i + 1}/${targets.length} ${sec.name} を取得中…`);
    try {
      // 株価
      const q = sheetPriced.has(sec.id) ? null : await provider.getQuote(sec.code);
      if (sheetPriced.has(sec.id)) { /* スプレッドシートで取得済み */ } else if (q) {
        await addPrice({ securityId: sec.id, price: q.close, prevClose: q.prevClose, marketCap: q.marketCap, asOf: q.date, source: 'jquants', sourceDetail: `日足終値（${q.date}）・${planNote}` });
        report.prices++;
      } else report.skipped.push(`${sec.name}（${sec.code}）: 株価データが見つかりません`);

      // 企業情報（名称未設定の場合のみ補完）
      if (!sec.name || sec.name === sec.code) {
        const info = await provider.getCompany(sec.code);
        if (info) await db.securities.update(sec.id, { name: info.name, market: marketFromName(info.marketName) ?? sec.market });
      }

      // 配当予想と増減配
      const recs = await provider.getFinSummaries(sec.code);
      const points = toDpsPoints(recs);
      const latest = latestForecast(points);
      const maxKey = points.reduce((m, p) => (p.key > m ? p.key : m), '');
      const firstSync = !sec.lastDisclosureKey;
      const changes = dpsChanges(points).filter((c) => firstSync || c.point.key > (sec.lastDisclosureKey as string));
      for (const c of changes) {
        const ch = detectDividendChange(c.reference.value, c.point.value, shares);
        if (!ch) continue;
        const id = `jq|${sec.id}|${c.point.key}|${c.point.fyEnd}`;
        if (await db.events.get(id)) continue;
        const ev: DividendChangeEvent = {
          id, securityId: sec.id, code: sec.code, name: sec.name, ...ch, sharesHeld: shares,
          basis: `${c.basis}（${c.point.fyEnd.slice(0, 7)}期）`,
          disclosureDate: c.point.discDate, detectedAt: new Date().toISOString(), source: 'jquants',
          sourceDetail: `決算短信サマリー ${c.point.docType || ''}（TDnet開示 ${c.point.discDate}）・${planNote}`,
          origin: firstSync ? 'history' : 'auto', read: firstSync,
        };
        await db.events.put(ev);
        if (firstSync) report.historyEvents++; else report.newEvents.push(ev);
      }
      if (latest && (firstSync || latest.key > (sec.lastDisclosureKey as string))) {
        const prevF = latestRecorded(await db.forecasts.where('securityId').equals(sec.id).toArray());
        await db.forecasts.put({ id: `jq|${sec.id}|${latest.key}|${latest.fyEnd}`, securityId: sec.id, annualDps: latest.value, fiscalYearEnd: latest.fyEnd, asOf: latest.discDate, fetchedAt: laterThan(prevF?.fetchedAt), source: 'jquants', sourceDetail: `決算短信サマリー ${latest.docType}（開示 ${latest.discDate}・${latest.fyEnd.slice(0, 7)}期予想）・${planNote}` });
        report.forecasts++;
      }
      if (maxKey) await db.securities.update(sec.id, { lastDisclosureKey: maxKey });
    } catch (e) {
      const msg = `${sec.name}（${sec.code}）: ${(e as Error).message}`;
      report.errors.push(msg);
      await log('error', msg);
      if (e instanceof RateLimitError || e instanceof ProviderConfigError) { report.ok = false; break; }
    }
  }
  return finish(report, settings, reg);
}

async function finish(report: SyncReport, settings: Awaited<ReturnType<typeof loadSettings>>, reg?: ServiceWorkerRegistration): Promise<SyncReport> {
  report.finishedAt = new Date().toISOString();
  if (report.errors.length) report.ok = false;
  await saveSettings({ lastSyncAt: report.finishedAt });
  await log(report.ok ? 'info' : 'warn', `同期: 株価${report.prices}件・配当予想${report.forecasts}件・新規増減配${report.newEvents.length}件・過去履歴${report.historyEvents}件・エラー${report.errors.length}件`);
  if (report.newEvents.length && settings.notifyEnabled) await showSystemNotifications(report.newEvents, reg);
  return report;
}

export async function shouldAutoSync() {
  const s = await loadSettings();
  if (!isSyncConfigured(s) || s.autoSyncHours <= 0) return false;
  if (!s.lastSyncAt) return true;
  return Date.now() - new Date(s.lastSyncAt).getTime() > s.autoSyncHours * 3600 * 1000;
}
