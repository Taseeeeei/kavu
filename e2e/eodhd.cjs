// 設定画面「EODHD接続」のE2E確認。バックエンドは Playwright の route で模擬する（表示確認専用のテストデータ）
const { chromium, devices } = require('playwright');
const OUT = process.argv[2] || 'e2e/out';
require('fs').mkdirSync(OUT, { recursive: true });
const APP = process.env.KAV_URL || 'http://localhost:4173/';
const API = 'https://kav-backend.test.workers.dev';
const sec = (id, symbol, name, kind, st, note, en) => ({ id, symbol, code: null, name, eodhd_name: en ?? null, kind, exchange: null, currency: null, eodhd_status: st, status_note: note, verified_at: '2026-11-12T03:00:00Z' });
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  let used = 1;
  const securities = [
    sec(1, '7203.TSE', 'トヨタ自動車', 'stock', 'listed', 'EODHDのTSE銘柄一覧に記載あり（テスト）', 'TOYOTA (テスト)'),
    sec(2, '7135.TSE', 'ジャパン・クラフトHD', 'stock', 'unsupported', 'TSEの銘柄一覧にありません（テスト）'),
    sec(3, 'N225.INDX', '日経平均株価', 'index', 'supported', '日足を取得できました（テスト）'),
    sec(4, 'FUND:eMAXIS Slim 米国株式(S&P500)', 'eMAXIS Slim 米国株式(S&P500)', 'fund', 'unverified', 'EODHD非対応・未確認（EODHDの銘柄記号が確認できていません）'),
  ];
  await page.route(`${API}/**`, async (route) => {
    const u = new URL(route.request().url());
    const auth = route.request().headers()['authorization'];
    const body = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b) });
    if (u.pathname === '/api/health') return body({ ok: true, app: 'kav-backend', version: 'phase1', eodhdKey: true, appToken: true, dbReady: true });
    if (auth !== 'Bearer test-token') return body({ error: '合言葉（APP_TOKEN）が違います' }, 401);
    if (u.pathname === '/api/status') return body({ usage: { day: '2026-11-12', used, limit: 20, reserve: 2, remaining: 20 - used, exhausted: false, remoteUsed: used, remoteLimit: 20, remoteCheckedAt: '2026-11-12T03:00:00Z', resetsAt: '2026-11-13T00:00:00.000Z' }, limits: { daily: 20, reserve: 2, automatic: 18 } });
    if (u.pathname === '/api/securities') return body({ securities });
    if (u.pathname === '/api/verify') { used += 3; return body({ ok: false, callsPlanned: 3, steps: [{ step: '取引所一覧', ok: true, message: 'TSE, INDX を確認しました' }, { step: 'TSEの銘柄一覧', ok: false, message: '19件中18件が一覧にありました' }], securities }); }
    return body({ error: 'Not Found' }, 404);
  });
  await page.goto(APP + '#/settings');
  await page.waitForSelector('text=EODHD接続');
  await page.fill('input[placeholder^="https://kav-backend"]', API);
  await page.fill('input[type=password]', 'test-token');
  await page.click('button:text-is("保存")');
  await page.click('button:text-is("接続テスト")');
  await page.waitForSelector('text=本日のEODHD使用回数');
  await page.waitForSelector('text=ジャパン・クラフトHD');
  await page.click('text=EODHDで対応銘柄を確認する');
  await page.click('.sheet button:text-is("確認する"), .modal button:text-is("確認する")');
  await page.waitForSelector('text=19件中18件');
  const txt = await page.textContent('body');
  for (const t of ['EODHD非対応・未確認', 'EODHD対応（取得を確認済み）', 'EODHDの一覧に記載あり', '4 / 20 回']) if (!txt.includes(t)) errors.push(`表示されない: ${t}`);
  if (txt.includes('J-Quants') || txt.includes('GOOGLEFINANCE')) errors.push('旧データ取得元の表示が残っています');
  await page.locator('text=EODHD接続').first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/eodhd-settings.png`, fullPage: true });
  await page.goto(APP + '#/');
  await page.waitForSelector('text=EODHD APIから取得します');
  await page.screenshot({ path: `${OUT}/eodhd-home.png` });
  const w = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (w > 1) errors.push(`横スクロール ${w}px`);
  await browser.close();
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log('OK');
})();
