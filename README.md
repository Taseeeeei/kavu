# カヴ — 保有株・配当金管理PWA

日本株を中心に、保有銘柄・売買履歴・受取配当金・配当利回り・増配/減配を一元管理するPWAです。
データは端末内（IndexedDB）に保存され、オフラインでも閲覧できます。

## 技術スタック
React 18 / TypeScript / Vite / vite-plugin-pwa（Workbox, injectManifest）/ Dexie（IndexedDB）/ Recharts / Vitest / Playwright

## 構成
```
src/domain/    計算ロジック（UIから独立した純粋関数）
  position.ts       売買履歴→保有株数・平均取得単価（移動平均法・一部売却・手数料）
  portfolio.ts      評価額・含み損益・利回り（取得額ベース/時価ベース）・構成比
  dividends.ts      月別/年別/企業別/過去12か月/前年同期比/累計
  dividendChange.ts 増配・減配・無配・復配の判定、J-Quants開示データからの検出
  tax.ts            源泉徴収（所得税15.315%・住民税5%を各々切捨て、NISA非課税）
  jpCalendar.ts     東証営業日・祝日、権利付き最終日/権利落ち日（推定）
  csv.ts            CSVパース/出力（UTF-8 BOM、Shift_JIS読込）
src/db/        Dexieスキーマ・リポジトリ・設定・バックアップ
src/data/      外部データ提供元（MarketDataProviderインターフェース、J-Quants実装、外部リンク）
src/services/  同期（自動取得・増減配検知）、通知、CSV入出力、インストール
src/ui/        画面（ホーム/保有銘柄/配当金/分析/設定/通知）
src/sw.ts      Service Worker（事前キャッシュ、定期バックグラウンド確認、通知クリック）
worker/        J-Quants APIプロキシ（Cloudflare Workers）
tests/         単体テスト・統合テスト
e2e/smoke.cjs  スマホ表示のE2E確認
```

## 開発
```
npm install
npm run dev        # 開発サーバ
npm test           # 計算・DB・同期のテスト
npm run build      # 本番ビルド（dist/）
npm run preview    # ビルド結果を確認（http://localhost:4173）
node e2e/smoke.cjs # preview起動中にスマホ表示のE2E確認
```

## 公開（ホーム画面に追加して使う）
`dist/` を HTTPS の静的ホスティング（GitHub Pages / Cloudflare Pages / Netlify など）に置きます。
相対パスでビルドしているので、サブディレクトリ（例: `https://ユーザー名.github.io/kav/`）でも動きます。
- iPhone: Safariで開く → 共有 → 「ホーム画面に追加」
- Android / PC(Chrome, Edge): 設定画面の「ホーム画面にインストール」またはブラウザのインストールボタン

## 株価・配当予想の自動取得（任意）
情報源は **J-Quants API（JPX公式）V2** です。APIキーをフロントエンドに置かないため、同梱のプロキシを使います。

1. https://jpx-jquants.com/ で登録し、ダッシュボードの「API Keys」でAPIキーを発行
2. `cd worker && npx wrangler deploy`
3. `npx wrangler secret put JQUANTS_API_KEY`（APIキー）と `npx wrangler secret put ACCESS_TOKEN`（任意の合言葉）
4. `wrangler.toml` の `ALLOWED_ORIGIN` にアプリの公開オリジンを設定して再デプロイ
5. アプリの 設定 → データ取得 にプロキシURLと合言葉を入れて「接続テスト」→「今すぐ取得」

注意（2026年11月時点の公式仕様）:
- 無料プランは**データが12週間遅延**、毎分5リクエスト。Light 60 / Standard 120 / Premium 500（`/fins/summary` は全プラン60/分）。429時は2分以上待機。
- 使用エンドポイント: `/v2/equities/bars/daily`（株価）、`/v2/equities/master`（企業名・市場）、`/v2/fins/summary`（決算短信サマリー：配当予想 `FDivAnn`/`NxFDivAnn`・実績 `DivAnn`）
- 増減配検知: 決算短信・配当予想修正の開示ごとに、同じ事業年度の直前予想（予想修正）または前期実績（新年度予想）と比較。初回取得時の過去の変更は「過去の開示から取込」として既読扱いで保存し、2回目以降の新しい開示だけを未確認通知にします。
- 取得値にはすべて取得日時・情報源（開示日・書類種別・プラン）を保存・表示します。

株探・四季報オンライン・株予報Pro・IRバンク・投資の森は規約に配慮して自動収集せず、銘柄詳細から該当ページへのリンクを提供しています。
証券会社の配当受取実績は自動取得できないため、手動入力またはCSVインポートで登録します。

## 通知
- アプリ内通知（ベルの未確認バッジ、アプリアイコンバッジ対応環境あり）
- 端末通知: 設定で有効化。新しい増減配を検知した時に表示
- バックグラウンド確認: Periodic Background Sync 対応環境（AndroidのChrome等でインストール時）のみ。iPhoneはアプリを開いた時に確認します（iOSでの通知はホーム画面に追加したアプリでのみ許可可能）。
- サーバーからのWeb Pushはプッシュ送信サーバーが別途必要なため未実装（SWには受信処理のみ用意）。

## データ保護
自動保存（IndexedDB・永続化要求）／JSONバックアップと復元／CSV入出力（銘柄・売買・配当・配当予想）／重複登録の検出／
銘柄削除はゴミ箱（復元可能）／インポート・復元・削除の前に端末内へ自動バックアップ（最新10件）。
