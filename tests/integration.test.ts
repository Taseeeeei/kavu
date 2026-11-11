import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../src/db/db';
import { createSecurity, saveTrade, setForecastManual, loadHoldings, exportJson, restoreJson, trashSecurity, deleteTrade, DuplicateError } from '../src/db/repo';
import { saveSettings } from '../src/db/settings';
import { importCsv, exportCsv } from '../src/services/csvio';
import { syncAll } from '../src/services/sync';
import { summarize } from '../src/domain/portfolio';

const base = { country: 'JP' as const, market: 'TSE_PRIME' as const, account: 'taxable' as const, recordMonths: [3, 9], payMonths: [6, 12], memo: '' };

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe('DB・リポジトリ', () => {
  it('登録・売買・利回りの再計算・重複防止', async () => {
    const s = await createSecurity({ ...base, code: '8058', name: '三菱商事' });
    await expect(createSecurity({ ...base, code: '8058', name: '重複' })).rejects.toBeInstanceOf(DuplicateError);
    await saveTrade({ securityId: s.id, side: 'buy', date: '2024-01-10', quantity: 100, price: 2000, fee: 0, memo: '' });
    await setForecastManual(s.id, 100, 'manual');
    let h = (await loadHoldings())[0];
    expect(h.yieldOnCost).toBeCloseTo(5, 10);
    const t2 = await saveTrade({ securityId: s.id, side: 'buy', date: '2024-02-10', quantity: 100, price: 3000, fee: 0, memo: '' });
    h = (await loadHoldings())[0];
    expect(h.position.avgCost).toBe(2500);
    expect(h.yieldOnCost).toBeCloseTo(4, 10); // 20000/500000
    await expect(saveTrade({ securityId: s.id, side: 'sell', date: '2024-03-01', quantity: 500, price: 3000, fee: 0, memo: '' })).rejects.toThrow();
    await saveTrade({ securityId: s.id, side: 'sell', date: '2024-03-01', quantity: 150, price: 3000, fee: 0, memo: '' });
    await expect(deleteTrade(t2.id)).rejects.toThrow(); // 削除すると売却超過
    h = (await loadHoldings())[0];
    expect(h.position.quantity).toBe(50);
  });

  it('手動の配当予想変更で増配イベント（100→120円、100株で+2,000円）', async () => {
    const s = await createSecurity({ ...base, code: '1111', name: 'A社' });
    await saveTrade({ securityId: s.id, side: 'buy', date: '2024-01-10', quantity: 100, price: 1000, fee: 0, memo: '' });
    expect(await setForecastManual(s.id, 100, 'manual')).toBeNull(); // 初回は基準値
    const ev = await setForecastManual(s.id, 120, 'manual');
    expect(ev).toMatchObject({ kind: 'increase', before: 100, after: 120, diffPerShare: 20, sharesHeld: 100, annualImpact: 2000, origin: 'manual', source: 'manual', read: false });
    expect(ev!.rate).toBeCloseTo(20, 10);
    const ev2 = await setForecastManual(s.id, 0, 'manual');
    expect(ev2?.kind).toBe('suspend');
    expect(ev2?.annualImpact).toBe(-12000);
  });

  it('ゴミ箱に入れた銘柄は集計から除外', async () => {
    const s = await createSecurity({ ...base, code: '2222', name: 'B社' });
    await saveTrade({ securityId: s.id, side: 'buy', date: '2024-01-10', quantity: 100, price: 1000, fee: 0, memo: '' });
    await trashSecurity(s.id);
    expect(summarize(await loadHoldings()).holdingCount).toBe(0);
  });

  it('CSVインポートは重複を取り込まない・エクスポートと往復できる', async () => {
    const csv = '﻿国,銘柄コード,企業名,売買,約定日,株数,単価,手数料,メモ\r\nJP,9432,NTT,買,2024/1/5,1000,170,0,\r\nJP,9432,NTT,買,2024/1/5,1000,170,0,\r\nJP,9432,NTT,売,2024/2/5,5000,180,0,\r\n';
    const r = await importCsv(csv);
    expect(r).toMatchObject({ kind: 'trades', added: 1, skippedDuplicates: 1 });
    expect(r.errors.length).toBe(1);
    const dcsv = '国,銘柄コード,企業名,受取日,1株配当,株数,税引前,税金,税引後,区分,メモ\nJP,9432,NTT,2024-06-25,2.6,1000,,,,期末配当,\n';
    const r2 = await importCsv(dcsv);
    expect(r2.added).toBe(1);
    const d = (await db.dividends.toArray())[0];
    expect(d.gross).toBe(2600);
    expect(d.tax).toBe(Math.floor(2600 * 0.15315) + Math.floor(2600 * 0.05));
    expect(d.net).toBe(2600 - d.tax);
    expect((await importCsv(dcsv)).skippedDuplicates).toBe(1);
    const out = await exportCsv('dividends');
    expect(out).toContain('2024-06-25');
  });

  it('JSONバックアップ→復元で完全に戻る（トークンは含めない）', async () => {
    const s = await createSecurity({ ...base, code: '3333', name: 'C社' });
    await saveTrade({ securityId: s.id, side: 'buy', date: '2024-01-10', quantity: 10, price: 1000, fee: 0, memo: '' });
    await saveSettings({ proxyToken: 'secret' });
    const json = await exportJson();
    expect(json).not.toContain('secret');
    await db.trades.clear();
    await restoreJson(json);
    expect(await db.trades.count()).toBe(1);
    expect((await db.settings.get('proxyToken'))?.value).toBe('secret');
    expect(await db.backups.count()).toBeGreaterThan(0);
  });
});

