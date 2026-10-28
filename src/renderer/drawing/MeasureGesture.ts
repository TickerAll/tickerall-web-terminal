/**
 * MeasureGesture — the data + math for TradingView's shift+drag ruler. It is NOT a
 * persisted drawing; the CanvasOverlay drives it as a transient gesture (capture on
 * shift+pointerdown over empty chart space, follow the pointer, clear on release).
 * This module holds:
 *   - `MeasureState`: the gesture's pixel + data endpoints and the derived readout;
 *   - `computeMeasure(...)`: the pure function that turns two data points (+ the bars
 *     and an optional trade context) into the {Δprice, %, bars, lots} readout. Pure
 *     so it's unit-testable with no chart.
 *
 * Kept separate from CanvasOverlay so the arithmetic (% change, bar count, lots) is
 * verifiable in isolation.
 */

import type { ChartBar } from '../../shared/types';
import type { DataPoint, PixelPoint } from './CoordinateProjector';
import type { TradeContext } from './tools/registry';

/** The numeric readout a measure box displays. */
export interface MeasureReadout {
  /** Signed price delta (to − from). */
  dPrice: number;
  /** Signed percent change relative to the `from` price (0 when from is ~0). */
  dPercent: number;
  /** Number of bars spanned (|index(to) − index(from)|, rounded). */
  bars: number;
  /** Direction by price: up / down / flat. */
  direction: 'up' | 'down' | 'flat';
  /** Position size in lots a 1%-risk trade over this leg would take, or null when the
   *  trade context can't size it. */
  lots: number | null;
}

/** The full transient gesture state (pixels + data + readout) the overlay renders. */
export interface MeasureState {
  /** Pixel anchor where the drag began. */
  startPx: PixelPoint;
  /** Pixel position of the pointer now. */
  curPx: PixelPoint;
  /** Data anchor at the start (time, price). */
  startData: DataPoint;
  /** Data anchor now. */
  curData: DataPoint;
  /** The derived numbers. */
  readout: MeasureReadout;
}

/** Count bars between two times using the bars array (logical-index distance). Falls
 *  back to a timeframe estimate when a time is outside the loaded range. */
export function barsBetween(fromTime: number, toTime: number, bars: ChartBar[]): number {
  const n = bars.length;
  if (n < 2) return 0;
  const idxAt = (t: number): number => {
    if (t <= bars[0]!.time) {
      const tf = (bars[1]!.time - bars[0]!.time) || 1;
      return (t - bars[0]!.time) / tf;
    }
    const last = n - 1;
    if (t >= bars[last]!.time) {
      const tf = (bars[last]!.time - bars[last - 1]!.time) || 1;
      return last + (t - bars[last]!.time) / tf;
    }
    // binary search the bracketing bars, interpolate by time.
    let lo = 0;
    let hi = last;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (bars[mid]!.time <= t) lo = mid; else hi = mid;
    }
    const span = bars[hi]!.time - bars[lo]!.time;
    return lo + (span > 0 ? (t - bars[lo]!.time) / span : 0);
  };
  return Math.round(Math.abs(idxAt(toTime) - idxAt(fromTime)));
}

/** Pure: turn two data points (+ bars + optional trade ctx) into the measure readout. */
export function computeMeasure(
  from: DataPoint, to: DataPoint, bars: ChartBar[], trade?: TradeContext,
): MeasureReadout {
  const dPrice = to.price - from.price;
  const dPercent = Math.abs(from.price) > 1e-12 ? (dPrice / from.price) * 100 : 0;
  const bars2 = barsBetween(from.time, to.time, bars);
  const direction: MeasureReadout['direction'] = dPrice > 0 ? 'up' : dPrice < 0 ? 'down' : 'flat';
  let lots: number | null = null;
  if (trade && trade.tickValue && trade.point && trade.balance) {
    const points = Math.abs(dPrice) / trade.point;
    const perLot = points * trade.tickValue;
    if (perLot > 0) lots = (trade.balance * 0.01) / perLot;
  }
  return { dPrice, dPercent, bars: bars2, direction, lots };
}

/** Colours for the measure box by direction (green up, red down, grey flat). */
export function measureColors(dir: MeasureReadout['direction']): { fill: string; line: string } {
  if (dir === 'up') return { fill: 'rgba(48,164,108,0.16)', line: 'rgba(48,164,108,0.95)' };
  if (dir === 'down') return { fill: 'rgba(229,72,77,0.16)', line: 'rgba(229,72,77,0.95)' };
  return { fill: 'rgba(140,140,150,0.16)', line: 'rgba(140,140,150,0.95)' };
}
