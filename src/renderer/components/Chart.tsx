import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import {
  createChart, type IChartApi, type ISeriesApi, type SeriesType, type UTCTimestamp,
  type Coordinate, type Time, type MouseEventParams,
  type CreatePriceLineOptions, type IPriceLine, type ISeriesPrimitive,
  type CandlestickSeriesPartialOptions, type BarSeriesPartialOptions,
  type LineSeriesPartialOptions, type AreaSeriesPartialOptions, type BaselineSeriesPartialOptions,
} from 'lightweight-charts';
import type { ChartBar, OverlayPoint, TradeMarker } from '../../shared/types';
import type { ThemeTokens } from '../theme/tokens';
import { chartTheme, type ChartThemeOptions } from '../theme/chartTheme';
import { getActiveTokens, registerChart } from '../theme/chartRegistry';
import {
  normalizeSeriesType, seriesFamily, isValueFamily, toHeikinAshi, heikinAshiNext,
  type SeriesTypeName,
} from '../chart/seriesTypes';

/** The imperative handle the shell uses to drive the chart without re-rendering
 *  it on every tick (lightweight-charts is canvas, not React state). */
export interface ChartHandle {
  /** Replace all bars. `resetView` (default true) snaps to the latest candle — pass
   *  `false` on a refresh/reload of the SAME chart so a user parked on history keeps
   *  their place instead of being yanked to the right edge. */
  setData(bars: ChartBar[], resetView?: boolean): void;
  /** Apply one tick-built bar: grow the forming candle in place, or append a new
   *  one (auto-following the right edge). Never touches older bars or the scroll. */
  update(bar: ChartBar): void;
  /** Merge bars (older OR newer) into the series, preserving the visible view —
   *  used by the progressive background history fill + scroll-back. */
  merge(bars: ChartBar[]): void;
  /** The series' actual last bar — the single source of truth for the live
   *  forming-bar logic (so it never desyncs from a background merge). */
  lastBar(): ChartBar | null;
  /** Suppress proactive scroll-loading while a background fill is running. */
  setBusy(busy: boolean): void;
  setOverlay(points: OverlayPoint[]): void;
  setMarkers(markers: TradeMarker[]): void;
  /** Re-theme the chart: pass-through to `chart.applyOptions` + the candle/overlay
   *  series `applyOptions`. Additive (Foundation 2) — never touches the data
   *  pipeline. Driven by the ThemeProvider on mount + theme change. */
  applyTheme(opts: ChartThemeOptions): void;
  /** Switch the active price-series RENDER type (Item 5). The real OHLC `bars` stay
   *  the single source of truth — only the on-screen series shape changes. Supported:
   *  `candles` | `hollow` | `bars` | `heikinashi` | `line` | `area` | `baseline`
   *  (anything else falls back to `candles`). Removes the old series, creates the new
   *  one, re-feeds the current bars (HA-transformed for `heikinashi`), re-applies
   *  theming + markers, and keeps every Foundation-3 pass-through pointed at the new
   *  series. The default on mount is `candles` (byte-identical to before). */
  setSeriesType(type: string): void;

