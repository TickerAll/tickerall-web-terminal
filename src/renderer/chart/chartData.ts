/**
 * Pure chart-data helpers — the tick-buffer bucketing + the broker-history/tick merge
 * + the hole detector. Extracted verbatim from Terminal so a ChartPane (and any future
 * N-up chart) can drive its own chart without re-implementing the recently-stabilized
 * forming-bar / history pipeline. No React, no state — pure functions + constants.
 */

import type { ChartBar } from '../../shared/types';

/** Seconds per bar for the MT5 timeframe ids (forming-bar bucketing). */
export const TF_SECONDS: Record<number, number> = {
  1: 60, 5: 300, 15: 900, 30: 1800, 16385: 3600, 16388: 14400, 16408: 86400, 32769: 604800, 49153: 2592000,
};

// How much of the live tick feed to keep per symbol. The broker's CANDLE endpoint
// lags the tick stream (its forming bar freezes ~120pt behind during fast moves),
// so the chart rebuilds its recent bars from this real-time buffer on every load —
// that's what keeps M1 consistent when you switch timeframe and come back.
export const TICK_BUF_SECONDS = 3 * 3600; // ~3h covers the visible window on intraday TFs
export const TICK_BUF_MAX = 120000;       // hard cap (~3.5h at ~9.5 ticks/s) so memory is bounded

/** Bucket a rolling tick buffer into OHLC bars on the broker's grid (anchored to a
 *  known broker bar time so the buckets line up with the broker's history). A new
 *  bucket is born as a doji and grows — identical to the live formBar logic, so a
 *  rebuilt bar matches exactly what was shown live. */
export function buildBarsFromTicks(buf: { b: number; t: number }[], tfSec: number, anchor: number): ChartBar[] {
  const bars: ChartBar[] = [];
  for (const { b, t } of buf) {
    const bucket = anchor + Math.floor((t - anchor) / tfSec) * tfSec;
    const last = bars[bars.length - 1];
    if (!last || bucket > last.time) bars.push({ time: bucket, open: b, high: b, low: b, close: b });
    else if (bucket === last.time) { if (b > last.high) last.high = b; if (b < last.low) last.low = b; last.close = b; }
  }
  return bars;
}

/** Broker history with its recent (lagging) bars replaced by real-time tick-built
 *  ones. Tick bars are anchored to the broker's grid (so their times line up) and
 *  override the broker bars where they exist; broker bars supply older history and
 *  fill any gap in tick coverage. */
export function mergeTickWindow(histBarsRaw: ChartBar[], buf: { b: number; t: number }[], tfSec: number): ChartBar[] {
  // No bar can sit in the future. Drop any future-stamped bar BEFORE anchoring —
  // a future bar (from a clock-skewed source or a stray tick) as the anchor would
  // mis-bucket every tick. Hard invariant, not a heuristic.
  const nowSec = Date.now() / 1000 + 60;
  const histBars = histBarsRaw.filter((b) => b.time <= nowSec);
  const anchor = histBars[histBars.length - 1]?.time;
  if (anchor === undefined || buf.length === 0) return histBars;
  const tickBars = buildBarsFromTicks(buf, tfSec, anchor).filter((b) => b.time <= nowSec);
  if (tickBars.length === 0) return histBars;
  const byTime = new Map<number, ChartBar>();
  for (const b of histBars) byTime.set(b.time, b);
  for (const b of tickBars) {
    // The tick buffer only covers ticks SINCE the session started, so for a bar
    // that began before startup its tick-derived open/high/low are partial. Keep
    // the broker bar's period-OPEN + full extremes (the candle endpoint is now
    // broker-time-accurate); overlay only the real-time tick CLOSE on the forming
    // bar (fresher than the candle snapshot) and extend high/low. Closed broker
    // bars stay authoritative; a bucket newer than the broker's last (a period
    // that started after the fetch) is tick-only — its open IS the period open.
    const h = byTime.get(b.time);
    if (!h) byTime.set(b.time, b);
    else if (b.time === anchor) byTime.set(b.time, { time: b.time, open: h.open, high: Math.max(h.high, b.high), low: Math.min(h.low, b.low), close: b.close });
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

/** True if the VISIBLE window (the most recent ~chart-width bars) has a real
 *  HOLE — consecutive bars more than 3 periods apart. The fast/live candle store
 *  misses minutes for any window the broker connection wasn't streaming (e.g. it
 *  was down before the terminal opened); a hole this size is that, not a single
 *  silent bar. Scoped to the visible window so a genuinely-empty broker hole far
 *  back in history (unfillable, off-screen) doesn't keep triggering a refetch.
 *  When found, the loader backfills from deep history (the op=0x66 walk HAS the
 *  bars a down-window is missing). */
export function hasHole(bars: ChartBar[], tfSec: number): boolean {
  const recent = bars.slice(-90);
  for (let i = 1; i < recent.length; i++) {
    if (recent[i]!.time - recent[i - 1]!.time > 3 * tfSec) return true;
  }
  return false;
}
