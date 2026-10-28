/**
 * Pure, framework-free transforms for the chart's selectable series types
 * (Item 5 — "changing chart type does nothing"). Chart.tsx keeps the REAL OHLC
 * `bars` as the single source of truth and renders the ACTIVE series by mapping
 * those bars through the helpers here. None of this mutates the input.
 *
 * Series families:
 *   - OHLC  (candles / hollow / bars / heikinashi) consume `{time,open,high,low,close}`.
 *   - VALUE (line / area / baseline) consume `{time, value: close}`.
 *
 * Heikin-Ashi is DISPLAY-ONLY: it is computed FROM the real bars and fed to a
 * candlestick series; the real `bars` (and therefore every price calculation,
 * the forming-bar pipeline, markers, price lines) are never altered.
 */

import type { UTCTimestamp } from 'lightweight-charts';
import type { ChartBar } from '../../shared/types';

/** The series-type strings the chart understands (the Settings `chart.defaultType`
 *  values). `heikinashi` is the canonical spelling; `heikin-ashi`/`ha` are accepted
 *  aliases so a setting written either way still resolves. */
export type SeriesTypeName =
  | 'candles' | 'hollow' | 'bars' | 'heikinashi' | 'line' | 'area' | 'baseline';

/** Which lightweight-charts series family a type renders with. `ohlc` types feed a
 *  candlestick/bar series an OHLC point; `value` types feed a line/area/baseline
 *  series a `{time,value}` point. */
export type SeriesFamily = 'candlestick' | 'bar' | 'line' | 'area' | 'baseline';

/** An OHLC point in lightweight-charts' shape (candlestick + bar series). */
export interface OhlcPoint { time: UTCTimestamp; open: number; high: number; low: number; close: number }
/** A single-value point (line / area / baseline series). */
export interface ValuePoint { time: UTCTimestamp; value: number }

/** Normalise a raw setting value to a known series type, defaulting to `candles`
 *  (the byte-identical default) for anything unrecognised/empty. Tolerant of casing,
 *  hyphenation and a couple of common aliases. */
export function normalizeSeriesType(raw: string | null | undefined): SeriesTypeName {
  const k = String(raw ?? '').toLowerCase().replace(/[\s_-]/g, '');
  switch (k) {
    case 'candles':
    case 'candle':
    case 'candlestick':
    case 'candlesticks':
      return 'candles';
    case 'hollow':
    case 'hollowcandles':
    case 'hollowcandle':
      return 'hollow';
    case 'bars':
    case 'bar':
    case 'ohlc':
      return 'bars';
    case 'heikinashi':
    case 'heikenashi':
    case 'ha':
      return 'heikinashi';
    case 'line':
      return 'line';
    case 'area':
      return 'area';
    case 'baseline':
      return 'baseline';
    default:
      return 'candles';
  }
}

/** The lightweight-charts series family used to render a given type. */
export function seriesFamily(type: SeriesTypeName): SeriesFamily {
  switch (type) {
    case 'bars':
      return 'bar';
    case 'line':
      return 'line';
    case 'area':
      return 'area';
    case 'baseline':
      return 'baseline';
    case 'candles':
    case 'hollow':
    case 'heikinashi':
    default:
      return 'candlestick';
  }
}

/** True for the value-shaped families (line/area/baseline) — they take `{time,value}`. */
export function isValueFamily(type: SeriesTypeName): boolean {
  const f = seriesFamily(type);
  return f === 'line' || f === 'area' || f === 'baseline';
}

const toOhlc = (b: ChartBar): OhlcPoint => ({
  time: b.time as UTCTimestamp, open: b.open, high: b.high, low: b.low, close: b.close,
});
const toValue = (b: ChartBar): ValuePoint => ({ time: b.time as UTCTimestamp, value: b.close });

/**
 * Heikin-Ashi transform of a bar series (pure; does not touch the input).
 *   haClose = (open + high + low + close) / 4
 *   haOpen  = (prevHaOpen + prevHaClose) / 2   (seed: (open + close) / 2 on the first bar)
 *   haHigh  = max(high, haOpen, haClose)
 *   haLow   = min(low,  haOpen, haClose)
 * Returns NEW ChartBar objects (display bars) in the same order/time as the input.
 */
export function toHeikinAshi(bars: readonly ChartBar[]): ChartBar[] {
  const out: ChartBar[] = new Array(bars.length);
  let prevOpen = 0;
  let prevClose = 0;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i]!;
    const haClose = (b.open + b.high + b.low + b.close) / 4;
    const haOpen = i === 0 ? (b.open + b.close) / 2 : (prevOpen + prevClose) / 2;
    const haHigh = Math.max(b.high, haOpen, haClose);
    const haLow = Math.min(b.low, haOpen, haClose);
    out[i] = { time: b.time, open: haOpen, high: haHigh, low: haLow, close: haClose };
    prevOpen = haOpen;
    prevClose = haClose;
  }
  return out;
}

/**
 * Heikin-Ashi value for ONE bar given the PREVIOUS Heikin-Ashi bar (or null for the
 * first bar). Used by the per-tick forming-bar path so we don't re-walk the whole
 * history on every tick — the only state HA needs is the prior HA open+close.
 */
export function heikinAshiNext(bar: ChartBar, prevHa: ChartBar | null): ChartBar {
  const haClose = (bar.open + bar.high + bar.low + bar.close) / 4;
  const haOpen = prevHa ? (prevHa.open + prevHa.close) / 2 : (bar.open + bar.close) / 2;
  const haHigh = Math.max(bar.high, haOpen, haClose);
  const haLow = Math.min(bar.low, haOpen, haClose);
  return { time: bar.time, open: haOpen, high: haHigh, low: haLow, close: haClose };
}

/**
 * Map the chart's real `bars` to the lightweight-charts data array for the ACTIVE
 * series type. OHLC types get OHLC points (candles/bars straight through; HA gets the
 * HA-transformed bars); value types get `{time, value: close}`.
 */
export function barsToSeriesData(
  bars: readonly ChartBar[], type: SeriesTypeName,
): OhlcPoint[] | ValuePoint[] {
  if (isValueFamily(type)) return bars.map(toValue);
  if (type === 'heikinashi') return toHeikinAshi(bars).map(toOhlc);
  return bars.map(toOhlc);
}
