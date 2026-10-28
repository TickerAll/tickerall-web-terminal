/**
 * IndicatorHost — mounts the active indicator instances onto a chart.
 *
 * Two render targets, by pane:
 *   - OVERLAY instances (SMA/EMA/WMA/SMMA/Bollinger/Ichimoku/VWAP) attach LINE/
 *     HISTOGRAM series IMPERATIVELY to the MAIN price pane via the chart's
 *     `getChartApi()?.addLineSeries(...)` / `addHistogramSeries(...)`. Their series
 *     handles are tracked so they're removed on instance removal / unmount — no
 *     leaks. Overlays attach only once `getChartApi()` is non-null (the main chart
 *     mounts async), and re-attach if the chart handle appears later.
 *   - OSCILLATOR instances render as REAL DOM: a vertical column of
 *     <OscillatorPane>, each its own time-synced sub-chart. The integrator places
 *     this returned element BELOW the main chart in a flex column.
 *
 * The component subscribes to the shared `indicatorManager` via
 * `useSyncExternalStore` and to the chart context (account/symbol/timeframe) it's
 * given — calling `manager.setContext(...)` so the right per-chart instance set is
 * active and persisted.
 *
 * NOTE: this renders ONLY the oscillator stack as its JSX output. The overlay
 * series live on the main chart (imperative side effect), so there's nothing for
 * them to render here.
 */

import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { ISeriesApi, UTCTimestamp, LineData, HistogramData } from 'lightweight-charts';
import type { ChartHandle } from '../../components/Chart';
import type { ChartBar } from '../../../shared/types';
import { getActiveTokens } from '../../theme/chartRegistry';
import {
  indicatorManager,
  indicatorContextKey,
  type IndicatorInstance,
  type IndicatorManager,
} from './manager';
import { getIndicator, type IndiPoint } from './registry';
import { OscillatorPane } from './OscillatorPane';
import type { IndiBar } from './math';

/** Resolve a colour token (possibly `var(--x)`) to a literal for the LWC canvas. */
function resolveColor(color: string, fallback: string): string {
  if (!color.startsWith('var(')) return color;
  const name = color.slice(4, -1).trim();
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch {
    return fallback;
  }
}

export interface IndicatorHostProps {
  /** The MAIN chart's imperative handle (null until it mounts — handled gracefully). */
  chart: ChartHandle | null;
  /** The chart's bars (oldest→newest). Overlays + oscillators recompute on change. */
  bars: ChartBar[];
  accountId: string | null;
  symbol: string | null;
  timeframe: number;
  /** Optional per-oscillator pane height (default 120). */
  oscillatorHeight?: number;
  /** Override the manager (tests / multi-instance). Defaults to the shared singleton. */
  manager?: IndicatorManager;
  /** Optional height of the whole oscillator stack — if set, the column scrolls when
   *  it would overflow. Unset = the column sizes to its panes (the integrator's flex
   *  layout decides). */
  maxStackHeight?: number;
}

/** Track for one overlay instance: its series handles by output key + the instance
 *  snapshot we last drew (to know when a param/colour changed). */
interface OverlayTrack {
  series: Map<string, ISeriesApi<'Line'> | ISeriesApi<'Histogram'>>;
  /** The params object identity we last computed for (cheap change detector). */
  lastParams: Record<string, number>;
  lastColors: Record<string, string>;
}

