/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { clientsClaim } from 'workbox-core';
import { syncAll, shouldAutoSync } from './services/sync';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (string | { url: string; revision: string | null })[] };

// アプリ本体を事前キャッシュし、オフラインでも起動できるようにする
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));
self.skipWaiting();
clientsClaim();

// バックグラウンド定期確認（Periodic Background Sync 対応環境のみ）
self.addEventListener('periodicsync', (event: Event) => {
  const e = event as Event & { tag: string; waitUntil: (p: Promise<unknown>) => void };
  if (e.tag !== 'kav-dividend-check') return;
  e.waitUntil((async () => { if (await shouldAutoSync()) await syncAll({ reg: self.registration }); })());
});

// サーバーからのWeb Push（将来のプッシュサーバー用。ペイロードをそのまま表示）
self.addEventListener('push', (event) => {
  const data = (() => { try { return event.data?.json() as { title?: string; body?: string } | undefined; } catch { return undefined; } })();
  if (!data?.title) return;
  event.waitUntil(self.registration.showNotification(data.title, { body: data.body, icon: 'icons/icon-192.png', data: { url: '#/notifications' } }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data?.url as string) ?? '#/notifications', self.registration.scope).href;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { if ('focus' in c) { await (c as WindowClient).navigate(url).catch(() => undefined); return (c as WindowClient).focus(); } }
    return self.clients.openWindow(url);
  })());
});
