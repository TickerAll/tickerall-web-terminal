/**
 * Pure (settings-free) codec for drawing persistence — kept separate from
 * `persistence.ts` so it imports NOTHING from the settings store / preload bridge
 * and can be unit-tested under Node (the settings store touches `window` at import).
 *
 * Converts between a runtime `Drawing` and its JSON-persisted form, builds the
 * per-(account,symbol,tf) scope key, and provides a small debounce used to batch the
 * many store mutations a drag fires into one IPC write.
 */

import type { Drawing } from './types';
import type { PersistedDrawing } from '../../shared/settingsSchema';

/** Build the per-context scope key. Returns null when the context is incomplete
 *  (no account / no symbol) — drawings only persist for a real charted instrument.
 *
 *  Scope is per (account, SYMBOL) — NOT per timeframe. Objects are anchored in
 *  (time, price), so an object drawn on one timeframe belongs on ALL timeframes of the
 *  same symbol (the way MT5 / TradingView share objects across timeframes). The `tf`
 *  parameter is kept for call-site compatibility but intentionally NOT part of the key. */
export function contextKey(accountId: string | null, symbol: string | null, _tf: number): string | null {
  if (!accountId || !symbol) return null;
  return `${accountId}:${symbol}`;
}

/** Only persist genuine USER drawings. */
export function isPersistable(d: Drawing): boolean {
  return d.source !== undefined ? d.source === 'user' : true;
}

/** A Drawing → its JSON-persisted form (drops transient fields; keeps geometry+style). */
export function toPersisted(d: Drawing): PersistedDrawing {
  return {
    id: d.id,
    kind: d.kind,
    points: d.points.map((p) => ({ time: p.time, price: p.price })),
    style: { ...d.style },
    ...(d.locked ? { locked: true } : {}),
    ...(d.hidden ? { hidden: true } : {}),
  };
}

/** A persisted record → a runtime Drawing (marked source:'user'). Tolerates older
 *  shapes (missing flags). */
export function fromPersisted(p: PersistedDrawing): Drawing {
  const style = {
    ...p.style,
    color: p.style?.color ?? 'var(--accent)',
    width: p.style?.width ?? 2,
  } as Drawing['style'];
  return {
    id: p.id,
    kind: p.kind as Drawing['kind'],
    points: (p.points ?? []).map((pt) => ({ time: pt.time, price: pt.price })),
    style,
    locked: p.locked,
    hidden: p.hidden,
    source: 'user',
  };
}

/** Convert a list of persisted records → runtime drawings. */
export function decodeList(recs: PersistedDrawing[] | undefined): Drawing[] {
  if (!Array.isArray(recs)) return [];
  return recs.map(fromPersisted);
}

/** Convert a list of runtime drawings → persisted records (user drawings only). */
export function encodeList(drawings: Drawing[]): PersistedDrawing[] {
  return drawings.filter(isPersistable).map(toPersisted);
}

/** A debounce helper for the save path (a drag mutates the store many times/frame). */
export type Debounced<T extends (...a: never[]) => void> = T & { flush: () => void; cancel: () => void };
export function debounce<T extends (...a: never[]) => void>(fn: T, ms: number): Debounced<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: unknown[] | null = null;
  const call = fn as unknown as (...a: unknown[]) => void;
  const run = () => { timer = null; if (lastArgs) { call(...lastArgs); lastArgs = null; } };
  const wrapped = Object.assign(
    (...args: unknown[]) => { lastArgs = args; if (timer) clearTimeout(timer); timer = setTimeout(run, ms); },
    {
      flush: () => { if (timer) { clearTimeout(timer); run(); } },
      cancel: () => { if (timer) { clearTimeout(timer); timer = null; lastArgs = null; } },
    },
  );
  return wrapped as unknown as Debounced<T>;
}
