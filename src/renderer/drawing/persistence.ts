/**
 * Drawing persistence — saves/restores a pane's drawings per (account, symbol, tf)
 * via the settings store (Foundation 1). The lower-risk of the two options the
 * roadmap offers: the settings store already does atomic write-temp+rename, ordered
 * migrations, deep-merge-over-defaults and a renderer mirror — so this is a thin,
 * additive layer (the `drawing.byContext` map), NOT a new IPC channel or main file.
 *
 * Scope key: `${accountId}:${symbol}:${tf}`. A drawing made on one instrument is
 * stored under that key and restored only when that exact context is shown again —
 * so it reappears on return and never bleeds onto another instrument.
 *
 * Writes replace the WHOLE `drawing.byContext` map (read-modify-write the freshest
 * snapshot first), so a key that itself contains dots/colons is never dot-path'd.
 * The pure conversion logic lives in `persistenceCodec.ts` (settings-free + tested);
 * this module just bridges it to `getSetting`/`setSetting`.
 */

import { getSetting, setSetting } from '../settings/store';
import type { Drawing } from './types';
import type { PersistedDrawing, DrawingSettings } from '../../shared/settingsSchema';
import { decodeList, encodeList } from './persistenceCodec';

export { contextKey, debounce } from './persistenceCodec';

/** Read the saved drawings for a context (empty array when none / no key). */
export function loadDrawings(key: string | null): Drawing[] {
  if (!key) return [];
  const drawing = getSetting<DrawingSettings>('drawing');
  return decodeList(drawing?.byContext?.[key]);
}

/** Persist the given drawings under a context key (replacing that key's list). A
 *  null/empty key is a no-op. An empty list removes the key (keeps the map tidy). */
export function saveDrawings(key: string | null, drawings: Drawing[]): void {
  if (!key) return;
  // Read the FRESHEST byContext map and replace just this key, so concurrent panes
  // don't clobber each other's keys.
  const drawing = getSetting<DrawingSettings>('drawing');
  const byContext: Record<string, PersistedDrawing[]> = { ...(drawing?.byContext ?? {}) };
  const recs = encodeList(drawings);
  if (recs.length === 0) delete byContext[key];
  else byContext[key] = recs;
  setSetting('drawing.byContext', byContext);
}

/** Read the persisted default style (the toolbar's last-used style). */
export function loadDefaultStyle(): Drawing['style'] {
  const drawing = getSetting<DrawingSettings>('drawing');
  const s = drawing?.defaultStyle;
  return {
    color: s?.color ?? 'var(--accent)',
    width: s?.width ?? 2,
    lineStyle: (s?.lineStyle as Drawing['style']['lineStyle']) ?? 'solid',
    fill: s?.fill,
  };
}

/** Persist the default style (so the next pane / launch keeps it). */
export function saveDefaultStyle(style: Drawing['style']): void {
  setSetting('drawing.defaultStyle', { color: style.color, width: style.width, lineStyle: style.lineStyle, fill: style.fill });
}

/** Read the persisted magnet preference (default on). */
export function loadMagnet(): boolean {
  const drawing = getSetting<DrawingSettings>('drawing');
  return drawing?.magnet !== false;
}

/** Persist the magnet preference. */
export function saveMagnet(on: boolean): void {
  setSetting('drawing.magnet', on);
}
