/**
 * Pure helpers for the alerts ↔ the TickerAll API sync (no DOM, no api — unit-tested in node).
 */
import type { PriceAlert } from '../../shared/settingsSchema';
import type { ServerAlertRow } from '../../shared/types';

/** Local (device-only) ids come from nextAlertId(); server ids are cuids. */
export const isLocalId = (id: string): boolean => id.startsWith('al_');

export function toLocal(r: ServerAlertRow): PriceAlert {
  const t = r.triggeredAt ? Date.parse(r.triggeredAt) : NaN;
  return {
    id: r.id, accountId: r.accountId, symbol: r.symbol, op: r.op, price: r.price, enabled: r.enabled,
    ...(Number.isFinite(t) ? { triggeredAt: t } : {}),
  };
}

/**
 * First sync after the server side appears: alerts that only exist on this device are
 * migrated up — armed AND paused (a paused one comes back paused); a fired alert stays on
 * the device only (see mergeAfterMigration). Returns the alerts to create.
 */
export function planMigration(local: PriceAlert[]): PriceAlert[] {
  return local.filter((a) => isLocalId(a.id) && a.triggeredAt == null);
}

/** The list after migration: the server's answer, plus device-only alerts that did not go
 *  up — failed uploads (retried next load) and fired ones (kept so the user can re-arm them;
 *  once re-armed, planMigration uploads them on the next load). Nothing is dropped. */
export function mergeAfterMigration(server: PriceAlert[], failed: PriceAlert[], local: PriceAlert[]): PriceAlert[] {
  const fired = local.filter((a) => isLocalId(a.id) && a.triggeredAt != null);
  return [...server, ...failed, ...fired];
}

/** VAPID public key (base64url) → the Uint8Array pushManager.subscribe() wants. */
export function vapidKeyBytes(b64url: string): Uint8Array {
  const pad = '='.repeat((4 - (b64url.length % 4)) % 4);
  const b64 = (b64url + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
