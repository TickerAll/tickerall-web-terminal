/**
 * Alerts store — the persisted list of price alerts + a framework-light observable
 * over it (TERMINAL-ROADMAP area I). An alert is
 * `{ id, accountId, symbol, op:'above'|'below', price, enabled, triggeredAt? }`.
 *
 * PERSISTENCE CHOICE (the lower-risk option, per the task): alerts live under the
 * already-frozen settings store at `alerts.items`, NOT a new dedicated IPC channel.
 * Rationale: the settings store + its 5 IPC channels + atomic write are already
 * shipped and live; piggy-backing on them means zero new main-process surface, zero
 * new preload forwarders, and the alerts inherit the atomic write-temp+rename + the
 * `settings:changed` broadcast for free. The schema addition is purely additive
 * (`alerts: { osNotifications, items: [] }`) with no migration, so an older
 * `settings.json` deep-merges to the new default cleanly.
 *
 * This module is the single read/write seam:
 *   - `useAlerts()` — React subscription to the live list (re-renders on change).
 *   - `getAlerts()` — imperative snapshot (the engine reads this every tick).
 *   - `addAlert / removeAlert / setEnabled / markTriggered / rearm / clearTriggered`
 *     — mutations that persist back through `setSetting('alerts.items', …)`.
 *
 * The local mirror is kept in sync with the settings store via `subscribe('alerts.…')`
 * so an Import/Reset (or a change from another window) reflects immediately. Writes go
 * to the store and bounce back through the same subscription — a single source of
 * truth, no divergence.
 */

import { useSyncExternalStore } from 'react';
import type { PriceAlert } from '../../shared/settingsSchema';
import { getSetting, setSetting, subscribe as subscribeSetting } from '../settings/store';

const SETTINGS_PATH = 'alerts.items';

/** The server mirror (installed by sync.ts when the TickerAll API has push alerts on). Every mutation
 *  below is applied locally first, then forwarded; a failed forward is logged, never thrown. */
export interface AlertsRemote {
  create(a: PriceAlert): Promise<string>; // → the server id
  remove(id: string): Promise<void>;
  setEnabled(id: string, enabled: boolean): Promise<void>;
  rearm(id: string): Promise<void>;
}
let remote: AlertsRemote | null = null;
export function setAlertsRemote(r: AlertsRemote | null): void { remote = r; }
function forward(p: Promise<unknown>): void { p.catch((e) => console.warn('[alerts] sync failed', e)); }

// ── local mirror + observers ────────────────────────────────────────────────────
let items: PriceAlert[] = readFromSettings();
const listeners = new Set<() => void>();

function readFromSettings(): PriceAlert[] {
  const raw = getSetting<PriceAlert[]>(SETTINGS_PATH);
  return Array.isArray(raw) ? raw : [];
}

function emit(): void {
  for (const l of listeners) l();
}

// Keep the mirror current when the settings store changes (import / reset / another
// window). The settings store fires this with the new value already merged.
subscribeSetting(SETTINGS_PATH, (v) => {
  items = Array.isArray(v) ? (v as PriceAlert[]) : [];
  emit();
});

/** Persist a new list (and the mirror updates when the subscription bounces back). */
function persist(next: PriceAlert[]): void {
  items = next; // optimistic: reflect immediately; the subscription will confirm
  emit();
  setSetting(SETTINGS_PATH, next);
}

// ── reads ───────────────────────────────────────────────────────────────────────

/** Imperative snapshot (stable ref until a mutation) — the engine reads this. */
export function getAlerts(): PriceAlert[] {
  return items;
}

let idCounter = 0;
/** A collision-free id for a new alert. */
export function nextAlertId(): string {
  idCounter += 1;
  return `al_${Date.now().toString(36)}_${idCounter.toString(36)}`;
}

// ── mutations (all persist) ───────────────────────────────────────────────────────

export function addAlert(a: Omit<PriceAlert, 'id'> & { id?: string }): PriceAlert {
  // `a` always carries `enabled` (it's required on PriceAlert); the caller decides it.
  const alert: PriceAlert = { ...a, id: a.id ?? nextAlertId() };
  persist([...items, alert]);
  if (remote) {
    const r = remote;
    // The server owns ids: swap the temp id for the server's once it answers. If the alert
    // was deleted meanwhile, delete it on the server too so nothing is orphaned there.
    forward(r.create(alert).then((sid) => {
      if (items.some((x) => x.id === alert.id)) persist(items.map((x) => (x.id === alert.id ? { ...x, id: sid } : x)));
      else return r.remove(sid);
    }));
  }
  return alert;
}

/** Replace the whole list without forwarding (the server list on sync). */
export function replaceAlerts(next: PriceAlert[]): void {
  persist(next);
}

export function removeAlert(id: string): void {
  const next = items.filter((x) => x.id !== id);
  if (next.length !== items.length) persist(next);
  if (remote) forward(remote.remove(id));
}

export function setEnabled(id: string, enabled: boolean): void {
  persist(items.map((x) => (x.id === id ? { ...x, enabled } : x)));
  if (remote) forward(remote.setEnabled(id, enabled));
}

/** Mark an alert as fired (records the time and prevents re-fire until re-armed). */
export function markTriggered(id: string, at = Date.now()): void {
  persist(items.map((x) => (x.id === id ? { ...x, triggeredAt: at } : x)));
}

/** Re-arm a fired alert (clear `triggeredAt` + ensure it is enabled) so it can fire
 *  again on the next crossing. */
export function rearm(id: string): void {
  persist(
    items.map((x) => (x.id === id ? { ...x, triggeredAt: undefined, enabled: true } : x)),
  );
  if (remote) forward(remote.rearm(id));
}

/** Clear a fired alert's trigger WITHOUT changing its enabled flag (used internally
 *  when an alert's price/side is edited — it should re-evaluate fresh). */
export function clearTriggered(id: string): void {
  persist(items.map((x) => (x.id === id ? { ...x, triggeredAt: undefined } : x)));
}

/** Replace an alert's price and/or side, re-arming it (a moved threshold should fire
 *  again). No-op if the alert is gone. */
export function updateAlert(id: string, patch: Partial<Pick<PriceAlert, 'price' | 'op'>>): void {
  persist(
    items.map((x) =>
      x.id === id ? { ...x, ...patch, triggeredAt: undefined } : x,
    ),
  );
}

/** Remove every alert (e.g. a "clear all" action). */
export function clearAlerts(): void {
  if (items.length > 0) persist([]);
}

// ── React subscription ─────────────────────────────────────────────────────────
function subscribeStore(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Subscribe to the live alert list. */
export function useAlerts(): PriceAlert[] {
  return useSyncExternalStore(subscribeStore, getAlerts);
}