  // ── Foundation 3 — the additive seam the feature clusters code against. ──────
  // ALL pass-throughs to chart.current / candles.current; NONE touch the data
  // pipeline (setData/merge/ensureHistory/formBar). Drawing, trade-from-chart,
  // indicators, alerts and multi-chart sync build on these.
  /** Data-space ↔ pixel-space conversion (drawing overlay, on-chart trading). */
  priceToCoordinate(price: number): number | null;
  coordinateToPrice(y: number): number | null;
  timeToCoordinate(time: number): number | null;
  coordinateToTime(x: number): number | null;
  getVisibleLogicalRange(): { from: number; to: number } | null;
  getVisibleTimeRange(): { from: number; to: number } | null;
  /** Fire `cb` on every pan/zoom so an overlay can repaint in lockstep. Returns unsubscribe. */
  onViewChange(cb: () => void): () => void;
  /** Raw lightweight-charts handles for advanced consumers. */
  getChartApi(): IChartApi | null;
  getCandleSeries(): ISeriesApi<'Candlestick'> | null;
  /** A shallow COPY of the current bars — READ-ONLY (never mutate; it shadows the live buffer). */
  getBarsSnapshot(): ChartBar[];
  /** Crosshair (multi-chart sync): subscribe to / set / clear the crosshair. */
  subscribeCrosshair(cb: (p: { time: number | null; price: number | null }) => void): () => void;
  setCrosshair(time: number, price: number): void;
  clearCrosshair(): void;
  /** Price lines (on-chart SL/TP/entry). */
  createPriceLine(opts: CreatePriceLineOptions): IPriceLine | null;
  removePriceLine(line: IPriceLine): void;
  /** Series primitives (the drawing engine attaches here). */
  attachPrimitive(p: ISeriesPrimitive<Time>): void;
  detachPrimitive(p: ISeriesPrimitive<Time>): void;
  /** Price-scale mode (normal/log/percent/indexed — a lightweight-charts PriceScaleMode). */
  setPriceScaleMode(mode: number): void;
  takeScreenshot(): HTMLCanvasElement | null;
  /** Background symbol/timeframe watermark — additive (chart.applyOptions only). */
  setWatermark(opts: { visible: boolean; text?: string; fontSize?: number }): void;

  clear(): void;
}

const VISIBLE = 80; // candles shown at the initial zoom (normal width — never fit-to-7)
const BUFFER_BARS = 6000; // history kept loaded behind the view so the end is never reachable

/** `onNeedOlder(oldestTime, count)` is called proactively (within ~2 windows of the
 *  left edge) so older bars are already loaded before the user reaches them. `count`
 *  scales with the visible width, so a zoomed-out view fills in one fetch.
 *
 *  `onLoading({ older })` reports the OLDER/deep history signal — true while a
 *  scroll-back fetch (`onNeedOlder`) is in flight OR the background fill is running.
 *  It fires on the SAME transitions as before (only the shape changed: a boolean →
 *  `{ older }`), so the caller can render a deep-history indicator distinct from the
 *  initial/recent load (which the caller owns, around its own `loadChart`). */
