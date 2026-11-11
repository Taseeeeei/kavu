type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let deferred: BIPEvent | null = null;
const listeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as BIPEvent; listeners.forEach((l) => l()); });
  window.addEventListener('appinstalled', () => { deferred = null; listeners.forEach((l) => l()); });
}
export const canPromptInstall = () => !!deferred;
export const onInstallChange = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };
export async function promptInstall() {
  if (!deferred) return false;
  await deferred.prompt();
  const r = await deferred.userChoice;
  deferred = null;
  listeners.forEach((l) => l());
  return r.outcome === 'accepted';
}
export const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
