/**
 * CandleCountdown — the "time to close of the forming bar" badge, rendered INSIDE the
 * chart and anchored on the RIGHT price axis just below the last-price label
 * (TradingView/MT5 style). It is purely presentational: an absolutely-positioned,
 * `pointer-events:none` child of `.chart-pane` that never blocks chart interaction and
 * never touches the data pipeline.
 *
 * Anchoring:
 *   y = chart.priceToCoordinate(lastBar.close)   (the forming bar's price → pixels)
 * The badge sits a few px BELOW that y, hugging the right edge (over the price scale's
 * left margin). It re-anchors on every pan/zoom (`chart.onViewChange`) and once per
 * second (the countdown re-renders + the price scale may have auto-scaled on a tick).
 *
 * The countdown maths is shared with the footer clock via `../chart/countdown`
 * (`computeBarPhase` + `fmtCountdown`) — no duplication. The broker offset is learned
 * from the freshest tick's timestamp and HELD (ticks are bursty), exactly like the
 * footer, so the badge keeps counting down through tick silence.
 *
 * Gated by the `chart.showCountdown` setting (default on) — the parent only mounts this
 * when the setting is true.
 */

import { useEffect, useRef, useState } from 'react';
import { TF_LABEL } from '../../shared/types';
import { computeBarPhase, fmtCountdown } from '../chart/countdown';

/** The minimal chart surface the badge reads — a subset of ChartHandle the parent
 *  wires from its internal chartRef (additive; no pipeline change). */
export interface CountdownChart {
  /** The series' current last bar (the forming bar) — for the anchor price. */
  lastBar(): { close: number } | null;
  /** Project a price to a pixel y (or null when off-scale / no chart). */
  priceToCoordinate(price: number): number | null;
  /** Fire `cb` on every pan/zoom so the badge re-anchors. Returns unsubscribe. */
  onViewChange(cb: () => void): () => void;
}

interface Props {
  /** Live chart accessors (a subset of ChartHandle) — null until the chart mounts. */
  chart: CountdownChart | null;
  /** The active timeframe (MT5 ENUM_TIMEFRAMES id) — drives the bucket + the label. */
  timeframe: number;
  /** The freshest tick's broker timestamp (epoch s), or null/undefined until one lands.
   *  Used to learn+hold the broker clock offset (same as the footer). */
  quoteTime?: number | null;
  /** Hidden when no symbol is charted. */
  visible: boolean;
}

export function CandleCountdown({ chart, timeframe, quoteTime, visible }: Props) {
  // 1 Hz re-render — drives the countdown tick AND a re-anchor (a tick can auto-scale
  // the price axis between view-change events). Cleared on unmount.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Re-anchor on every pan/zoom. Re-subscribe when the chart instance arrives.
  useEffect(() => {
    if (!chart) return;
    const off = chart.onViewChange(() => setTick((t) => t + 1));
    return off;
  }, [chart]);

  // Learn the broker clock offset (broker − local) ONCE per tick, frozen at arrival,
  // then HELD — so the countdown keeps advancing with the 1 Hz clock during tick
  // silence (ticks are bursty). Identical to the footer's offset handling.
  const offsetRef = useRef(0);
  const lastTickRef = useRef<number | null>(null);
  const tickTime = quoteTime != null && Number.isFinite(quoteTime) ? quoteTime : null;
  if (tickTime !== null && tickTime !== lastTickRef.current) {
    lastTickRef.current = tickTime;
    offsetRef.current = tickTime - Date.now() / 1000;
  }

  if (!visible || !chart) return null;

  const lb = chart.lastBar();
  // Anchor below the last-price label: project the forming bar's close to a pixel y.
  const y = lb ? chart.priceToCoordinate(lb.close) : null;
  if (lb === null || y === null) return null;

  const { remain } = computeBarPhase(Date.now() / 1000, offsetRef.current, timeframe);
  const tf = TF_LABEL[timeframe] ?? '';

  // Sit a few px below the price label, hugging the right edge (over the price scale).
  const top = Math.round(y) + 9;

  return (
    <div
      className="chart-countdown"
      style={{ top: `${top}px` }}
      title={`Time to the next ${tf} bar`}
    >
      {fmtCountdown(remain)}
    </div>
  );
}
