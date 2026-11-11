// スマホ表示のE2E確認（Playwright）。実行: node e2e/smoke.cjs [出力フォルダ]
const { chromium, devices } = require('playwright');
const OUT = process.argv[2] || 'e2e/out';
require('fs').mkdirSync(OUT, { recursive: true });
const URL = process.env.KAV_URL || 'http://localhost:4173/';
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  const shot = async (n) => { await page.waitForTimeout(400); await page.screenshot({ path: `${OUT}/${n}.png`, fullPage: true }); };
  const noHScroll = async (n) => { const w = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); if (w > 1) errors.push(`横スクロール発生(${n}): ${w}px`); };

  await page.goto(URL);
  await page.waitForSelector('text=カヴへようこそ');
  await shot('01-empty'); await noHScroll('empty');

  // 第2段階：銘柄登録
  const addHolding = async (code, name, qty, avg, date, price, dps, rec, pay) => {
    await page.goto(URL + '#/holdings/new');
    await page.fill('#code', code); await page.fill('#name', name);
    await page.fill('#qty', String(qty)); await page.fill('#avg', String(avg)); await page.fill('#acq', date);
    if (price) await page.fill('#cp', String(price));
    if (dps) await page.fill('#dps', String(dps));
    const months = page.locator('.months').nth(0); for (const m of rec) await months.locator(`button:text-is("${m}月")`).click();
    const pm = page.locator('.months').nth(1); for (const m of pay) await pm.locator(`button:text-is("${m}月")`).click();
    if (code === '8058') await shot('02-form');
    await page.click('button[type=submit]');
    await page.waitForSelector('text=保有状況');
  };
  await addHolding('8058', '三菱商事', 100, 2500, '2024-04-10', 3000, 100, [3, 9], [6, 12]);
  await addHolding('9432', 'NTT', 1000, 150, '2024-01-10', 155, 5.2, [3, 9], [6, 12]);
  await addHolding('2914', 'JT', 100, 3800, '2023-11-01', null, 194, [6, 12], [3, 9]);

  // 追加購入と一部売却（三菱商事）
  await page.goto(URL + '#/holdings/JP%3A8058');
  await page.click('text=＋購入');
  await page.locator('.sheet input[type=number]').nth(0).fill('100');
  await page.locator('.sheet input[type=number]').nth(1).fill('3500');
  await page.click('.sheet >> text=保存');
  await page.waitForTimeout(300);
  await page.click('text=＋売却');
  await page.locator('.sheet input[type=number]').nth(0).fill('50');
  await page.locator('.sheet input[type=number]').nth(1).fill('3600');
  await page.click('.sheet >> text=保存');
  await page.waitForTimeout(400);
  const avg = await page.locator('.stat:has-text("平均取得単価") .stat-value').innerText();
  const qty = await page.locator('.stat:has-text("保有株数") .stat-value').innerText();
  if (!avg.includes('3,000') || !qty.includes('150')) errors.push(`平均単価/株数が不正: ${avg} ${qty}`);

  // 第5段階：増配（100→120円）
  await page.click('text=配当予想を入力');
  await page.locator('.sheet input[type=number]').fill('120');
  await page.click('.sheet >> text=保存');
  await page.waitForTimeout(500);
  await shot('03-detail');
  const badge = await page.locator('.badge').innerText();
  if (badge !== '1') errors.push(`未確認バッジが1でない: ${badge}`);

  // 第3段階：配当記録
  await page.goto(URL + '#/dividends');
  await page.click('.fab');
  await page.selectOption('.sheet select >> nth=0', 'JP:8058');
  await page.fill('.sheet input[type=date]', '2025-06-25');
  await page.locator('.sheet input[type=number]').nth(0).fill('50');
  await page.waitForTimeout(300);
  await page.locator('.sheet input[type=number]').nth(1).fill('100');
  await page.waitForTimeout(300);
  const gross = await page.locator('.sheet input[type=number]').nth(2).inputValue();
  const tax = await page.locator('.sheet input[type=number]').nth(3).inputValue();
  if (gross !== '5000' || tax !== String(Math.floor(5000 * 0.15315) + Math.floor(5000 * 0.05))) errors.push(`配当の自動計算が不正: ${gross} ${tax}`);
  await shot('04-dividend-form');
  await page.click('.sheet >> text=保存');
  await page.waitForTimeout(300);
  for (const [sid, date, dps, sh] of [['JP:9432', '2025-12-20', 2.6, 1000], ['JP:8058', '2025-12-01', 50, 100], ['JP:2914', '2026-03-25', 97, 100], ['JP:8058', '2026-06-24', 55, 150], ['JP:9432', '2026-06-24', 2.6, 1000]]) {
    await page.click('.fab');
    await page.selectOption('.sheet select >> nth=0', sid);
    await page.fill('.sheet input[type=date]', date);
    await page.waitForTimeout(150);
    await page.locator('.sheet input[type=number]').nth(0).fill(String(dps));
    await page.locator('.sheet input[type=number]').nth(1).fill(String(sh));
    await page.waitForTimeout(200);
    await page.click('.sheet >> text=保存');
    await page.waitForTimeout(250);
  }
  // 重複登録の防止
  await page.click('.fab');
  await page.selectOption('.sheet select >> nth=0', 'JP:9432');
  await page.fill('.sheet input[type=date]', '2026-06-24');
  await page.locator('.sheet input[type=number]').nth(0).fill('2.6');
  await page.locator('.sheet input[type=number]').nth(1).fill('1000');
  await page.waitForTimeout(200);
  await page.click('.sheet >> text=保存');
  await page.waitForSelector('text=重複の可能性');
  await page.locator('.sheet').last().locator('text=キャンセル').click();
  await page.waitForTimeout(200);
  await page.locator('.sheet').last().locator('text=キャンセル').click();
  await page.waitForTimeout(200);
  await shot('05-dividend-list'); await noHScroll('dividends');
  for (const t of ['企業別', 'グラフ', 'カレンダー']) { await page.click(`.tabs >> text=${t}`); await shot(`06-dividends-${t}`); await noHScroll(t); }
  await page.goto(URL + '#/dividends/company/JP%3A8058'); await shot('07-company');

  await page.goto(URL); await page.waitForSelector('text=現在の評価額');
  // ダッシュボードの円グラフをタップ
  await page.locator('.legend-row').first().click();
  await shot('08-home'); await noHScroll('home');
  await page.goto(URL + '#/holdings'); await shot('09-holdings');
  await page.goto(URL + '#/analysis'); await shot('10-analysis'); await noHScroll('analysis');
  await page.goto(URL + '#/notifications'); await shot('11-notifications');
  await page.goto(URL + '#/settings'); await shot('12-settings'); await noHScroll('settings');

  // 第7段階：オフライン（SWが制御するまで待ってから）
  await page.goto(URL);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload(); await page.waitForTimeout(800);
  const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
  if (!controlled) errors.push('Service Workerがページを制御していません');
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForSelector('text=現在の評価額', { timeout: 5000 }).catch(() => errors.push('オフラインで起動できない'));
  await page.goto(URL + '#/dividends'); await page.waitForSelector('text=三菱商事').catch(() => errors.push('オフラインで配当履歴が見えない'));
  await shot('13-offline');
  await ctx.setOffline(false);

  // 再読み込みでデータが残る
  await page.reload();
  const count = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('kav'); r.onsuccess = () => { const tx = r.result.transaction('dividends'); const c = tx.objectStore('dividends').count(); c.onsuccess = () => res(c.result); }; }));
  if (count !== 6) errors.push(`配当記録の件数が6でない: ${count}`);

  // PC表示
  const pc = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ja-JP' });
  const p2 = await pc.newPage();
  await p2.goto(URL); await p2.waitForTimeout(800); await p2.screenshot({ path: `${OUT}/14-pc-empty.png` });

  console.log(JSON.stringify({ errors }, null, 2));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