describe('J-Quants 同期（モック）', () => {
  it('初回は過去の開示を履歴として取込、2回目に新しい増配を検知', async () => {
    const s = await createSecurity({ ...base, code: '7203', name: 'トヨタ' });
    await saveTrade({ securityId: s.id, side: 'buy', date: '2024-01-10', quantity: 100, price: 2500, fee: 0, memo: '' });
    await saveSettings({ proxyUrl: 'https://proxy.test', proxyToken: 't', jquantsPlan: 'premium' });
    let summaries = [
      { DiscDate: '2025-05-08', DiscTime: '13:25:00', Code: '72030', CurPerType: 'FY', CurFYEn: '2025-03-31', NxtFYEn: '2026-03-31', DivAnn: '90', NxFDivAnn: '95', DocType: 'FYFinancialStatements_Consolidated_IFRS' },
    ];
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(url);
      expect((init?.headers as Record<string, string>)['x-kav-token']).toBe('t');
      const u = new URL(url);
      const body = u.pathname.endsWith('/bars/daily')
        ? { data: [{ Date: '2026-08-10', C: 2900 }, { Date: '2026-08-11', C: 3000, MktCap: 100 }] }
        : u.pathname.endsWith('/fins/summary') ? { data: summaries } : { data: [] };
      return new Response(JSON.stringify(body), { status: 200 });
    }));
    const r1 = await syncAll();
    expect(r1.errors).toEqual([]);
    expect(r1.prices).toBe(1);
    expect(r1.historyEvents).toBe(1);
    expect(r1.newEvents.length).toBe(0);
    let h = (await loadHoldings())[0];
    expect(h.price?.price).toBe(3000);
    expect(h.dayChange).toBe(100);
    expect(h.annualDps).toBe(95);
    expect(h.forecast?.source).toBe('jquants');
    const hist = await db.events.toArray();
    expect(hist[0]).toMatchObject({ origin: 'history', read: true, before: 90, after: 95 });

    summaries = [...summaries, { DiscDate: '2025-11-05', DiscTime: '13:25:00', Code: '72030', CurPerType: '2Q', CurFYEn: '2026-03-31', FDivAnn: '114', DocType: '2QFinancialStatements_Consolidated_IFRS' } as never];
    const r2 = await syncAll();
    expect(r2.newEvents.length).toBe(1);
    expect(r2.newEvents[0]).toMatchObject({ kind: 'increase', before: 95, after: 114, diffPerShare: 19, annualImpact: 1900, origin: 'auto', read: false, disclosureDate: '2025-11-05', source: 'jquants' });
    expect(r2.newEvents[0].sourceDetail).toContain('2025-11-05');
    h = (await loadHoldings())[0];
    expect(h.annualDps).toBe(114);
    // 3回目：新しい開示なし → 新規イベントなし（重複通知しない）
    const r3 = await syncAll();
    expect(r3.newEvents.length).toBe(0);
    expect(calls.every((c) => c.startsWith('https://proxy.test/v2/'))).toBe(true);
    vi.unstubAllGlobals();
  }, 30000);

  it('プロキシ未設定なら取得せず、その旨を返す', async () => {
    const r = await syncAll();
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toContain('未設定');
  });
});
