import { useEffect, useState } from 'react';
import { saveSettings } from '../../db/settings';
import { useSettings } from '../hooks';
import { BackendClient, checkBackendUrl, STATUS_LABEL, type BackendSecurity, type Health, type Usage, type VerifyReport } from '../../data/backend';
import { dateTime } from '../../domain/format';
import { useConfirm, useToast } from './common';

const KIND_LABEL = { stock: '日本株', index: '指数', fund: '投資信託' } as const;
const STATUS_CLASS = { supported: 'up', listed: 'warn', unsupported: 'down', unverified: 'dim' } as const;

/** 設定画面：EODHD接続（バックエンドURL・合言葉・使用回数・対応銘柄の確認） */
export function EodhdPanel() {
  const s = useSettings();
  const toast = useToast();
  const confirm = useConfirm();
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [secs, setSecs] = useState<BackendSecurity[] | null>(null);
  const [steps, setSteps] = useState<VerifyReport['steps'] | null>(null);
  const [candidate, setCandidate] = useState<Record<number, string>>({});

  useEffect(() => { setUrl(s.backendUrl); setToken(s.backendToken); }, [s.backendUrl, s.backendToken]);
  const client = () => new BackendClient(s.backendUrl, s.backendToken);
  const configured = !!s.backendUrl && !!s.backendToken;

  const refresh = async (remote = false) => {
    const c = client();
    const [st, list] = await Promise.all([c.status(remote), c.securities()]);
    setUsage(st.usage);
    setSecs(list);
  };
  useEffect(() => { if (configured && navigator.onLine) refresh().catch(() => undefined); }, [s.backendUrl, s.backendToken]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try { await fn(); } catch (e) { toast((e as Error).message); } finally { setBusy(null); }
  };

  const save = () => run('保存中…', async () => {
    const err = checkBackendUrl(url);
    if (err) throw new Error(err);
    await saveSettings({ backendUrl: url.trim().replace(/\/+$/, ''), backendToken: token.trim() });
    toast(url.trim() ? '保存しました' : '接続を解除しました');
  });

  const test = () => run('接続テスト中…', async () => {
    const err = checkBackendUrl(url);
    if (err || !url.trim()) throw new Error(err ?? 'URLを入力してください');
    const c = new BackendClient(url, token.trim());
    const h = await c.health();
    setHealth(h);
    if (!h.eodhdKey || !h.appToken || !h.dbReady) throw new Error(`バックエンドの準備ができていません：${[!h.eodhdKey && 'EODHDのAPIキー', !h.appToken && '合言葉', !h.dbReady && 'データベース'].filter(Boolean).join('・')}が未設定`);
    const st = await c.status(true); // /api/user は消費0回
    setUsage(st.usage);
    toast(`接続できました。本日のEODHD使用回数 ${st.usage.used}/${st.usage.limit}`);
  });

  const verify = () => run('確認中…', async () => {
    if (!(await confirm({ title: 'EODHDで対応銘柄を確認', message: <>EODHDの取引所一覧・東証の銘柄一覧・指数の一覧を取得します。<strong>本日の呼び出し回数を3回</strong>使います（残り {usage ? usage.remaining : '不明'} 回）。</>, okLabel: '確認する' }))) return;
    const r = await client().verify();
    setSteps(r.steps);
    setSecs(r.securities);
    await refresh();
    toast(r.ok ? '確認が終わりました' : '一部確認できませんでした');
  });

  const testOne = (sec: BackendSecurity) => run(`${sec.name} を確認中…`, async () => {
    const cand = candidate[sec.id]?.trim();
    if (sec.kind === 'fund' && !cand) throw new Error('EODHDの銘柄記号（例 XXXX.EXCHANGE）を入力してください');
    if (!(await confirm({ title: '株価の取得を確認', message: <>{cand ?? sec.symbol} の直近2週間の日足をEODHDから取得します。<strong>呼び出し回数を1回</strong>使います。</>, okLabel: '取得する' }))) return;
    const r = await client().test(sec.id, cand || undefined);
    toast(r.message);
    await refresh();
  }).catch(() => refresh());

  return (
    <>
      <div className="notice" style={{ marginBottom: 12 }}>
        株価・配当は <strong>EODHD API</strong> だけから取得します。EODHDのAPIキーはこのアプリには保存せず、ご自身のバックエンド（Cloudflare Worker）にだけ保存します。ここに入れるのはバックエンドのURLと合言葉です。<br />
        無料プランは <strong>1日20回</strong>まで（日本時間9:00にリセット）、株価履歴は過去1年分です。EODHDから取得できなかった値は空欄のまま表示し、推測で埋めません。
      </div>
      <div className="field"><label>バックエンドのURL</label><input type="url" placeholder="https://kav-backend.xxxx.workers.dev" value={url} onChange={(e) => setUrl(e.target.value)} /></div>
      <div className="field"><label>合言葉（APP_TOKEN）</label><input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" /><span className="hint">バックエンドに登録した合言葉です。EODHDのAPIキーではありません。バックアップには含まれません。</span></div>
      <div className="grid2">
        <button className="btn primary" onClick={save} disabled={!!busy}>保存</button>
        <button className="btn" onClick={test} disabled={!!busy || !url}>接続テスト</button>
      </div>
      {health && <div className="tiny dim" style={{ marginTop: 8 }}>バックエンド {health.version}：EODHDのAPIキー {health.eodhdKey ? '設定済み' : '未設定'}・合言葉 {health.appToken ? '設定済み' : '未設定'}・データベース {health.dbReady ? '準備OK' : '未作成'}</div>}

      {usage && (
        <div className="notice" style={{ marginTop: 12 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}><strong>本日のEODHD使用回数</strong><span className={usage.remaining <= usage.reserve ? 'warn' : ''}>{usage.used} / {usage.limit} 回</span></div>
          <div className="tiny dim">残り {usage.remaining} 回（うち{usage.reserve}回は手動操作用の予備）・次のリセット {dateTime(usage.resetsAt)}{usage.exhausted ? '・本日は上限に達しました' : ''}</div>
          <div className="tiny dim">{usage.remoteCheckedAt ? `EODHD側の記録 ${usage.remoteUsed ?? '不明'}/${usage.remoteLimit ?? '不明'} 回（${dateTime(usage.remoteCheckedAt)} 照合）` : 'EODHD側の記録とはまだ照合していません（接続テストで照合します）'}</div>
        </div>
      )}

      {configured && (
        <>
          <div className="section-title">対応銘柄の確認</div>
          <div className="tiny dim" style={{ marginBottom: 8 }}>EODHDの公式の銘柄一覧で確認します。一覧に載っていても、実際に株価を取得できるまでは「対応」にしません。</div>
          <button className="btn block" onClick={verify} disabled={!!busy || (usage?.remaining ?? 0) < 3}>{busy ?? 'EODHDで対応銘柄を確認する（3回使用）'}</button>
          {steps && <div style={{ marginTop: 8 }}>{steps.map((x) => <div key={x.step} className={`tiny ${x.ok ? 'dim' : 'down'}`}>{x.ok ? '✓' : '×'} {x.step}：{x.message}</div>)}</div>}
          {secs && (
            <div className="list" style={{ marginTop: 10 }}>
              {secs.map((x) => (
                <div key={x.id} className="list-item" style={{ cursor: 'default', alignItems: 'flex-start' }}>
                  <div className="grow">
                    <div className="name">{x.name}</div>
                    <div className="tiny dim">{KIND_LABEL[x.kind]}・{x.symbol.startsWith('FUND:') ? '銘柄記号なし' : x.symbol}{x.eodhd_name ? `・EODHD名称 ${x.eodhd_name}` : ''}</div>
                    <div className={`tiny ${STATUS_CLASS[x.eodhd_status]}`}>{STATUS_LABEL[x.eodhd_status]}</div>
                    {x.status_note && <div className="tiny dim">{x.status_note}{x.verified_at ? `（${dateTime(x.verified_at)}）` : ''}</div>}
                    {x.kind === 'fund' && x.eodhd_status !== 'supported' && (
                      <input style={{ marginTop: 6 }} placeholder="EODHDの銘柄記号がわかれば入力" value={candidate[x.id] ?? ''} onChange={(e) => setCandidate((p) => ({ ...p, [x.id]: e.target.value }))} />
                    )}
                  </div>
                  {x.eodhd_status !== 'supported' && x.eodhd_status !== 'unsupported' && (x.kind !== 'fund' || candidate[x.id]?.trim()) && (
                    <button className="btn small" onClick={() => testOne(x)} disabled={!!busy || (usage?.remaining ?? 0) < 1}>取得を確認（1回）</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
