/**
 * CoordinateProjector — data-space (time, price) ↔ pixel-space (x, y) for the
 * drawing overlay. This is the single most correctness-critical piece of the
 * drawing engine (TERMINAL-ROADMAP Part 6 risk #3): a drawing's anchors live in
 * data space (a (time, price) pair per endpoint) and must re-project to the exact
 * same pixels the candle they sit on occupies, through pan / zoom / live-append.
 *
 * THE OFF-SCREEN PROBLEM. lightweight-charts' `timeToCoordinate` /
 * `priceToCoordinate` return `null` when the point is outside the visible plot —
 * a time scrolled off either edge, or a price outside the current auto-scale band.
 * An extended/ray/horizontal line, or a trendline with one endpoint just past the
 * edge, MUST still project (so we can clip it to the plot border). So when LWC
 * hands back null we EXTRAPOLATE a linear data→pixel mapping calibrated from the
 * points LWC *does* answer:
 *
 *   - Time axis: LWC's time scale is linear in *logical index* (bar number), not
 *     in wall-clock time (bars are evenly spaced regardless of gaps/weekends). So
 *     we map time→logical-index using the bars array (binary-search + linear
 *     interpolation between neighbours; constant `tfSec` extrapolation beyond the
 *     ends), then logical-index→x with a `barSpacing` (px per index) and an anchor
 *     index↔x pair both read live from the chart. This is exactly how LWC itself
 *     places bars, so on-screen it agrees with `timeToCoordinate` to the pixel and
 *     off-screen it continues the same straight line.
 *
 *   - Price axis: the price scale is linear in price within a scale mode (normal).
 *     We calibrate slope+intercept from two probe prices that DO map, then apply it
 *     everywhere (including outside the auto-scale band).
 *
 * The adapter boundary (`ProjectorAdapter`) is a thin shape over the ChartHandle
 * accessors, so the projection math is a PURE function of (adapter, bars) and is
 * unit-tested against a synthetic adapter with no chart at all.
 */

import type { ChartBar } from '../../shared/types';

/** A single data-space anchor: a bar's open-time (seconds) + a price. */
export interface DataPoint {
  /** Bar open-time in seconds (a UTCTimestamp). */
  time: number;
  price: number;
}

/** A pixel-space point in the chart's local (plot) coordinate system. */
export interface PixelPoint {
  x: number;
  y: number;
}

/**
 * The minimal surface the projector needs from a chart. ChartHandle satisfies a
 * superset of this; the projector takes only these so it can be driven by a plain
 * object in tests. All coordinates are the chart's local pixel space (origin at the
 * plot's top-left, the same space `timeToCoordinate`/`priceToCoordinate` return).
 */
export interface ProjectorAdapter {
  /** LWC `timeToCoordinate` — x for a bar time, or null when off-screen. */
  timeToCoordinate(time: number): number | null;
  /** LWC `coordinateToTime` — bar time at an x, or null. */
  coordinateToTime(x: number): number | null;
  /** LWC `priceToCoordinate` — y for a price, or null when outside the auto-scale. */
  priceToCoordinate(price: number): number | null;
  /** LWC `coordinateToPrice` — price at a y, or null. */
  coordinateToPrice(y: number): number | null;
  /** The visible logical (bar-index) range, e.g. { from: 1180.5, to: 1260.5 }. */
  getVisibleLogicalRange(): { from: number; to: number } | null;
  /** The plot's pixel size — used to clip extended lines / fall back when probes fail. */
  getPlotSize(): { width: number; height: number };
}

/** Result of projecting a data point, plus whether it needed extrapolation. */
export interface Projection extends PixelPoint {
  /** True when this point is inside the plot rect (LWC answered directly). */
  onScreen: boolean;
}

const EPS = 1e-9;

export class CoordinateProjector {
  private adapter: ProjectorAdapter;
  /** A reference to the live bars (sorted ascending by time). NOT copied — the
   *  overlay passes the chart's snapshot and refreshes it on data changes. The
   *  projector only reads it. */
  private bars: ChartBar[];

  constructor(adapter: ProjectorAdapter, bars: ChartBar[]) {
    this.adapter = adapter;
    this.bars = bars;
  }

  /** Swap the bars reference (on a chart (re)load / live-append). */
  setBars(bars: ChartBar[]): void {
    this.bars = bars;
  }

  // ── time ↔ logical index ───────────────────────────────────────────────────
  // LWC numbers bars 0..N-1 by array position; the logical index is fractional
  // between bars. We mirror that exactly so our extrapolation continues LWC's own
  // line. The bar timeframe (`tfSec`) is the median bar-to-bar gap, robust to the
  // odd weekend/holiday gap (so a single large gap doesn't skew extrapolation).