type ChartProps = {
  onNeedOlder?: (oldestTime: number, count: number) => Promise<ChartBar[]>;
  onLoading?: (state: { older: boolean }) => void;
};
export const Chart = forwardRef<ChartHandle, ChartProps>(
  function Chart({ onNeedOlder, onLoading }, ref) {
    const el = useRef<HTMLDivElement>(null);
    const chart = useRef<IChartApi | null>(null);
    // The ACTIVE price series (whatever render type is selected). All the generic
    // pass-throughs (markers, coords, price-lines, primitives) route through this so
    // they follow a type switch. `candles` mirrors it ONLY while the active type is a
    // candlestick family (candles/hollow/heikinashi) — null otherwise — so
    // `getCandleSeries()` callers stay safe and the candle-specific theming stays typed.
    const price = useRef<ISeriesApi<SeriesType> | null>(null);
    const candles = useRef<ISeriesApi<'Candlestick'> | null>(null);
    const seriesType = useRef<SeriesTypeName>('candles');
    // Cached Heikin-Ashi display bars (the HA transform of `bars`), kept in lockstep so
    // the per-tick `update` path can derive the next HA bar from the prior one without
    // re-walking history. Display-only — never the real price source.
    const haBars = useRef<ChartBar[]>([]);
    // The last markers pushed via setMarkers — re-applied after a series-type switch
    // (markers live on the LWC series object, which is recreated on switch).
    const lastMarkers = useRef<TradeMarker[]>([]);
    const overlay = useRef<ISeriesApi<'Line'> | null>(null);
    const bars = useRef<ChartBar[]>([]);
    const loading = useRef(false);
    const exhausted = useRef(false);
    const busy = useRef(false);
    const following = useRef(true);      // true = pinned to the right edge (follow live)
    const applyingRange = useRef(false); // ignore visible-range changes WE make ourselves
    const onNeedOlderRef = useRef(onNeedOlder);
    onNeedOlderRef.current = onNeedOlder;
    const onLoadingRef = useRef(onLoading);
    onLoadingRef.current = onLoading;
    const loadingReported = useRef(false);
    // Surface the OLDER/deep-history signal (a scroll-back fetch in flight OR the
    // background fill running) to the UI, deduped so it only fires on an actual
    // transition. The shape is `{ older }` so the caller can distinguish it from the
    // initial/recent load it owns itself.
    const syncLoading = () => {
      const v = loading.current || busy.current;
      if (loadingReported.current === v) return;
      loadingReported.current = v;
      onLoadingRef.current?.({ older: v });
    };

    // Merge bars in (dedup by open-time, newer wins) and keep the SAME candles on
    // screen — a background fill or scroll-load fills the left without ever jumping
    // the user's view to the latest candle.
    const mergeBars = (incoming: ChartBar[]) => {
      if (incoming.length === 0) return;
      const byTime = new Map<number, ChartBar>();
      for (const b of bars.current) byTime.set(b.time, b);
      let added = false;
      for (const b of incoming) { if (!byTime.has(b.time)) added = true; byTime.set(b.time, b); }
      if (!added) return;
      const merged = [...byTime.values()].sort((a, b) => a.time - b.time);
      const ts = chart.current?.timeScale();
      // Anchor to the RIGHT-EDGE-relative scroll position (bars from the last bar).
      // A prepend never moves the last bar, so this value is invariant across the
      // setData below — restoring it keeps the user exactly where they were, whether
      // they're parked on history or following live. This survives setData's internal
      // scroll-reset far more reliably than a logical-index range (which shifts with
      // the prepend and can be overridden by a deferred scroll-to-realtime).
      const pos = ts?.scrollPosition();
      applyingRange.current = true;
      bars.current = merged;
      // Feed the ACTIVE series in its shape (OHLC / HA / {time,value}); for the default
      // candles type this is the same dataset as before. `bars` (the price source) is set.
      setActiveData();
      if (ts) {
        const restore = () => {
          try {
            // Preserve the RIGHT-EDGE-relative scroll position across the prepend: the last bar is
            // unchanged, so this keeps the user exactly where they are — at the latest if they were
            // following, or parked on history if they'd scrolled back. The load snap in setData
            // (scrollToPosition(0)) already establishes the latest up front, so the merge must NOT
            // force a jump on every deep-history chunk (that re-scrolled the user on each deep load).
            if (pos !== undefined && pos !== null) ts.scrollToPosition(pos, false);
          } catch { /* transient */ }
        };
        restore();
        // Re-assert next frame so a deferred internal scroll can't override us.
        requestAnimationFrame(() => { restore(); applyingRange.current = false; });
      } else {
        applyingRange.current = false;
      }
    };

    // Keep history loaded WELL BEYOND the visible window — PROACTIVELY, so the user
    // can never scroll or zoom out to the end while more history exists. Maintains a
    // buffer of at least BUFFER_BARS (or 3 window-widths when zoomed out, whichever is
    // larger) to the LEFT of the view, loading in chunks until that's met or history
    // runs out. Driven on chart load AND on every scroll/zoom — load before the user
    // reaches the end, not after.
    const ensureHistory = async () => {
      const cb = onNeedOlderRef.current;
      if (!cb || loading.current) return;                       // already loading → leave indicator on
      if (exhausted.current || busy.current) { syncLoading(); return; }
      const range = chart.current?.timeScale().getVisibleLogicalRange();
      if (!range) { syncLoading(); return; }
      const visible = Math.max(1, range.to - range.from);
      const tfSec = Math.max(1, (bars.current[1]?.time ?? 0) - (bars.current[0]?.time ?? 0));
      // Aggressive deep buffer on intraday-fast timeframes (≤M30), where the deep walk
      // is one cheap fetch. On coarser timeframes (H1+) load on demand, scaled to the
      // actual zoom, so we don't fire a huge walk for history the user isn't viewing.
      const want = tfSec <= 1800
        ? Math.max(BUFFER_BARS, Math.round(visible * 4))
        : Math.max(300, Math.round(visible * 2));
      if (range.from >= want) { syncLoading(); return; }          // buffer already deep enough
      const oldest = bars.current[0]?.time;
      if (oldest === undefined) { syncLoading(); return; }
      loading.current = true;
      syncLoading();
      let again = false;
      try {
        // Fetch enough to reach the target in a single deep walk (plus one window of slack).
        const count = Math.min(10000, Math.max(600, Math.ceil(want - range.from) + Math.round(visible)));
        const older = (await cb(oldest, count)).filter((b) => b.time < oldest);
        // Re-check the CURRENT chart afterward whether this load landed or was superseded
        // (symbol/tf changed mid-fetch) — otherwise a stale in-flight load would leave the
        // new chart's buffer unbuilt.
        if (bars.current[0]?.time !== oldest) { again = true; return; }
        if (older.length === 0) { exhausted.current = true; return; }
        mergeBars(older);
        again = true; // keep filling toward the buffer target
      } catch { /* aborted on a chart switch, or a transient fetch error → stop this sequence */
      } finally {
        loading.current = false;
        if (again) void ensureHistory();
        else syncLoading();
      }
    };

    // ── Per-family series option builders (Item 5) ──────────────────────────────
    // Each maps the active token palette onto the lightweight-charts option shape for
    // one series family. The candle one IS `chartTheme().candleOptions` (so candles
    // stay byte-identical); the rest derive sensible colours from the same up/down/gold
    // tokens the candle series uses, so a type switch keeps the theme coherent.
    const candleOpts = (t: ThemeTokens): CandlestickSeriesPartialOptions => chartTheme(t).candleOptions;
    // `hollow` candles: up bars are unfilled (transparent body, coloured border + wick),
    // down bars stay filled — the conventional hollow-candlestick look.
    const hollowOpts = (t: ThemeTokens): CandlestickSeriesPartialOptions => ({
      upColor: 'rgba(0,0,0,0)', downColor: t.downBody,
      borderUpColor: t.upBody, borderDownColor: t.downBody, borderVisible: true,
      wickUpColor: t.upBody, wickDownColor: t.downBody,
    });
    const barOpts = (t: ThemeTokens): BarSeriesPartialOptions => ({
      upColor: t.upBody, downColor: t.downBody, openVisible: true, thinBars: false,
    });
    const lineOpts = (t: ThemeTokens): LineSeriesPartialOptions => ({
      color: t.accent, lineWidth: 2, priceLineVisible: false, lastValueVisible: true,
    });
    const areaOpts = (t: ThemeTokens): AreaSeriesPartialOptions => ({
      lineColor: t.accent, topColor: t.accent, bottomColor: 'rgba(0,0,0,0)',
      lineWidth: 2, priceLineVisible: false, lastValueVisible: true,
    });
    const baselineOpts = (t: ThemeTokens): BaselineSeriesPartialOptions => ({
      topLineColor: t.upBody, topFillColor1: t.upBody, topFillColor2: 'rgba(0,0,0,0)',
      bottomLineColor: t.downBody, bottomFillColor1: t.downBody, bottomFillColor2: 'rgba(0,0,0,0)',
      lineWidth: 2, priceLineVisible: false, lastValueVisible: true,
    });

    // Apply the right token-derived options to the ACTIVE price series for its family.
    const themeActiveSeries = (t: ThemeTokens) => {
      const p = price.current;
      if (!p) return;
      switch (seriesType.current) {
        case 'candles': p.applyOptions(candleOpts(t)); break;
        case 'heikinashi': p.applyOptions(candleOpts(t)); break;
        case 'hollow': p.applyOptions(hollowOpts(t)); break;
        case 'bars': p.applyOptions(barOpts(t)); break;
        case 'line': p.applyOptions(lineOpts(t)); break;
        case 'area': p.applyOptions(areaOpts(t)); break;
        case 'baseline': p.applyOptions(baselineOpts(t)); break;
      }
    };

    // Re-theme primitive (Foundation 2): applies a theme to the chart + overlay, and
    // (Item 5) the ACTIVE price series in its own family's option shape. For the default
    // `candles` type this is byte-identical to before (candle series gets candleOptions).
    // `opts` carries the chart/overlay options for the current tokens; the per-series
    // colours come from the live tokens (current at every call site: seed + registry +
    // ThemeProvider).
    const applyChartTheme = (opts: ChartThemeOptions) => {
      chart.current?.applyOptions(opts.chartOptions);
      overlay.current?.applyOptions(opts.overlayOptions);
      themeActiveSeries(getActiveTokens());
    };

    // ── Active-series data feed (Item 5) ────────────────────────────────────────
    // Map the real `bars` to the active series' point shape. Candles/bars take OHLC;
    // line/area/baseline take {time, value: close}; heikinashi takes the HA-transform.
    // Heikin-Ashi is recomputed here and cached in `haBars` so the per-tick path can
    // extend it incrementally.
    const recomputeHa = () => { haBars.current = toHeikinAshi(bars.current); };
    type ValueDatum = { time: UTCTimestamp; value: number };
    type OhlcDatum = { time: UTCTimestamp; open: number; high: number; low: number; close: number };
    const activeSeriesData = (): ValueDatum[] | OhlcDatum[] => {
      const ty = seriesType.current;
      if (isValueFamily(ty)) return bars.current.map((b) => ({ time: b.time as UTCTimestamp, value: b.close }));
      if (ty === 'heikinashi') {
        recomputeHa();
        return haBars.current.map((b) => ({ time: b.time as UTCTimestamp, open: b.open, high: b.high, low: b.low, close: b.close }));
      }
      return bars.current.map((b) => ({ time: b.time as UTCTimestamp, open: b.open, high: b.high, low: b.low, close: b.close }));
    };
    // Replace the active series' whole dataset from the current bars.
    const setActiveData = () => { price.current?.setData(activeSeriesData() as never); };
    // Apply ONE bar to the active series in its shape (the per-tick forming-bar path).
    // For heikinashi the new HA bar depends on the prior HA bar, so we extend `haBars`.
    const updateActive = (bar: ChartBar) => {
      const p = price.current;
      if (!p) return;
      const ty = seriesType.current;
      if (isValueFamily(ty)) { p.update({ time: bar.time as UTCTimestamp, value: bar.close } as never); return; }
      if (ty === 'heikinashi') {
        const ha = haBars.current;
        const lastHa = ha[ha.length - 1] ?? null;
        // Same bar (forming) → recompute from the bar BEFORE it; new bar → chain off the last.
        const prevHa = lastHa && lastHa.time === bar.time ? (ha[ha.length - 2] ?? null) : lastHa;
        const next = heikinAshiNext(bar, prevHa);
        if (lastHa && lastHa.time === bar.time) ha[ha.length - 1] = next;
        else if (!lastHa || next.time > lastHa.time) ha.push(next);
        p.update({ time: next.time as UTCTimestamp, open: next.open, high: next.high, low: next.low, close: next.close } as never);
        return;
      }
      p.update({ time: bar.time as UTCTimestamp, open: bar.open, high: bar.high, low: bar.low, close: bar.close } as never);
    };

    // Create the lightweight-charts series for `type`, store it in `price` (+ `candles`
    // when it's a candle family, else null), and seed its theme. Does NOT feed data —
    // the caller re-feeds via setActiveData after creating.
    const buildSeries = (type: SeriesTypeName) => {
      const c = chart.current;
      if (!c) return;
      const t = getActiveTokens();
      let s: ISeriesApi<SeriesType>;
      switch (seriesFamily(type)) {
        case 'bar': s = c.addBarSeries(barOpts(t)); break;
        case 'line': s = c.addLineSeries(lineOpts(t)); break;
        case 'area': s = c.addAreaSeries(areaOpts(t)); break;
        case 'baseline': s = c.addBaselineSeries(baselineOpts(t)); break;
        case 'candlestick':
        default:
          s = c.addCandlestickSeries(type === 'hollow' ? hollowOpts(t) : candleOpts(t));
          break;
      }
      price.current = s;
      candles.current = seriesFamily(type) === 'candlestick' ? (s as ISeriesApi<'Candlestick'>) : null;
      seriesType.current = type;
    };

    // (Re-)apply the cached trade markers to the active series.
    const applyMarkers = () => price.current?.setMarkers(
      lastMarkers.current.map((m) => ({ time: m.time as UTCTimestamp, position: m.position, color: m.color, shape: m.shape, text: m.text })),
    );

    // Switch the active render type (Item 5). Keeps the real `bars` untouched: removes the
    // old price series, builds the new one, re-feeds the current bars in the new shape,
    // re-applies markers, and preserves the user's scroll position. No-ops when the type is
    // unchanged or the chart isn't ready. NOTE: price-lines / primitives created against the
    // PREVIOUS series are owned by their callers and are not auto-migrated — the consuming
    // feature re-attaches them through its own lifecycle (drawing/indicator/trade layers do).
    const switchSeriesType = (type: SeriesTypeName) => {
      const c = chart.current;
      if (!c) { seriesType.current = type; return; }      // pre-mount: remember the choice
      if (type === seriesType.current && price.current) return; // already showing it
      const ts = c.timeScale();
      const pos = ts.scrollPosition();
      const old = price.current;
      applyingRange.current = true;
      // Build BEFORE removing so `price`/`candles` never momentarily point at a removed
      // series (defensive against a concurrent pass-through).
      buildSeries(type);
      if (old) { try { c.removeSeries(old); } catch { /* already gone */ } }
      setActiveData();        // re-feed the current bars in the new shape (HA-transforms if needed)
      applyMarkers();         // re-attach the cached markers to the new series
      // Restore the scroll position (the data swap can nudge the view to realtime).
      if (pos !== undefined && pos !== null) {
        const restore = () => { try { ts.scrollToPosition(pos, false); } catch { /* transient */ } };
        restore();
        requestAnimationFrame(() => { restore(); applyingRange.current = false; });
      } else {
        applyingRange.current = false;
      }
    };

    useEffect(() => {
      const c = createChart(el.current!, {
        layout: { background: { color: '#0e1116' }, textColor: '#9aa4b2', fontSize: 11 },
        grid: { vertLines: { color: '#161d27' }, horzLines: { color: '#161d27' } },
        rightPriceScale: { borderColor: '#222b36' },
        timeScale: { borderColor: '#222b36', timeVisible: true, secondsVisible: false },
        crosshair: { mode: 0 },
        autoSize: true,
      });
      chart.current = c;
      // A render type may have been requested BEFORE the chart existed (the integrator
      // can call setSeriesType during the parent's mount). Honour it after building the
      // default candlestick below.
      const wanted = seriesType.current;
      // Default render type = candles. These literal options are byte-identical to the
      // pre-Item-5 chart; the active-series ref + type are seeded to this candlestick.
      candles.current = c.addCandlestickSeries({
        upColor: '#26a69a', downColor: '#ef5350', borderVisible: false,
        wickUpColor: '#26a69a', wickDownColor: '#ef5350',
      });
      price.current = candles.current;
      seriesType.current = 'candles';
      overlay.current = c.addLineSeries({ color: '#f0b90b', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
      // Seed the active theme's colours immediately. For `dark` these are byte-identical
      // to the literals above (no visible change); for any other active theme this paints
      // the chart in the right palette from the first frame (no flash). Then register so
      // a later theme switch re-themes this chart live.
      applyChartTheme(chartTheme(getActiveTokens()));
      // If a non-default type was requested pre-mount, switch to it now (no data yet, so
      // this just swaps the empty series; setData then feeds it in the right shape).
      if (wanted !== 'candles') switchSeriesType(wanted);
      const unregister = registerChart((tokens) => applyChartTheme(chartTheme(tokens)));
      // On every scroll/zoom: keep the history buffer ahead of the view (ensureHistory
      // decides whether more is needed) so the user never reaches an empty left edge.
      c.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (!range || bars.current.length === 0) return;
        // Track whether the user is pinned to the right edge (following live) or has
        // scrolled back to examine history — but ignore range changes WE make.
        if (!applyingRange.current) following.current = range.to >= bars.current.length - 1;
        if (busy.current) return;
        void ensureHistory();
      });
      return () => { unregister(); c.remove(); };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useImperativeHandle(ref, (): ChartHandle => ({
      setData: (data, resetView = true) => {
        const wasFollowing = following.current;
        const hadBars = bars.current.length > 0;
        bars.current = [...data];
        exhausted.current = false;
        // Feed the ACTIVE series in its shape (default candles = same data as before).
        setActiveData();
        // Snap to the most recent ~VISIBLE bars (right-aligned; whitespace to the
        // left if fewer are loaded yet, which the background fill then populates)
        // ONLY on a genuine instrument/timeframe change, the first load, or when the
        // user is already following the right edge. If the user has scrolled back to
        // examine history and this is just a refresh/reload of the SAME chart, leave
        // their view untouched — lightweight-charts anchors setData by time, so the
        // bars they're looking at stay put instead of being yanked to the latest.
        if (resetView || wasFollowing || !hadBars) {
          applyingRange.current = true;
          // Snap to the latest VISIBLE bars. Recompute the length off bars.current
          // (not the captured `data`) so a re-assert after a background prepend
          // still lands on the LAST bar.
          const snapLatest = () => {
            const ts = chart.current?.timeScale();
            if (!ts) return;
            const n = bars.current.length;
            try {
              ts.setVisibleLogicalRange({ from: n - VISIBLE, to: n + 1 }); // ~VISIBLE-bar zoom
              // FORCE the newest bar to the right edge, INSTANTLY. setVisibleLogicalRange alone is
              // silently ignored on a reused chart whose bar count just shrank (a timeframe switch,
              // e.g. M5→H1), leaving the view at the OLDEST bar (observed pos=-166). scrollToPosition
              // IS honored there; animated:false makes it a JUMP, not a slow slide (which is dizzying).
              ts.scrollToPosition(0, false);
            } catch { /* transient */ }
          };
          snapLatest();
          following.current = true;
          // Re-assert on the NEXT frame: a single synchronous setVisibleLogicalRange
          // can be lost to lightweight-charts' deferred post-setData scroll OR to a
          // late layout pass (0-width mount in a freshly-shown tab / on mobile),
          // which would leave the view parked on an OLDER candle instead of the
          // latest. The merge path already re-asserts its scroll in rAF for exactly
          // this reason (see mergeBars above); the load snap needs the same guard.
          // Kept INSIDE the snap-condition so a user parked on history (a scroll-back
          // refresh) is never yanked to the latest.
          requestAnimationFrame(() => {
            snapLatest();
            applyingRange.current = false;
          });
        }
        // Proactively build the history buffer right after load (once the range has
        // committed) — so the user can zoom out immediately without seeing the end.
        requestAnimationFrame(() => void ensureHistory());
      },
      update: (bar) => {
        const arr = bars.current;
        const last = arr[arr.length - 1];
        if (last && bar.time === last.time) arr[arr.length - 1] = bar;
        else if (!last || bar.time > last.time) arr.push(bar);
        // Apply the forming bar to the ACTIVE series in its shape. For the default
        // candles type this is the candlestick OHLC update exactly as before; for
        // line/area it's {time,value:close}; for HA it extends the cached HA series.
        updateActive(bar);
      },
      merge: mergeBars,
      lastBar: () => bars.current[bars.current.length - 1] ?? null,
      setBusy: (b) => { busy.current = b; syncLoading(); },
      setOverlay: (points) => overlay.current?.setData(points.map((p) => ({ time: p.time as UTCTimestamp, value: p.value }))),
      // Markers ride on the ACTIVE price series so they follow a render-type switch
      // (cached so a switch can re-apply them to the freshly-created series).
      setMarkers: (markers) => { lastMarkers.current = markers; applyMarkers(); },
      applyTheme: (opts) => applyChartTheme(opts),
      setSeriesType: (type) => switchSeriesType(normalizeSeriesType(type)),

      // ── Foundation 3 seam — additive pass-throughs (never touch the pipeline) ──
      // Coordinate/price-line/primitive helpers route through the ACTIVE price series so
      // drawing, on-chart trading, indicators and alerts keep working after a type switch.
      priceToCoordinate: (p) => price.current?.priceToCoordinate(p) ?? null,
      coordinateToPrice: (y) => price.current?.coordinateToPrice(y as Coordinate) ?? null,
      timeToCoordinate: (time) => chart.current?.timeScale().timeToCoordinate(time as UTCTimestamp) ?? null,
      coordinateToTime: (x) => { const t = chart.current?.timeScale().coordinateToTime(x as Coordinate); return typeof t === 'number' ? t : null; },
      getVisibleLogicalRange: () => { const r = chart.current?.timeScale().getVisibleLogicalRange(); return r ? { from: r.from, to: r.to } : null; },
      getVisibleTimeRange: () => { const r = chart.current?.timeScale().getVisibleRange(); return r && typeof r.from === 'number' && typeof r.to === 'number' ? { from: r.from, to: r.to } : null; },
      onViewChange: (cb) => {
        const ts = chart.current?.timeScale();
        if (!ts) return () => {};
        const h = () => cb();
        ts.subscribeVisibleLogicalRangeChange(h);
        return () => { try { ts.unsubscribeVisibleLogicalRangeChange(h); } catch { /* chart removed */ } };
      },
      getChartApi: () => chart.current,
      // Returns the active series ONLY when it's a candlestick (candles/hollow/heikinashi);
      // null for bar/line/area/baseline so candle-typed callers stay safe.
      getCandleSeries: () => candles.current,
      getBarsSnapshot: () => [...bars.current],
      subscribeCrosshair: (cb) => {
        const c = chart.current;
        if (!c) return () => {};
        const h = (param: MouseEventParams) => cb({
          time: (typeof param.time === 'number' ? param.time : null),
          price: param.point && price.current ? (price.current.coordinateToPrice(param.point.y) ?? null) : null,
        });
        c.subscribeCrosshairMove(h);
        return () => { try { c.unsubscribeCrosshairMove(h); } catch { /* chart removed */ } };
      },
      setCrosshair: (time, p) => { if (price.current) chart.current?.setCrosshairPosition(p, time as UTCTimestamp, price.current); },
      clearCrosshair: () => chart.current?.clearCrosshairPosition(),
      createPriceLine: (opts) => price.current?.createPriceLine(opts) ?? null,
      removePriceLine: (line) => price.current?.removePriceLine(line),
      attachPrimitive: (p) => price.current?.attachPrimitive(p),
      detachPrimitive: (p) => price.current?.detachPrimitive(p),
      setPriceScaleMode: (mode) => chart.current?.priceScale('right').applyOptions({ mode }),
      takeScreenshot: () => chart.current?.takeScreenshot() ?? null,
      setWatermark: (opts) => chart.current?.applyOptions({
        watermark: { visible: opts.visible, text: opts.text ?? '', fontSize: opts.fontSize ?? 48, horzAlign: 'center', vertAlign: 'center' },
      }),

      clear: () => { bars.current = []; haBars.current = []; exhausted.current = false; price.current?.setData([]); overlay.current?.setData([]); price.current?.setMarkers([]); },
    }), []);

    return <div className="chart" ref={el} />;
  },
);
