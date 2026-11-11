// JPX「東証上場銘柄一覧」(data_j.xls) を取得し public/stocks.json に変換する。
// 公開元: https://www.jpx.co.jp/markets/statistics-equities/misc/01.html （毎月更新）
// 使い方: node scripts/fetch-jpx-list.mjs            … JPXからダウンロード
//         node scripts/fetch-jpx-list.mjs file.xls   … ローカルファイルから変換
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import * as XLSX from 'xlsx';

const PAGE = 'https://www.jpx.co.jp/markets/statistics-equities/misc/01.html';
const OUT = 'public/stocks.json';

export function marketKey(s) {
  if (s.includes('プライム')) return 'TSE_PRIME';
  if (s.includes('スタンダード')) return 'TSE_STANDARD';
  if (s.includes('グロース')) return 'TSE_GROWTH';
  return 'OTHER';
}

export function convert(buf) {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
  const header = rows[0].map((h) => String(h).trim());
  const col = (name) => header.indexOf(name);
  const iDate = col('日付'), iCode = col('コード'), iName = col('銘柄名'), iMkt = col('市場・商品区分'), iSec = col('33業種区分');
  if (iCode < 0 || iName < 0 || iMkt < 0) throw new Error(`想定外の列構成です: ${header.join(',')}`);
  const list = [];
  let asOf = '';
  for (const r of rows.slice(1)) {
    const code = String(r[iCode] ?? '').trim().toUpperCase();
    if (!/^[0-9][0-9A-Z]{3}$/.test(code)) continue;
    const name = String(r[iName] ?? '').trim();
    const mkt = String(r[iMkt] ?? '').trim();
    if (!name) continue;
    if (!asOf && iDate >= 0) asOf = String(r[iDate] ?? '').trim();
    const sector = iSec >= 0 ? String(r[iSec] ?? '').trim() : '';
    list.push([code, name, marketKey(mkt), mkt, sector === '-' ? '' : sector]);
  }
  if (list.length < 1000) throw new Error(`銘柄数が少なすぎます（${list.length}件）`);
  const d = asOf.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
  return { source: 'JPX 東証上場銘柄一覧', sourceUrl: PAGE, asOf: d, count: list.length, fields: ['code', 'name', 'market', 'marketLabel', 'sector33'], data: list };
}

async function download() {
  const res0 = await fetch(PAGE, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', 'Accept-Language': 'ja' } });
  const html = await res0.text();
  const links = [...html.matchAll(/href=["']([^"']+\.xlsx?)["']/gi)].map((x) => x[1]);
  const link = links.find((l) => /data_j\.xlsx?$/i.test(l)) ?? links.find((l) => /data_?j/i.test(l));
  if (!link) throw new Error(`data_j.xls のリンクが見つかりません（status ${res0.status}, ${html.length}文字, xlsリンク: ${links.slice(0, 5).join(' ') || 'なし'}, 先頭: ${html.slice(0, 200).replace(/\s+/g, ' ')}）`);
  const m = [null, link];
  const url = new URL(m[1], PAGE).href;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (kav build)' } });
  if (!res.ok) throw new Error(`ダウンロード失敗 ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const buf = process.argv[2] ? readFileSync(process.argv[2]) : await download();
    const out = convert(buf);
    writeFileSync(OUT, JSON.stringify(out));
    console.log(`${OUT}: ${out.count}銘柄（${out.asOf}時点）`);
  } catch (e) {
    // 取得できなくてもビルドは止めない（既存のファイルがあればそれを使う）
    console.warn(`JPX銘柄一覧を更新できませんでした: ${e.message}${existsSync(OUT) ? '（既存の一覧を使用）' : '（一覧なしで公開。自動入力は使えません）'}`);
  }
}
