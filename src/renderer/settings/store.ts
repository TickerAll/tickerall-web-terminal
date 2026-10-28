/**
 * Renderer-side settings store (Foundation 1). Mirrors the main-process settings over
 * IPC into an external store the React hooks read from, and stays in sync via the
 * `settings:changed` broadcast. This is the frozen public contract every feature
 * cluster persists through — import the hooks from `./hooks`, or the imperative
 * `getSetting`/`setSetting`/`subscribe` from here.
 */

import { api } from '../api';
import { AppSettings, DEFAULT_SETTINGS, getByPath, applyChartToAll } from '../../shared/settingsSchema';

let snapshot: AppSettings = DEFAULT_SETTINGS;
const storeListeners = new Set<() => void>();
const pathListeners = new Map<string, Set<(v: unknown) => void>>();

function applySnapshot(next: AppSettings): void {
  const prev = snapshot;
  snapshot = next;
  for (const l of storeListeners) l();
  // Fire path subscribers whose value actually changed (leaf primitives compare by
  // value; object-valued paths compare by ref — over-notify is harmless).
  for (const [path, subs] of pathListeners) {
    if (getByPath(prev, path) !== getByPath(next, path)) {
      const v = getByPath(next, path);
      for (const cb of subs) cb(v);
    }
  }
}

let inited = false;
/** Hydrate from the main process + subscribe to live changes. Idempotent. */
export function initSettings(): Promise<void> {
  if (inited) return Promise.resolve();
  inited = true;
  api.onSettingsChanged((s) => applySnapshot(s));
  return api.settingsGet().then((s) => applySnapshot(s)).catch(() => { /* defaults stand */ });
}

// ── External-store interface (for useSyncExternalStore) ──
export function getSnapshot(): AppSettings { return snapshot; }
export function subscribeStore(l: () => void): () => void { storeListeners.add(l); return () => { storeListeners.delete(l); }; }

// ── Imperative API ──
export function getSetting<T = unknown>(path: string): T { return getByPath(snapshot, path) as T; }
export function setSetting(path: string, value: unknown): void { void api.settingsSet(path, value); }
export function resetSettings(section?: string): void { void api.settingsReset(section); }
export function exportSettings(): Promise<string> { return api.settingsExport(); }
export function importSettings(json: string): void { void api.settingsImport(json); }

/**
 * "Apply to all charts" (Item 12): promote the active chart's effective per-chartable
 * settings to the GLOBAL base and clear every chart's per-chart override of those keys,
 * so all charts inherit the same values. Computed by the pure `applyChartToAll` helper
 * and persisted atomically (one full-settings replace) so the perChart deletions land —
 * a per-path set can't DELETE an override. No-op when `chartKey` is null.
 */
export function applyChartSettingsToAll(chartKey: string | null): void {
  if (!chartKey) return;
  const next = applyChartToAll(snapshot, chartKey);
  void api.settingsImport(JSON.stringify(next));
}

/** Subscribe to one dot-path; the callback fires with the new value on change. */
export function subscribe(path: string, cb: (v: unknown) => void): () => void {
  let set = pathListeners.get(path);
  if (!set) { set = new Set(); pathListeners.set(path, set); }
  set.add(cb);
  return () => { set!.delete(cb); if (set!.size === 0) pathListeners.delete(path); };
}

// Hydrate as soon as this module is first imported (preload bridge is already live).
void initSettings();
