/**
 * The single live-tick fan-out. ONE `api.onTick` subscription dispatches every tick
 * to (a) `onAny` listeners — Market-Watch quotes + live P&L, which use the bid even
 * for a clock-skewed future tick — and (b) per-`(account,symbol)` listeners — each
 * ChartPane's forming-bar. It also owns the rolling per-symbol tick buffer the chart
 * rebuilds its recent bars from. Built so N charts share one broker subscription
 * (no per-pane re-subscribe) — the multi-chart seam.
 *
 * The future-tick guard + buffer trimming are verbatim from the old Terminal onTick.
 */

import { api } from '../api';
import type { Quote } from '../../shared/types';
import { TICK_BUF_SECONDS, TICK_BUF_MAX } from './chartData';

type Tick = { b: number; t: number };

const anyListeners = new Set<(q: Quote) => void>();
const keyListeners = new Map<string, Set<(q: Quote) => void>>();
const buffers = new Map<string, Tick[]>(); // `${accountId}:${symbol}` → rolling live ticks
let started = false;

function dispatch(q: Quote): void {
  // Price-only consumers (quotes, P&L) get EVERY tick — they use the bid regardless.
  for (const l of anyListeners) l(q);

  // A tick/candle can NEVER be in the future. A broker/feed clock-skew tick (e.g. a
  // stray broker-time stamp during a session warm-up) must not enter the chart
  // pipeline: one future-stamped tick poisons the forming bar (a bodyless doji 1-2h
  // ahead, then every real earlier tick is dropped). Hard invariant: reject t > now.
  const tickOk = Number.isFinite(q.bid) && Number.isFinite(q.time) && q.time <= Date.now() / 1000 + 60;
  if (!tickOk) return;

  // Record into the rolling per-symbol buffer (the real-time feed the chart rebuilds
  // its recent bars from). Kept for every watched symbol, not just the charted one.
  const bk = `${q.accountId}:${q.symbol}`;
  const buf = buffers.get(bk) ?? [];
  buf.push({ b: q.bid, t: q.time });
  const cutoff = q.time - TICK_BUF_SECONDS;
  if (buf[0] && buf[0].t < cutoff) { let i = 0; while (i < buf.length && buf[i]!.t < cutoff) i++; buf.splice(0, i); }
  if (buf.length > TICK_BUF_MAX) buf.splice(0, buf.length - TICK_BUF_MAX);
  buffers.set(bk, buf);

  // Per-chart listeners (each ChartPane forms its bar for its own symbol).
  const set = keyListeners.get(bk);
  if (set) for (const l of set) l(q);
}

export const tickBus = {
  /** Subscribe to the broker tick stream once. Idempotent. */
  start(): void { if (started) return; started = true; api.onTick(dispatch); },
  /** Every tick (quotes + P&L). Returns an unsubscribe. */
  onAny(cb: (q: Quote) => void): () => void { anyListeners.add(cb); return () => { anyListeners.delete(cb); }; },
  /** Non-future ticks for one `(account,symbol)` (a chart's forming bar). Returns an unsubscribe. */
  on(accountId: string, symbol: string, cb: (q: Quote) => void): () => void {
    const bk = `${accountId}:${symbol}`;
    let set = keyListeners.get(bk);
    if (!set) { set = new Set(); keyListeners.set(bk, set); }
    set.add(cb);
    return () => { set!.delete(cb); if (set!.size === 0) keyListeners.delete(bk); };
  },
  /** The rolling tick buffer for one `(account,symbol)` — read by the chart loader. */
  buffer(accountId: string, symbol: string): Tick[] { return buffers.get(`${accountId}:${symbol}`) ?? []; },
};
