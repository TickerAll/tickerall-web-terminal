/**
 * Alerts ↔ the TickerAll API sync + web-push registration (the "fire while the app is closed" half).
 *
 * When the host api exposes `serverAlerts` AND the TickerAll API answers the VAPID key (push alerts
 * switched on), alerts become customer-scoped: the server list replaces the device list,
 * every store mutation is forwarded (store.ts → AlertsRemote), and the panel offers
 * "Notify this device when the app is closed" which registers a PushSubscription with
 * the TickerAll API. The local engine keeps firing in-app regardless; the server push for the same
 * alert carries the same `alert-<id>` tag, so the OS shows one notification, not two.
 * Without the server half (desktop, or the flag off) everything stays device-local.
 */
import { useSyncExternalStore } from 'react';
import type { ServerAlertsApi, PushSubscriptionJson } from '../../shared/types';
import { getAlerts, replaceAlerts, setAlertsRemote } from './store';
import { requestNotificationPermission } from './notify';
import { mergeAfterMigration, planMigration, toLocal, vapidKeyBytes } from './syncCore';
import type { PriceAlert } from '../../shared/settingsSchema';

export interface PushState {
  /** Server-side alerts are on (VAPID key answered) and this browser can do push. */
  available: boolean;
  /** This device holds a registered push subscription. */
  subscribed: boolean;
  /** In-flight enable/disable. */
  busy: boolean;
  /** Last failure, for the panel. */
  error: string | null;
}
let state: PushState = { available: false, subscribed: false, busy: false, error: null };
const listeners = new Set<() => void>();
function set(p: Partial<PushState>): void { state = { ...state, ...p }; for (const l of listeners) l(); }
export function usePushState(): PushState {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => state);
}

let api: ServerAlertsApi | null = null;
let vapidKey: string | null = null;

type PushSubLike = { endpoint: string; toJSON(): { endpoint?: string; keys?: { p256dh?: string; auth?: string } }; unsubscribe(): Promise<boolean> };
type RegLike = { pushManager: { getSubscription(): Promise<PushSubLike | null>; subscribe(o: { userVisibleOnly: boolean; applicationServerKey: Uint8Array }): Promise<PushSubLike> } };

function swReady(): Promise<RegLike> | null {
  const g = globalThis as unknown as { navigator?: { serviceWorker?: { ready: Promise<RegLike> } }; PushManager?: unknown };
  if (!g.PushManager || !g.navigator?.serviceWorker) return null;
  return g.navigator.serviceWorker.ready;
}

function subJson(s: PushSubLike): PushSubscriptionJson | null {
  const j = s.toJSON();
  if (!j.endpoint || !j.keys?.p256dh || !j.keys?.auth) return null;
  const ua = (globalThis as unknown as { navigator?: { userAgent?: string } }).navigator?.userAgent;
  return { endpoint: j.endpoint, keys: { p256dh: j.keys.p256dh, auth: j.keys.auth }, ...(ua ? { userAgent: ua.slice(0, 200) } : {}) };
}

/** Boot: probe the server, adopt its list (migrating device-only alerts up), install the
 *  remote hook, and re-register an existing push subscription. Safe to call once per load. */
export async function initAlertsSync(sa: ServerAlertsApi | undefined): Promise<void> {
  if (!sa) return;
  try { vapidKey = await sa.vapidPublicKey(); } catch { vapidKey = null; }
  if (!vapidKey) return; // server half dark → device-local
  api = sa;
  try {
    const local = getAlerts();
    const failed: PriceAlert[] = [];
    for (const a of planMigration(local)) {
      let row;
      try { row = await sa.create({ accountId: a.accountId, symbol: a.symbol, op: a.op, price: a.price }); }
      catch { failed.push(a); continue; } // kept locally; retried on the next load
      // A paused alert must not come back armed: if the pause fails, undo the create and retry later.
      if (!a.enabled) {
        try { await sa.patch(row.id, { enabled: false }); }
        catch {
          const id = row.id;
          await sa.remove(id).catch(() => console.warn(`[alerts] orphaned ARMED server alert ${id} (pause and undo both failed)`));
          failed.push(a);
        }
      }
    }
    replaceAlerts(mergeAfterMigration((await sa.list()).map(toLocal), failed, local));
  } catch (e) { console.warn('[alerts] server sync failed', e); return; }
  setAlertsRemote({
    create: async (a) => (await sa.create({ accountId: a.accountId, symbol: a.symbol, op: a.op, price: a.price })).id,
    remove: (id) => sa.remove(id),
    setEnabled: async (id, enabled) => { await sa.patch(id, { enabled }); },
    rearm: async (id) => { await sa.patch(id, { rearm: true }); },
  });
  const ready = swReady();
  set({ available: ready != null });
  if (!ready) return;
  try {
    const sub = await (await ready).pushManager.getSubscription();
    const j = sub ? subJson(sub) : null;
    if (j) { await sa.subscribePush(j); set({ subscribed: true }); } // refresh lastSeenAt / re-own
  } catch { /* stays unsubscribed */ }
}

/** Register this device for pushes (call from a tap: permission needs a gesture). */
export async function enableDevicePush(): Promise<void> {
  const ready = swReady();
  if (!api || !vapidKey || !ready) return;
  set({ busy: true, error: null });
  try {
    if ((await requestNotificationPermission()) !== 'granted') { set({ busy: false, error: 'Notifications are blocked for this site' }); return; }
    const reg = await ready;
    const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKeyBytes(vapidKey) });
    const j = subJson(sub);
    if (!j) throw new Error('subscription has no keys');
    await api.subscribePush(j);
    set({ busy: false, subscribed: true });
  } catch (e) {
    set({ busy: false, error: (e as Error)?.message || 'Could not enable push' });
  }
}

export async function disableDevicePush(): Promise<void> {
  const ready = swReady();
  if (!api || !ready) return;
  set({ busy: true, error: null });
  try {
    const sub = await (await ready).pushManager.getSubscription();
    if (sub) { try { await api.unsubscribePush(sub.endpoint); } catch { /* server may already have pruned it */ } await sub.unsubscribe(); }
    set({ busy: false, subscribed: false });
  } catch (e) {
    set({ busy: false, error: (e as Error)?.message || 'Could not disable push' });
  }
}