export function IndicatorHost({
  chart,
  bars,
  accountId,
  symbol,
  timeframe,
  oscillatorHeight = 120,
  manager = indicatorManager,
  maxStackHeight,
}: IndicatorHostProps) {
  const context = indicatorContextKey(accountId, symbol, timeframe);

  // Keep the manager's active context in sync with this host's chart context, so
  // `list(context)` returns THIS chart's instances (and persistence is per-chart).
  // Done in render-time-safe effect ordering: set BEFORE subscribing reads below by
  // running it in a layout-ish effect; the subscription re-reads on the store emit
  // that setContext fires.
  useEffect(() => {
    manager.setContext(context);
  }, [manager, context]);

  // Subscribe to the manager. The snapshot is scoped to the active context; we pass
  // `context` so a render that briefly precedes the setContext effect returns an
  // empty (stable) list rather than the previous chart's indicators.
  const instances = useSyncExternalStore(
    manager.subscribe,
    () => manager.list(context),
    () => manager.list(context),
  );

  // Overlays that should currently have series on the main pane = overlay-pane
  // instances that are visible. A toggled-off overlay simply has no series (the
  // reconcile removes it); re-enabling re-creates it.
  const overlays = useMemo(
    () => instances.filter((i) => getIndicator(i.indicatorId)?.pane === 'overlay' && i.visible),
    [instances],
  );
  const oscillators = useMemo(
    () => instances.filter((i) => getIndicator(i.indicatorId)?.pane === 'oscillator'),
    [instances],
  );

  // ── overlay series lifecycle (imperative, on the MAIN chart) ────────────────
  const tracks = useRef<Map<string, OverlayTrack>>(new Map());

  // A stable view-change subscriber + range reader for the oscillator panes that
  // delegates to the live chart handle (which may be null at first).
  const onMainViewChange = useMemo(
    () => (cb: () => void) => chart?.onViewChange(cb) ?? (() => {}),
    [chart],
  );
  const getMainVisibleLogicalRange = useMemo(
    () => () => chart?.getVisibleLogicalRange() ?? null,
    [chart],
  );

  // Reconcile overlay series whenever the instance set, the chart handle, or the
  // bars change. Adds new overlays, removes gone ones, recomputes data, and applies
  // colour/param changes — tracking handles so nothing leaks.
  useEffect(() => {
    const api = chart?.getChartApi() ?? null;
    const tokens = getActiveTokens();
    const indiBars = bars as IndiBar[]; // ChartBar ⊂ IndiBar (OHLC; volume optional)

    // Remove tracks whose instance is gone.
    const liveIds = new Set(overlays.map((o) => o.instanceId));
    for (const [id, track] of tracks.current) {
      if (!liveIds.has(id)) {
        if (api) for (const s of track.series.values()) safeRemoveSeries(api, s);
        tracks.current.delete(id);
      }
    }

    // If the chart API isn't ready yet, defer — this effect re-runs when `chart`
    // becomes non-null (it's in the dep list), attaching everything then.
    if (!api) return;

    for (const inst of overlays) {
      const def = getIndicator(inst.indicatorId);
      if (!def) continue;
      let track = tracks.current.get(inst.instanceId);

      // Create series for a new overlay instance.
      if (!track) {
        const series = new Map<string, ISeriesApi<'Line'> | ISeriesApi<'Histogram'>>();
        for (const out of def.outputs) {
          const col = resolveColor(
            inst.colors[out.key] ?? out.defaultColor,
            out.defaultColor.startsWith('var(') ? tokens.accent : out.defaultColor,
          );
          if (out.type === 'histogram') {
            series.set(out.key, api.addHistogramSeries({ color: col, priceLineVisible: false, lastValueVisible: false }));
          } else if (out.type === 'dots') {
            // Point-markers only (no connecting line) — Parabolic SAR / Fractals.
            series.set(
              out.key,
              api.addLineSeries({ color: col, lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }),
            );
          } else {
            series.set(
              out.key,
              api.addLineSeries({ color: col, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }),
            );
          }
        }
        track = { series, lastParams: {}, lastColors: {} };
        tracks.current.set(inst.instanceId, track);
      }

      // Apply colour changes (cheap: only when the colours object changed).
      if (track.lastColors !== inst.colors) {
        for (const out of def.outputs) {
          const s = track.series.get(out.key);
          if (s) {
            s.applyOptions({
              color: resolveColor(
                inst.colors[out.key] ?? out.defaultColor,
                out.defaultColor.startsWith('var(') ? tokens.accent : out.defaultColor,
              ),
            });
          }
        }
        track.lastColors = inst.colors;
      }

      // Recompute + push data. Always re-run on this effect (bars/params/handle all
      // can change); cheap relative to the chart paint.
      let outputs: Record<string, IndiPoint[]>;
      try {
        outputs = def.compute(indiBars, inst.params);
      } catch {
        for (const s of track.series.values()) s.setData([]);
        track.lastParams = inst.params;
        continue;
      }
      for (const out of def.outputs) {
        const s = track.series.get(out.key);
        if (!s) continue;
        const pts = outputs[out.key] ?? [];
        if (out.type === 'histogram') {
          (s as ISeriesApi<'Histogram'>).setData(
            pts.map((pt): HistogramData => ({ time: pt.time as UTCTimestamp, value: pt.value })),
          );
        } else {
          (s as ISeriesApi<'Line'>).setData(
            pts.map((pt): LineData => ({ time: pt.time as UTCTimestamp, value: pt.value })),
          );
        }
      }
      track.lastParams = inst.params;
    }
    // overlays identity changes on any instance mutation (manager rebuilds the array);
    // bars + chart handle are explicit deps.
  }, [overlays, bars, chart]);

  // Remove ALL overlay series on unmount (or when the chart handle goes away).
  useEffect(() => {
    return () => {
      const api = chart?.getChartApi() ?? null;
      if (api) {
        for (const track of tracks.current.values()) {
          for (const s of track.series.values()) safeRemoveSeries(api, s);
        }
      }
      tracks.current.clear();
    };
  }, [chart]);

  // ── render the oscillator stack (real DOM) ──────────────────────────────────
  const visibleOscillators = oscillators.filter((o) => o.visible);
  if (visibleOscillators.length === 0) return null;

  return (
    <div
      className="ind-osc-stack"
      style={maxStackHeight ? { maxHeight: maxStackHeight, overflowY: 'auto', flex: 'none' } : { flex: 'none' }}
    >
      {visibleOscillators.map((inst) => (
        <OscillatorPane
          key={inst.instanceId}
          instance={inst}
          bars={bars as IndiBar[]}
          onMainViewChange={onMainViewChange}
          getMainVisibleLogicalRange={getMainVisibleLogicalRange}
          onRemove={() => manager.remove(inst.instanceId)}
          height={oscillatorHeight}
        />
      ))}
    </div>
  );
}

/** Remove a series, swallowing the throw if the chart was already disposed. */
function safeRemoveSeries(
  api: { removeSeries: (s: ISeriesApi<'Line'> | ISeriesApi<'Histogram'>) => void },
  s: ISeriesApi<'Line'> | ISeriesApi<'Histogram'>,
): void {
  try {
    api.removeSeries(s);
  } catch {
    /* chart disposed / series already gone */
  }
}
