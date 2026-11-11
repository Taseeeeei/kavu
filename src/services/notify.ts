import type { DividendChangeEvent } from '../domain/types';
import { CHANGE_KIND_LABELS } from '../domain/types';
import { signedYen, signedPct, dps } from '../domain/format';

export const notificationSupport = () => ({
  notification: typeof Notification !== 'undefined',
  serviceWorker: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
  periodicSync: typeof ServiceWorkerRegistration !== 'undefined' && 'periodicSync' in ServiceWorkerRegistration.prototype,
  standalone: typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true),
});

export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.requestPermission();
}

export function eventTitle(e: DividendChangeEvent) {
  return `【${CHANGE_KIND_LABELS[e.kind]}】${e.name}（${e.code}）`;
}
export function eventBody(e: DividendChangeEvent) {
  return `年間配当 ${dps(e.before)} → ${dps(e.after)}（${signedPct(e.rate, 1)}）／保有${e.sharesHeld}株で年間 ${signedYen(e.annualImpact)}`;
}

/** 端末通知を表示（Service Worker 経由。権限がない・非対応の場合は何もしない） */
export async function showSystemNotifications(events: DividendChangeEvent[], reg?: ServiceWorkerRegistration) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return 0;
  const r = reg ?? (await navigator.serviceWorker?.getRegistration());
  let n = 0;
  for (const e of events) {
    const opts: NotificationOptions = { body: eventBody(e), tag: e.id, icon: 'icons/icon-192.png', badge: 'icons/badge-72.png', data: { url: '#/notifications' } };
    if (r) await r.showNotification(eventTitle(e), opts);
    else new Notification(eventTitle(e), opts);
    n++;
  }
  try {
    const nav = navigator as unknown as { setAppBadge?: (n: number) => Promise<void> };
    if (nav.setAppBadge) await nav.setAppBadge(n);
  } catch { /* noop */ }
  return n;
}
