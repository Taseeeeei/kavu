import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useLocation } from 'react-router-dom';
import { db, requestPersistence } from '../../db/db';
import { saveSettings } from '../../db/settings';
import { useSettings } from '../hooks';
import { exportJson, restoreJson, validateBackup, restoreSecurity, purgeSecurity, createLocalBackup } from '../../db/repo';
import { exportCsv, importCsv, csvTemplate, CSV_HEADERS, type CsvKind } from '../../services/csvio';
import { decodeCsvBytes } from '../../domain/csv';
import { notificationSupport, requestNotificationPermission, showSystemNotifications } from '../../services/notify';
import { canPromptInstall, onInstallChange, promptInstall, isIos } from '../../services/install';
import { dateTime } from '../../domain/format';
import { toYmd } from '../../domain/util';
import { Card, download, useConfirm, useToast } from '../components/common';
import { EodhdPanel } from '../components/EodhdPanel';

const CSV_LABEL: Record<CsvKind, string> = { securities: '銘柄', trades: '売買履歴', dividends: '配当受取記録', forecasts: '配当予想' };

export default function Settings() {
  const s = useSettings();
  const toast = useToast();
  const confirm = useConfirm();
  const loc = useLocation();
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [usage, setUsage] = useState<string>('');
  const [, force] = useState(0);
  const [perm, setPerm] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported');
  const jsonRef = useRef<HTMLInputElement>(null);
  const csvRef = useRef<HTMLInputElement>(null);
  const trash = useLiveQuery(() => db.securities.filter((x) => !!x.deletedAt).toArray(), []);
  const backups = useLiveQuery(() => db.backups.orderBy('createdAt').reverse().toArray(), []);
  const logs = useLiveQuery(() => db.syncLogs.orderBy('at').reverse().limit(8).toArray(), []);
  const support = notificationSupport();

  useEffect(() => { const off = onInstallChange(() => force((x) => x + 1)); return () => { off(); }; }, []);
  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null));
    navigator.storage?.estimate?.().then((e) => setUsage(`${((e.usage ?? 0) / 1024 / 1024).toFixed(1)}MB 使用中`)).catch(() => {});
  }, []);
  useEffect(() => { if (loc.hash) document.getElementById(loc.hash.slice(1))?.scrollIntoView(); }, [loc.hash]);

  const backupJson = async () => { download(`kav-backup-${toYmd(new Date())}.json`, await exportJson(), 'application/json'); await saveSettings({}); toast('バックアップをダウンロードしました'); };
  const onRestoreFile = async (file: File) => {
    const text = await file.text();
    const v = validateBackup(text);
    if (!v.ok) return toast(v.error);
    const counts = Object.entries(v.data).map(([k, rows]) => `${k}: ${rows.length}`).join('、');
    if (!(await confirm({ title: 'バックアップから復元', message: <>現在のデータをすべて置き換えます（作成日時 {dateTime(v.exportedAt)}／{counts}）。<br />復元前の状態は端末内の自動バックアップに保存されます。</>, okLabel: '復元する', danger: true, requireText: '復元' }))) return;
    try { await restoreJson(text); toast('復元しました'); } catch (e) { toast((e as Error).message); }
  };
  const onCsvFile = async (file: File) => {
    try {
      const text = decodeCsvBytes(await file.arrayBuffer());
      const r = await importCsv(text);
      toast(`${CSV_LABEL[r.kind]}CSV：追加${r.added}件・重複スキップ${r.skippedDuplicates}件${r.errors.length ? `・エラー${r.errors.length}件` : ''}`);
      if (r.errors.length) await confirm({ title: '取り込めなかった行', message: <div style={{ maxHeight: 240, overflow: 'auto' }}>{r.errors.map((e) => <div key={e} className="small">{e}</div>)}</div>, okLabel: '閉じる' });
    } catch (e) { toast((e as Error).message); }
  };
  const enableNotify = async () => {
    const p = await requestNotificationPermission();
    setPerm(p);
    if (p === 'granted') {
      await saveSettings({ notifyEnabled: true });
      const reg = await navigator.serviceWorker?.getRegistration();
      const ps = (reg as unknown as { periodicSync?: { register: (t: string, o: { minInterval: number }) => Promise<void> } })?.periodicSync;
      if (ps) { try { await ps.register('kav-dividend-check', { minInterval: 12 * 3600 * 1000 }); } catch { /* 権限がない場合は無視 */ } }
      toast('通知を有効にしました');
    } else toast(p === 'unsupported' ? 'この環境は通知に対応していません' : '通知が許可されませんでした（端末の設定から許可できます）');
  };
  const testNotify = async () => {
    const n = await showSystemNotifications([{ id: 'test', securityId: '', code: '0000', name: 'テスト通知', kind: 'increase', before: 100, after: 120, diffPerShare: 20, rate: 20, sharesHeld: 100, annualImpact: 2000, basis: 'テスト', disclosureDate: toYmd(new Date()), detectedAt: new Date().toISOString(), source: 'manual', origin: 'manual', read: true }]);
    toast(n ? 'テスト通知を送信しました（これは実データではありません）' : '通知を表示できませんでした');
  };

  return (
    <>
      <Card title="EODHD接続（株価・配当の取得）"><div id="data-source" />
        <EodhdPanel />
        <div className="tiny dim" style={{ marginTop: 10 }}>株探・四季報オンライン・株予報Pro・IRバンク・投資の森は自動収集せず、銘柄詳細からリンクで開けるようにしています。</div>
        {logs && logs.length > 0 && <div style={{ marginTop: 10 }}>{logs.map((l) => <div key={l.id} className={`tiny ${l.level === 'error' ? 'down' : l.level === 'warn' ? 'warn' : 'dim'}`}>{dateTime(l.at)} {l.message}</div>)}</div>}
      </Card>

      <Card title="通知">
        <div className="small" style={{ marginBottom: 8 }}>増配・減配・無配を検知したとき、アプリ内の通知（ベルのバッジ）に加えて端末の通知を表示できます。</div>
        <div className="tiny dim" style={{ marginBottom: 10 }}>
          通知API：{support.notification ? '対応' : '非対応'}／Service Worker：{support.serviceWorker ? '対応' : '非対応'}／バックグラウンド定期確認：{support.periodicSync ? '対応（Android Chrome等、インストール時）' : '非対応（アプリを開いたときに確認）'}／状態：{perm === 'granted' ? '許可済み' : perm === 'denied' ? '拒否' : perm === 'unsupported' ? '非対応' : '未設定'}
          {isIos() && !support.standalone && <><br />iPhoneでは、ホーム画面に追加したアプリから開いたときのみ通知を許可できます（iOS 16.4以降）。</>}
        </div>
        <div className="grid2">
          {s.notifyEnabled && perm === 'granted' ? <button className="btn" onClick={() => saveSettings({ notifyEnabled: false })}>端末通知をオフ</button> : <button className="btn primary" onClick={enableNotify} disabled={!support.notification}>端末通知を有効にする</button>}
          <button className="btn" onClick={testNotify} disabled={perm !== 'granted'}>テスト通知</button>
        </div>
      </Card>

      <Card title="表示・計算">
        <div className="field"><label>株価の上昇・下落の色</label><select value={s.colorScheme} onChange={(e) => saveSettings({ colorScheme: e.target.value as 'global' | 'japan' })}><option value="global">上昇=緑／下落=赤</option><option value="japan">上昇=赤／下落=青（日本式）</option></select></div>
        <div className="field"><label>配当の税率（課税口座）</label>
          <select value={String(s.taxRate)} onChange={(e) => saveSettings({ taxRate: Number(e.target.value) })}><option value="0.20315">20.315%（所得税15.315%＋住民税5%）</option><option value="0.15315">15.315%（住民税を申告不要とした場合など）</option><option value="0">0%</option></select>
          <span className="hint">予想配当の「税引後（推定）」に使います。受取記録の税額は所得税・住民税を各々切り捨てて計算します。NISA口座の銘柄は非課税です。</span></div>
      </Card>

      <Card title="データ管理"><div id="data" />
        <div className="tiny dim" style={{ marginBottom: 10 }}>データはこの端末のブラウザ内（IndexedDB）に自動保存されます。{usage}。永続化：{persisted === true ? '有効（自動削除されにくい状態）' : persisted === false ? '未許可' : '不明'}
          {persisted === false && <button className="btn small ghost" onClick={async () => setPersisted(await requestPersistence())}>永続化を要求</button>}</div>
        <div className="section-title">JSONバックアップ（全データ）</div>
        <div className="grid2">
          <button className="btn primary" onClick={backupJson}>バックアップを保存</button>
          <button className="btn" onClick={() => jsonRef.current?.click()}>バックアップから復元</button>
        </div>
        <input ref={jsonRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onRestoreFile(f); e.target.value = ''; }} />
        <div className="section-title">CSVエクスポート</div>
        <div className="grid2">{(Object.keys(CSV_LABEL) as CsvKind[]).map((k) => <button key={k} className="btn small" onClick={async () => download(`kav-${k}-${toYmd(new Date())}.csv`, await exportCsv(k))}>{CSV_LABEL[k]}</button>)}</div>
        <div className="section-title">CSVインポート</div>
        <button className="btn block" onClick={() => csvRef.current?.click()}>CSVファイルを選んで取り込む</button>
        <input ref={csvRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onCsvFile(f); e.target.value = ''; }} />
        <div className="tiny dim" style={{ margin: '8px 0' }}>見出し行から種類を自動判別します（UTF-8／Shift_JIS対応）。同じ内容の行は重複として取り込みません。取り込み前に自動バックアップを作成します。配当予想CSVで値が変わった銘柄は増減配として記録されます（情報源：CSV）。</div>
        <div className="row wrap" style={{ gap: 6 }}>{(Object.keys(CSV_LABEL) as CsvKind[]).map((k) => <button key={k} className="btn small ghost" onClick={() => download(`kav-template-${k}.csv`, csvTemplate(k))} title={CSV_HEADERS[k].join(',')}>{CSV_LABEL[k]}テンプレート</button>)}</div>
        <div className="section-title">端末内の自動バックアップ（最新10件）</div>
        <button className="btn small" onClick={async () => { await createLocalBackup('手動作成'); toast('作成しました'); }}>今すぐ作成</button>
        {backups && backups.length > 0 ? <div className="list" style={{ marginTop: 6 }}>{backups.map((b) => (
          <div key={b.id} className="list-item" style={{ cursor: 'default' }}>
            <div className="grow small">{dateTime(b.createdAt)}<div className="tiny dim">{b.reason}</div></div>
            <button className="btn small" onClick={async () => { if (await confirm({ title: 'この時点に戻す', message: `${dateTime(b.createdAt)}（${b.reason}）の状態に戻します。現在の状態も自動バックアップされます。`, okLabel: '戻す', danger: true })) { await restoreJson(b.json); toast('復元しました'); } }}>復元</button>
          </div>))}</div> : <div className="tiny dim" style={{ marginTop: 6 }}>まだありません（インポート・復元・削除の前に自動作成されます）</div>}
      </Card>

      <Card title="ゴミ箱">
        {!trash || trash.length === 0 ? <div className="small muted">ゴミ箱は空です</div> : <div className="list">{trash.map((t) => (
          <div key={t.id} className="list-item" style={{ cursor: 'default' }}>
            <div className="grow"><div className="name">{t.name}</div><div className="tiny dim">{t.code}・{dateTime(t.deletedAt)}に削除</div></div>
            <button className="btn small" onClick={async () => { await restoreSecurity(t.id); toast('復元しました'); }}>復元</button>
            <button className="btn small danger" onClick={async () => { if (await confirm({ title: '完全に削除', message: `「${t.name}」の売買履歴・株価・配当予想・通知を完全に削除します（配当受取記録は残ります）。`, okLabel: '完全に削除', danger: true, requireText: '削除' })) { await purgeSecurity(t.id); toast('完全に削除しました'); } }}>完全削除</button>
          </div>))}</div>}
      </Card>

      <Card title="アプリ">
        {canPromptInstall() ? <button className="btn primary block" onClick={promptInstall}>ホーム画面にインストール</button> :
          <div className="small muted">{support.standalone ? 'インストール済みのアプリとして起動しています。' : isIos() ? 'Safariの共有ボタン →「ホーム画面に追加」でアプリとして使えます。' : 'ブラウザのメニューから「アプリをインストール」または「ホーム画面に追加」を選んでください。'}</div>}
        <div className="tiny dim" style={{ marginTop: 10 }}>カヴ v{__APP_VERSION__}・オフラインでも保有銘柄・配当記録を閲覧できます。本アプリの情報は投資判断の参考であり、正確性を保証するものではありません。</div>
      </Card>
    </>
  );
}
