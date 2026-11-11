/**
 * 外部の情報サイトへのリンク。各サイトの規約を尊重し、自動収集（スクレイピング）は行わない。
 * 銘柄ごとにワンタップで該当ページを開き、効率よく情報を確認するためのもの。
 */
export interface ExternalLink { label: string; url: string; note: string }

export function externalLinks(country: string, code: string): ExternalLink[] {
  if (country !== 'JP') {
    return [{ label: 'Yahoo Finance', url: `https://finance.yahoo.com/quote/${encodeURIComponent(code)}`, note: '株価・配当' }];
  }
  const c = encodeURIComponent(code);
  return [
    { label: '株探', url: `https://kabutan.jp/stock/?code=${c}`, note: '決算・修正・ニュース' },
    { label: 'IRバンク', url: `https://irbank.net/${c}/dividend`, note: '配当推移・業績' },
    { label: '株予報Pro', url: `https://kabuyoho.jp/reportTop?bcode=${c}`, note: '業績予想・配当' },
    { label: '四季報オンライン', url: `https://shikiho.toyokeizai.net/stocks/${c}`, note: '会社四季報' },
    { label: '投資の森', url: `https://nikkeiyosoku.com/stock/${c}/`, note: '配当・株主優待' },
    { label: 'Yahoo!ファイナンス', url: `https://finance.yahoo.co.jp/quote/${c}.T`, note: '株価' },
  ];
}
