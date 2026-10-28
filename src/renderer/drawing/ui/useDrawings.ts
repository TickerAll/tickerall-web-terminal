/**
 * React hooks over a DrawingStore — the toolbar + object-manager consume the same
 * store the overlay mutates, via `useSyncExternalStore`, so the UI and the canvas
 * stay in lockstep with no extra state plumbing.
 */

import { useSyncExternalStore } from 'react';
import type { DrawingStore } from '../DrawingStore';
import type { Drawing } from '../types';

/** The ordered drawings (stable reference until a mutation). */
export function useDrawingList(store: DrawingStore): Drawing[] {
  return useSyncExternalStore(store.subscribe, store.list);
}

/** The primary selected id (null when nothing is selected). */
export function useSelectedId(store: DrawingStore): string | null {
  return useSyncExternalStore(store.subscribe, store.selectedId);
}

/** The full multi-selection id set, as a comma-joined key (so React diffs cheaply).
 *  Use `.split(',')` (filtering empties) for the array, or `useSelectedSet`. */
export function useSelectedKey(store: DrawingStore): string {
  return useSyncExternalStore(store.subscribe, () => store.selectedIds().join(','));
}

/** The full multi-selection as a Set (rebuilt only when the selection changes). */
export function useSelectedSet(store: DrawingStore): Set<string> {
  const key = useSelectedKey(store);
  return new Set(key ? key.split(',') : []);
}

/** Undo/redo availability (re-renders when either stack changes via a mutation). */
export function useHistoryState(store: DrawingStore): { canUndo: boolean; canRedo: boolean } {
  // canUndo/canRedo change only alongside a store mutation, which fires subscribe.
  const canUndo = useSyncExternalStore(store.subscribe, () => store.canUndo());
  const canRedo = useSyncExternalStore(store.subscribe, () => store.canRedo());
  return { canUndo, canRedo };
}
