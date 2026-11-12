-- カヴ EODHD版 D1（SQLite）スキーマ
-- 株価・配当の取得元は EODHD のみ。取得できなかった値は NULL のまま保存し、推測で埋めない。

-- 銘柄（日本株・指数・投信）
CREATE TABLE securities (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol        TEXT NOT NULL UNIQUE,          -- EODHDの銘柄記号の候補（例 7203.TSE）。投信は未確定なら 'FUND:<名前>'
  code          TEXT,                          -- 証券コード（日本株のみ）
  name          TEXT NOT NULL,                 -- 利用者が登録した名称
  eodhd_name    TEXT,                          -- EODHDの銘柄一覧に載っていた名称（確認済みのときだけ）
  kind          TEXT NOT NULL CHECK (kind IN ('stock','index','fund')),
  exchange      TEXT,                          -- EODHDの取引所コード（TSE / INDX など）
  currency      TEXT,
  eodhd_status  TEXT NOT NULL DEFAULT 'unverified'
                CHECK (eodhd_status IN ('unverified','listed','supported','unsupported')),
                -- unverified=未確認 / listed=銘柄一覧に記載あり / supported=価格データ取得を確認 / unsupported=非対応
  status_note   TEXT,
  verified_at   TEXT,
  record_months TEXT,                          -- 権利確定月（例 '3,9'）
  pay_months    TEXT,
  memo          TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at    TEXT
);

-- 購入・売却の履歴
CREATE TABLE trades (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  security_id INTEGER NOT NULL REFERENCES securities(id),
  side        TEXT NOT NULL CHECK (side IN ('buy','sell')),
  date        TEXT NOT NULL,
  quantity    REAL NOT NULL CHECK (quantity > 0),
  price       REAL NOT NULL CHECK (price >= 0),
  fee         REAL NOT NULL DEFAULT 0,
  account     TEXT NOT NULL DEFAULT 'tokutei',  -- tokutei / ippan / nisa
  memo        TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_trades_security ON trades(security_id, date);

-- 日足（EODHD /api/eod）
CREATE TABLE prices_daily (
  symbol         TEXT NOT NULL,
  date           TEXT NOT NULL,
  open           REAL,
  high           REAL,
  low            REAL,
  close          REAL,
  adjusted_close REAL,
  volume         REAL,
  fetched_at     TEXT NOT NULL,
  PRIMARY KEY (symbol, date)
);

-- 現在値のスナップショット（EODHD /api/real-time。15〜20分遅延）
CREATE TABLE quotes (
  symbol         TEXT PRIMARY KEY,
  price          REAL,
  previous_close REAL,
  change         REAL,
  change_p       REAL,
  quote_time     TEXT,      -- EODHDが返した timestamp（ISO）
  fetched_at     TEXT NOT NULL
);

-- 配当履歴（EODHD /api/div）
CREATE TABLE eodhd_dividends (
  symbol           TEXT NOT NULL,
  ex_date          TEXT NOT NULL,
  value            REAL,
  unadjusted_value REAL,
  currency         TEXT,
  period           TEXT,
  declaration_date TEXT,
  record_date      TEXT,
  payment_date     TEXT,
  fetched_at       TEXT NOT NULL,
  PRIMARY KEY (symbol, ex_date)
);

-- 増配・減配の検出結果（EODHDの配当履歴どうしの比較のみ）
CREATE TABLE dividend_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol        TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('increase','decrease','unchanged')),
  before        REAL NOT NULL,
  after         REAL NOT NULL,
  diff          REAL NOT NULL,
  rate          REAL NOT NULL,
  shares        REAL,
  annual_impact REAL,
  compared      TEXT NOT NULL,   -- 比較した権利落ち日（例 '2025-03-28→2026-03-27'）
  detected_at   TEXT NOT NULL,
  read          INTEGER NOT NULL DEFAULT 0,
  UNIQUE (symbol, compared)
);

-- 実際に受け取った配当
CREATE TABLE dividend_receipts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  security_id   INTEGER NOT NULL REFERENCES securities(id),
  received_date TEXT NOT NULL,
  dps           REAL,
  shares        REAL,
  gross         REAL NOT NULL,
  tax           REAL NOT NULL DEFAULT 0,
  net           REAL NOT NULL,
  memo          TEXT
);

