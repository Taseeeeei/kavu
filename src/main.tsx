import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './ui/App';
import './ui/styles.css';
import { requestPersistence } from './db/db';
import { recordSnapshot } from './db/repo';
import { shouldAutoSync, syncAll } from './services/sync';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);

if ('serviceWorker' in navigator) registerSW({ immediate: true });

const autoSync = async () => {
  if (navigator.onLine && (await shouldAutoSync())) {
    await syncAll().catch(() => undefined);
    await recordSnapshot().catch(() => undefined);
  }
};
(async () => {
  await requestPersistence();
  await recordSnapshot().catch(() => undefined);
  await autoSync();
})();
// アプリに戻ったとき（ホーム画面アプリの再表示を含む）にも間隔を確認する
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') autoSync(); });
