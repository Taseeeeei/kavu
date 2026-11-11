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

(async () => {
  await requestPersistence();
  await recordSnapshot().catch(() => undefined);
  if (navigator.onLine && (await shouldAutoSync())) {
    await syncAll().catch(() => undefined);
    await recordSnapshot().catch(() => undefined);
  }
})();