-- 銘柄ごとの取得状況
CREATE TABLE fetch_status (
  symbol          TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('eod','quote','div')),
  last_attempt_at TEXT,
  last_success_at TEXT,
  last_data_date  TEXT,
  last_error      TEXT,
  PRIMARY KEY (symbol, kind)
);

-- 1日のコール数（EODHDのリセットは 0:00 GMT）
CREATE TABLE api_usage (
  day          TEXT PRIMARY KEY,         -- GMTの日付 YYYY-MM-DD
  calls_used   INTEGER NOT NULL DEFAULT 0,
  daily_limit  INTEGER NOT NULL,
  exhausted    INTEGER NOT NULL DEFAULT 0, -- 402 を受けたら 1
  remote_used  INTEGER,                    -- /api/user の apiRequests（照合用）
  remote_limit INTEGER,                    -- /api/user の dailyRateLimit
  remote_checked_at TEXT
);

-- API呼び出しの記録（APIキーは保存しない）
CREATE TABLE api_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          TEXT NOT NULL,
  endpoint    TEXT NOT NULL,
  symbol      TEXT,
  cost        INTEGER NOT NULL,
  http_status INTEGER,
  message     TEXT
);
CREATE INDEX idx_api_log_at ON api_log(at);

-- 評価額の推移
CREATE TABLE portfolio_snapshots (
  date         TEXT PRIMARY KEY,
  cost         REAL NOT NULL,
  value        REAL,
  cash         REAL,
  priced_count INTEGER NOT NULL,
  total_count  INTEGER NOT NULL
);

-- 設定
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 初期銘柄（すべて未確認。EODHDの銘柄一覧で確認できたものだけ listed / supported に変わる）
INSERT INTO securities (symbol, code, name, kind, exchange) VALUES
  ('9432.TSE','9432','NTT','stock','TSE'),
  ('7135.TSE','7135','ジャパン・クラフトHD','stock','TSE'),
  ('7039.TSE','7039','ブリッジグループ','stock','TSE'),
  ('8316.TSE','8316','三井住友フィナンシャルグループ','stock','TSE'),
  ('8058.TSE','8058','三菱商事','stock','TSE'),
  ('8306.TSE','8306','三菱UFJフィナンシャル・グループ','stock','TSE'),
  ('3176.TSE','3176','三洋貿易','stock','TSE'),
  ('8591.TSE','8591','オリックス','stock','TSE'),
  ('3201.TSE','3201','日本毛織','stock','TSE'),
  ('4202.TSE','4202','ダイセル','stock','TSE'),
  ('3861.TSE','3861','王子ホールディングス','stock','TSE'),
  ('1605.TSE','1605','INPEX','stock','TSE'),
  ('8098.TSE','8098','稲畑産業','stock','TSE'),
  ('8766.TSE','8766','東京海上ホールディングス','stock','TSE'),
  ('8593.TSE','8593','三菱HCキャピタル','stock','TSE'),
  ('8697.TSE','8697','日本取引所グループ','stock','TSE'),
  ('8035.TSE','8035','東京エレクトロン','stock','TSE'),
  ('7203.TSE','7203','トヨタ自動車','stock','TSE'),
  ('7974.TSE','7974','任天堂','stock','TSE'),
  ('IXIC.INDX',NULL,'NASDAQ総合指数','index','INDX'),
  ('N225.INDX',NULL,'日経平均株価','index','INDX'),
  ('FUND:eMAXIS Slim 米国株式(S&P500)',NULL,'eMAXIS Slim 米国株式(S&P500)','fund',NULL),
  ('FUND:eMAXIS Slim 全世界株式(オール・カントリー)',NULL,'eMAXIS Slim 全世界株式(オール・カントリー)','fund',NULL),
  ('FUND:iFreeNEXT FANG+インデックス',NULL,'iFreeNEXT FANG+インデックス','fund',NULL);

INSERT INTO settings (key, value) VALUES ('cash_balance', ''), ('tax_rate', '0.20315');
