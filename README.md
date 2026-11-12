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
  dividendChange.ts 増配・減配・無配・復配の判定
  tax.ts            源泉徴収（所得税15.315%・住民税5%を各々切捨て、NISA非課税）
  jpCalendar.ts     東証営業日・祝日、権利付き最終日/権利落ち日（推定）
  csv.ts            CSVパース/出力（UTF-8 BOM、Shift_JIS読込）
src/db/        Dexieスキーマ・リポジトリ・設定・バックアップ
src/data/      バックエンドとの通信、JPX上場銘柄一覧、外部リンク
src/services/  同期（自動取得・増減配検知）、通知、CSV入出力、インストール
src/ui/        画面（ホーム/保有銘柄/配当金/分析/設定/通知）
src/sw.ts      Service Worker（事前キャッシュ、定期バックグラウンド確認、通知クリック）
backend/       Cloudflare Worker + D1（EODHD API の呼び出し、回数管理、銘柄確認）
tests/         単体テスト・統合テスト
e2e/           スマホ表示のE2E確認（smoke.cjs, eodhd.cjs）
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

## 株価・配当の取得（EODHD API）
株価・配当の取得元は **EODHD API だけ** です。EODHDで取得できなかった場合も、他のサービスやスクレイピングには切り替えず、「未取得」と表示します。

```
iPhone / PC（PWA）──合言葉──▶ Cloudflare Worker（backend/）──APIキー──▶ EODHD API
                                     └─ D1（SQLite）に保存・呼び出し回数を記録
```
EODHDのAPIキーは Worker のシークレットにだけ置き、PWAやリポジトリには書きません。

### 実装状況
| 機能 | 状態 |
| --- | --- |
| バックエンド（Worker + D1）、APIキー管理、合言葉による認証 | 実装済み（フェーズ1） |
| 1日の呼び出し回数の管理（上限20回・予備2回を設定値で管理、402/429で停止、/api/user で照合） | 実装済み（フェーズ1） |
| 対応銘柄の確認（EODHDの取引所一覧・銘柄一覧で確認、実際に日足を取得できたら「対応」に確定） | 実装済み（フェーズ1） |
| 株価・株価履歴の毎日の取得、チャート、損益 | 未実装（フェーズ2） |
| 配当履歴の取得、増配・減配の判定 | 未実装（フェーズ3） |
| 分析・バックアップのD1対応・エラー処理の強化 | 未実装（フェーズ4） |

### 準備（初めての方向け）
1. **EODHDのAPIキー**：https://eodhd.com/ で無料登録し、ダッシュボードに表示されるAPIキーを控えます。
2. **Cloudflareのアカウント**：https://dash.cloudflare.com/sign-up で無料登録します。左メニューの「Workers & Pages」を一度開き、workers.dev のサブドメインを決めておきます。
3. **CloudflareのアカウントID**：ダッシュボード右側（またはWorkers & Pagesの画面）にある「Account ID」を控えます。
4. **CloudflareのAPIトークン**：右上のアイコン →「My Profile」→「API Tokens」→「Create Token」→ テンプレート「Edit Cloudflare Workers」を選び、権限に「Account → D1 → Edit」を追加して作成し、表示されたトークンを控えます。
5. **合言葉（APP_TOKEN）**：パスワード生成機能などで作った、32文字以上のランダムな文字列を用意します。
6. GitHub の kavu リポジトリ → Settings → Secrets and variables → Actions →「New repository secret」で、次の4つを登録します。
   - `EODHD_API_KEY`（1の値）
   - `CLOUDFLARE_ACCOUNT_ID`（3の値）
   - `CLOUDFLARE_API_TOKEN`（4の値）
   - `APP_TOKEN`（5の値）
7. Actions タブ →「Deploy backend (Cloudflare Worker + D1)」→「Run workflow」を押します。D1データベースの作成・表の作成・Workerのデプロイ・シークレットの登録が自動で行われ、完了画面（Summary）にバックエンドのURLが表示されます。
8. カヴの 設定 → EODHD接続 に、URLと合言葉を入れて「保存」→「接続テスト」。続けて「EODHDで対応銘柄を確認する（3回使用）」を押します。

### 無料プランの制約（EODHD公式ドキュメントより）
- 1日20回まで（0:00 GMT＝日本時間9:00にリセット）。データがなかった場合（404）も1回と数えられます。
- 株価履歴は過去1年分、リアルタイム株価は15〜20分遅れ。ファンダメンタルズ（予想配当など）は無料プランでは使えません。
- 19銘柄＋指数2つで毎日21回必要になり、上限を超えます。フェーズ2では、データの古い銘柄から順に1日最大18回まで取得し、2回を手動操作用に残します。
- 国内の投資信託（eMAXIS Slim など）は、EODHDの銘柄記号が確認できるまで「EODHD非対応・未確認」と表示します。
- 回数の設定は `backend/wrangler.toml` の `DAILY_CALL_LIMIT`・`CALL_RESERVE` で変えられます。

株探・四季報オンライン・株予報Pro・IRバンク・投資の森は自動収集せず、銘柄詳細から該当ページへのリンクを提供しています。
企業名の自動入力にはJPXの上場銘柄一覧（株価データではありません）を使っています。
証券会社の配当受取実績は自動取得できないため、手動入力またはCSVインポートで登録します。

## 通知
- アプリ内通知（ベルの未確認バッジ、アプリアイコンバッジ対応環境あり）
- 端末通知: 設定で有効化。新しい増減配を検知した時に表示
- バックグラウンド確認: Periodic Background Sync 対応環境（AndroidのChrome等でインストール時）のみ。iPhoneはアプリを開いた時に確認します（iOSでの通知はホーム画面に追加したアプリでのみ許可可能）。
- サーバーからのWeb Pushはプッシュ送信サーバーが別途必要なため未実装（SWには受信処理のみ用意）。

## データ保護
自動保存（IndexedDB・永続化要求）／JSONバックアップと復元／CSV入出力（銘柄・売買・配当・配当予想）／重複登録の検出／
銘柄削除はゴミ箱（復元可能）／インポート・復元・削除の前に端末内へ自動バックアップ（最新10件）。