  /** Median seconds-per-bar across the loaded bars (the timeframe). 0 if <2 bars. */
  private tfSec(): number {
    const b = this.bars;
    const n = b.length;
    if (n < 2) return 0;
    // Median of consecutive deltas — resilient to session gaps. Cap the sample so
    // this stays cheap on a deep history buffer.
    const step = Math.max(1, Math.floor(n / 512));
    const deltas: number[] = [];
    for (let i = 1; i < n; i += step) {
      const d = b[i]!.time - b[i - 1]!.time;
      if (d > 0) deltas.push(d);
    }
    if (deltas.length === 0) return 0;
    deltas.sort((x, y) => x - y);
    return deltas[deltas.length >> 1]!;
  }

  /**
   * Map a bar time → fractional logical index, the way LWC indexes bars:
   *  - an exact bar time → its array position;
   *  - between two loaded bars → linearly interpolated by time;
   *  - before the first / after the last loaded bar → extrapolated at `tfSec`
   *    (constant bar spacing in time), which is what LWC does for whitespace.
   */
  timeToLogical(time: number): number | null {
    const b = this.bars;
    const n = b.length;
    if (n === 0) return null;
    if (n === 1) {
      const tf = this.tfSec() || 1;
      return (time - b[0]!.time) / tf; // single bar at index 0
    }
    if (time <= b[0]!.time) {
      const tf = (b[1]!.time - b[0]!.time) || this.tfSec() || 1;
      return (time - b[0]!.time) / tf;            // ≤ 0, extrapolate left
    }
    const last = n - 1;
    if (time >= b[last]!.time) {
      const tf = (b[last]!.time - b[last - 1]!.time) || this.tfSec() || 1;
      return last + (time - b[last]!.time) / tf;  // ≥ N-1, extrapolate right
    }
    // Binary-search the bracketing bars, then interpolate by time.
    let lo = 0;
    let hi = last;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (b[mid]!.time <= time) lo = mid;
      else hi = mid;
    }
    const span = b[hi]!.time - b[lo]!.time;
    const frac = span > EPS ? (time - b[lo]!.time) / span : 0;
    return lo + frac;
  }

  /** Inverse: fractional logical index → bar time (for hit-testing / unproject). */
  logicalToTime(logical: number): number | null {
    const b = this.bars;
    const n = b.length;
    if (n === 0) return null;
    if (n === 1) {
      const tf = this.tfSec() || 1;
      return b[0]!.time + logical * tf;
    }
    if (logical <= 0) {
      const tf = (b[1]!.time - b[0]!.time) || this.tfSec() || 1;
      return b[0]!.time + logical * tf;
    }
    const last = n - 1;
    if (logical >= last) {
      const tf = (b[last]!.time - b[last - 1]!.time) || this.tfSec() || 1;
      return b[last]!.time + (logical - last) * tf;
    }
    const lo = Math.floor(logical);
    const frac = logical - lo;
    return b[lo]!.time + frac * (b[lo + 1]!.time - b[lo]!.time);
  }

  // ── x ↔ logical index (the live mapping read from the chart) ────────────────
  // We need an (index → x) line: slope = bar spacing in px, plus an anchor. We
  // calibrate it PRIMARILY by probing two real on-screen bars with the chart's own
  // `timeToCoordinate` — that captures LWC's EXACT bar spacing (incl. its internal
  // right-offset), so our off-screen extrapolation continues LWC's real line to the
  // pixel. The visible-logical-range/plot-width formula is only an APPROXIMATION
  // (LWC folds a right-offset into the range that `width/span` doesn't model — it can
  // drift several % over a long extrapolation), so we use it only as a fallback when
  // probing is impossible (fewer than two bars, or every bar off-screen).

  /** Returns { spacing, anchorIndex, anchorX } describing x = anchorX + (i-anchorIndex)*spacing, or null. */
  private xMapping(): { spacing: number; anchorIndex: number; anchorX: number } | null {
    // Primary: two real on-screen bars → LWC's exact spacing.
    const probe = this.probeXFromBars();
    if (probe) return probe;
    // Fallback: the visible logical range across the plot width (approximate).
    const range = this.adapter.getVisibleLogicalRange();
    const { width } = this.adapter.getPlotSize();
    if (range && width > 0) {
      const span = range.to - range.from;
      if (Math.abs(span) > EPS) return { spacing: width / span, anchorIndex: range.from, anchorX: 0 };
    }
    return null;
  }

  /** Calibrate index→x from two bars whose `timeToCoordinate` is non-null. */
  private probeXFromBars(): { spacing: number; anchorIndex: number; anchorX: number } | null {
    const b = this.bars;
    const n = b.length;
    if (n < 2) return null;
    // Pick two indices spread across the array; walk inward until both map.
    let i0 = 0;
    let i1 = n - 1;
    let x0: number | null = null;
    let x1: number | null = null;
    for (let i = i0; i < n && x0 === null; i++) { const x = this.adapter.timeToCoordinate(b[i]!.time); if (x !== null) { x0 = x; i0 = i; } }
    for (let i = i1; i >= 0 && x1 === null; i--) { const x = this.adapter.timeToCoordinate(b[i]!.time); if (x !== null) { x1 = x; i1 = i; } }
    if (x0 === null || x1 === null || i0 === i1) return null;
    const spacing = (x1 - x0) / (i1 - i0);
    return { spacing, anchorIndex: i0, anchorX: x0 };
  }

  // ── price ↔ y (calibrated linear mapping) ───────────────────────────────────

  /** Returns { scale, anchorPrice, anchorY } for y = anchorY + (price-anchorPrice)*scale, or null. */
  private yMapping(): { scale: number; anchorPrice: number; anchorY: number } | null {
    const { height } = this.adapter.getPlotSize();
    if (height <= 0) return null;
    // Probe a spread of y's across the plot to find two that yield a price (the
    // auto-scale band is always somewhere in the middle of the plot, so sampling
    // the plot height guarantees hits). Use the extreme valid pair for accuracy.
    const N = 9;
    let topY: number | null = null;
    let topP = 0;
    let botY: number | null = null;
    let botP = 0;
    for (let k = 0; k <= N; k++) {
      const y = (height * k) / N;
      const p = this.adapter.coordinateToPrice(y);
      if (p === null) continue;
      if (topY === null) { topY = y; topP = p; }
      botY = y; botP = p;
    }
    if (topY === null || botY === null || Math.abs(botY - topY) < EPS || Math.abs(botP - topP) < EPS) {
      return null;
    }
    // price increases as y decreases → scale is negative.
    const scale = (botY - topY) / (botP - topP);
    return { scale, anchorPrice: topP, anchorY: topY };
  }

  // ── public projection ───────────────────────────────────────────────────────

  /** Project (time, price) → pixel, extrapolating when LWC returns null. */
  project(pt: DataPoint): Projection | null {
    // X: try LWC directly (pixel-exact on-screen), else index→x extrapolation.
    let x = this.adapter.timeToCoordinate(pt.time);
    let xOn = x !== null;
    if (x === null) {
      const logical = this.timeToLogical(pt.time);
      const map = this.xMapping();
      if (logical === null || !map) return null;
      x = map.anchorX + (logical - map.anchorIndex) * map.spacing;
    }
    // Y: try LWC directly, else calibrated price→y extrapolation.
    let y = this.adapter.priceToCoordinate(pt.price);
    let yOn = y !== null;
    if (y === null) {
      const map = this.yMapping();
      if (!map) return null;
      y = map.anchorY + (pt.price - map.anchorPrice) * map.scale;
    }
    return { x, y, onScreen: xOn && yOn };
  }

  /** Inverse: pixel → (time, price). Used when placing/dragging from the mouse.
   *  Falls back to the same calibrated mappings when LWC returns null off the
   *  plot edges, so a drag that leaves the plot still yields a data anchor. */
  unproject(px: PixelPoint): DataPoint | null {
    // time
    let time = this.adapter.coordinateToTime(px.x);
    if (time === null) {
      const map = this.xMapping();
      if (!map || Math.abs(map.spacing) < EPS) return null;
      const logical = map.anchorIndex + (px.x - map.anchorX) / map.spacing;
      time = this.logicalToTime(logical);
      if (time === null) return null;
    }
    // price
    let price = this.adapter.coordinateToPrice(px.y);
    if (price === null) {
      const map = this.yMapping();
      if (!map || Math.abs(map.scale) < EPS) return null;
      price = map.anchorPrice + (px.y - map.anchorY) / map.scale;
    }
    return { time, price };
  }

  /** The plot rect (for clipping extended lines to the visible area). */
  plotRect(): { width: number; height: number } {
    return this.adapter.getPlotSize();
  }
}

/**
 * Liang–Barsky segment clip to the plot rect [0,width]×[0,height]. Returns the
 * clipped endpoints, or null when the segment misses the plot entirely. Used so an
 * extended/ray line that projects far off-screen is drawn only across the plot (a
 * canvas will happily draw a 50,000-px line, but clipping keeps stroke/anti-alias
 * cost bounded and dashes phase-correct). For a plain trendline both endpoints are
 * usually on-screen and this is a near no-op.
 */
export function clipSegmentToRect(
  a: PixelPoint, b: PixelPoint, width: number, height: number,
): [PixelPoint, PixelPoint] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const p = [-dx, dx, -dy, dy];
  const q = [a.x - 0, width - a.x, a.y - 0, height - a.y];
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]!) < EPS) {
      if (q[i]! < 0) return null; // parallel and outside this boundary
    } else {
      const r = q[i]! / p[i]!;
      if (p[i]! < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
      else { if (r < t0) return null; if (r < t1) t1 = r; }
    }
  }
  return [
    { x: a.x + t0 * dx, y: a.y + t0 * dy },
    { x: a.x + t1 * dx, y: a.y + t1 * dy },
  ];
}
