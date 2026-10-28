/**
 * OS notifications for price alerts — safe + non-throwing everywhere; silently degrades
 * when notifications are unavailable or not (yet) permitted. The audio is the alert cue
 * (played by the caller), so `silent: true` here avoids the OS adding its own chime.
 *
 * TWO delivery paths (2026-09-18):
 *  - Service worker `registration.showNotification()` when a worker controls the page
 *    (the installed PWA / store app, and tickerall.com/terminal in general). Android
 *    Chrome does NOT allow the page-level `new Notification()` at all ("Illegal
 *    constructor"), so this is the only path that works on a phone — and it keeps
 *    working while the app is in the background as long as the page is alive. The
 *    worker owns the tap (focus / open the Charts view).
 *  - `new Notification()` otherwise (desktop browsers, Electron).
 * Permission is requested from a USER GESTURE (Android requires it): the Alerts panel
 * calls requestNotificationPermission() when an alert is added; notify() also asks once
 * as a fallback for hosts where that didn't happen.
 */
type NotificationCtor = {
  new (title: string, opts?: NotificationOptions): unknown;
  permission: 'default' | 'granted' | 'denied';
  requestPermission(): Promise<'default' | 'granted' | 'denied'>;
};
type NotificationOptions = { body?: string; silent?: boolean; tag?: string; icon?: string; data?: unknown };
type SwRegistrationLike = { showNotification(title: string, opts?: NotificationOptions): Promise<void> };

function ctor(): NotificationCtor | null {
  const g = globalThis as unknown as { Notification?: NotificationCtor };
  const N = g.Notification;
  // Must be a constructor with the static permission API to be usable.
  return N && typeof N === 'function' && 'permission' in N ? N : null;
}

/** The controlling service-worker registration, or null (no SW, no support, SSR). */
function swRegistration(): Promise<SwRegistrationLike> | null {
  const nav = (globalThis as unknown as { navigator?: { serviceWorker?: { controller: unknown; ready: Promise<SwRegistrationLike> } } }).navigator;
  const sw = nav?.serviceWorker;
  if (!sw || !sw.controller) return null;
  return sw.ready;
}

const OPTS = (body?: string, tag = 'tickerall-alert'): NotificationOptions => ({
  body, silent: true, tag, icon: 'icon-192.png', data: { url: '/terminal?view=charts' },
});

function show(N: NotificationCtor, title: string, body?: string, tag?: string): void {
  const reg = swRegistration();
  if (reg) {
    // Worker path first; if it rejects (no active worker after all), fall back to the page.
    void reg.then((r) => r.showNotification(title, OPTS(body, tag))).catch(() => { try { new N(title, OPTS(body, tag)); } catch { /* ignore */ } });
    return;
  }
  try { new N(title, OPTS(body, tag)); } catch { /* Android page-level ctor, or a hidden document — nothing else to do */ }
}

/** Ask for notification permission — call from a user gesture (a tap/click). Resolves to the
 *  resulting permission; 'denied' or 'default' when unsupported. Never throws. */
export async function requestNotificationPermission(): Promise<'default' | 'granted' | 'denied'> {
  const N = ctor();
  if (!N) return 'denied';
  if (N.permission !== 'default') return N.permission;
  try { requested = true; return await N.requestPermission(); } catch { return 'default'; }
}

let requested = false;
/** Raise an OS notification if possible. `tag` dedupes: a later notification with the same
 *  tag replaces this one (the server push for an alert uses `alert-<id>`, same as the local fire). */
export function notify(title: string, body?: string, tag?: string): void {
  const N = ctor();
  if (!N) return; // no Notification support → rely on the in-app toast
  try {
    if (N.permission === 'granted') { show(N, title, body, tag); return; }
    if (N.permission === 'default' && !requested) {
      requested = true;
      // Ask once; if granted, show THIS notification immediately so the first alert
      // isn't silently dropped while the prompt was up.
      void N.requestPermission()
        .then((perm) => { if (perm === 'granted') show(N, title, body, tag); })
        .catch(() => { /* ignore */ });
    }
  } catch {
    /* never let a notification failure break the alert path */
  }
}
