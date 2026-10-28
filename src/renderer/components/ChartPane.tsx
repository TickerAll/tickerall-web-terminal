/**
 * One chart and everything that drives it — extracted verbatim from Terminal so the
 * shell can render N of these (multi-chart) without each re-implementing the
 * load-bearing forming-bar / history-buffer / deep-load pipeline. Owns its own
 * chartRef + load generation; reloads when its (account, symbol, timeframe) props
 * change (or a `reloadKey` bump forces a same-chart refresh). Live ticks for its
 * symbol arrive via the shared tickBus (one broker subscription for all panes).
 *
 * Prime directive: the chart pipeline below (formBar / loadChart / backgroundFill +
 * the Chart.tsx internals) is unchanged — only relocated.
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { ChartBar, TradeMarker } from '../../shared/types';
import { TF_LABEL } from '../../shared/types';
import { api, humanizeError } from '../api';
import { Chart, type ChartHandle } from './Chart';
import { tickBus } from '../chart/tickBus';
import { TF_SECONDS, mergeTickWindow, hasHole } from '../chart/chartData';
import { type OverlayChart, type DrawingActions, type PositionTradePlan } from '../drawing/CanvasOverlay';
import type { TradeContext } from '../drawing/tools/registry';
import { DrawingStore } from '../drawing/DrawingStore';
import type { DrawingKind, DrawingStyle } from '../drawing/types';
import { DrawingLayer } from '../drawing/ui/DrawingLayer';
import { contextKey, loadDrawings, saveDrawings, loadDefaultStyle, saveDefaultStyle, loadMagnet, saveMagnet, debounce } from '../drawing/persistence';
import { markDrawTapConsumed } from '../drawing/tapSignal';
import { useSetting } from '../settings/hooks';
import { ensureChartChromeStyle } from './chartChromeStyle';
import { SessionBreaks } from './SessionBreaks';
import { KittyLayer } from './KittyLayer';
import { CandleCountdown } from './CandleCountdown';
import { TradeLayer, type ChartTrade } from './TradeLayer';
import { IndicatorHost } from '../chart/indicators';

/** The handle the shell uses for cross-cutting actions on a pane's chart (e.g.
 *  painting trade markers). The chart's own driving stays internal. */
export interface ChartPaneHandle {
  setMarkers(markers: TradeMarker[]): void;
  /** The pane's drawing model — additive seam (Foundation 3 / area G). The future
   *  drawing toolbar + object-manager drive the overlay through this; nothing in the
   *  chart pipeline is affected. */
  getDrawingStore(): DrawingStore;
  /** Arm a drawing tool (the next click(s) place it); null = plain select/drag. */
  setActiveTool(kind: DrawingKind | null): void;
  /** True when `clientX` falls within the right price-axis (Y-scale) gutter. Lets a tap on the
   *  axis reach lightweight-charts' native double-tap-to-refit instead of the mobile tap→TF
   *  gesture (the #8/#21/#24/#26 tap→TF family — the Y-axis is just another region to exclude). */
  isOverPriceAxis(clientX: number): boolean;
  /** The chart's currently-visible TIME window as epoch SECONDS (UTC), or null if no data is
   *  loaded. */
  getVisibleTimeRange(): { from: number; to: number } | null;
  /** The NEWEST loaded bar's time (epoch seconds, UTC), or null if no data. */
  getLastBarTime(): number | null;
}

type Props = {
  accountId: string | null;
  symbol: string | null;
  timeframe: number;
  /** Bump to force-reload the SAME chart (the reload button) — a prop change won't fire. */
  reloadKey?: number;
  /** True when at least one account is connected (drives the empty-state copy). */
  hasConnection: boolean;
  onLog: (m: string) => void;
  /** Called at the start of every (re)load. */
  onLoad?: () => void;
  // ── Drawing-engine trade seam (Items 2/6/7) — all optional/default-safe ──────
  /** Live symbol trade context (point/tickValue/contractSize/balance) for the
   *  position tool + measure ruler sizing. */
  trade?: TradeContext;
  /** Place a planned trade from the position tool's "Place this trade" menu. */
  onPlaceOrder?: (plan: PositionTradePlan) => void;
  /** Open the order ticket from "New order here" (the right-clicked price). */
  onNewOrder?: (price: number) => void;
  /** Open settings from the chart context menu. */
  onOpenSettings?: () => void;
  /** Open the connect-broker flow from the empty-chart CTA (no account connected). */
  onConnect?: () => void;
  /** Fires when the armed drawing tool changes (null = select mode). Lets the mobile shell
   *  know whether a tap on the chart would DRAW (tool armed) vs. should dismiss the drawing
   *  toolbar (no tool armed). */
  onActiveToolChange?: (tool: DrawingKind | null) => void;
  /** The user's trades on this chart's symbol (open positions + closed history),
   *  drawn MT5-style by the trade overlay. */
  trades?: ChartTrade[];
  /** Every symbol with an OPEN position on this chart's account — passed to the trade
   *  overlay so an empty overlay reveals a symbol-string mismatch on the chart instead
   *  of silently showing nothing. */
  positionSymbols?: string[];
  /** Mobile tier — enables the drawing layer's touch selection toolbar (#9). */
  isMobile?: boolean;
};

export const ChartPane = forwardRef<ChartPaneHandle, Props>(function ChartPane(
  { accountId, symbol, timeframe, reloadKey, hasConnection, onLog, onLoad, trade, onPlaceOrder, onNewOrder, onOpenSettings, onConnect, onActiveToolChange, trades, positionSymbols, isMobile }: Props,
  ref,
) {
  const chartRef = useRef<ChartHandle>(null);
  const loadGen = useRef(0); // cancels stale chart loads when the symbol/tf changes
  const lastChartKey = useRef(''); // `${id}:${symbol}:${tf}` of the last load — genuine nav vs same-chart refresh
  const lastReloadKey = useRef(-1); // last reloadKey seen — a bump = an EXPLICIT "reload chart data" (snaps to latest)
  const tfRef = useRef(timeframe); tfRef.current = timeframe; // latest tf for the forming-bar bucket
  const onLoadRef = useRef(onLoad); onLoadRef.current = onLoad;
  // Two distinct loading signals (additive observation only — the fetch logic is
  // untouched):
  //   • recentLoading — the INITIAL/recent load this pane OWNS (its loadChart broker
  //     fetch + the hole-fill loop). Set true at the start of loadChart, cleared once
  //     setData has run (or on error). Shown as a prominent top-LEFT badge (Item 9).
  //   • deepLoading — the OLDER/deep scroll-back signal reported by Chart via onLoading
  //     ({ older }) — a scroll-back fetch in flight OR the background fill. Shown as a
  //     spinner at the left data edge (Item 8).
  const [recentLoading, setRecentLoading] = useState(false);
  const [deepLoading, setDeepLoading] = useState(false);

  // Inject the chart-chrome CSS once (loading indicators + countdown badge) — mirrors
  // ThemeProvider.ensureChromeStyle so we never edit index.html.
  ensureChartChromeStyle();

  // Background symbol+timeframe watermark (configurable; large faded text behind the chart).
  const [wmEnabled] = useSetting<boolean>('chart.watermark.enabled');
  const [wmFontSize] = useSetting<number>('chart.watermark.fontSize');
  // In-chart candle countdown (Item 13) — gated by the existing setting (default on).
  const [showCountdown] = useSetting<boolean>('chart.showCountdown');
  // Chart series type (Item 5) — candles/hollow/bars/line/area/baseline/heikinashi.
  const [chartType] = useSetting<string>('chart.defaultType');
  // Log/linear price scale (bottom-right toggle), persisted.
  const [logScale, setLogScale] = useState<boolean>(() => localStorage.getItem('ta.logScale') === '1');
  // Latest tick time for THIS pane's symbol (epoch s) — drives the countdown's broker
  // offset. Captured (display-only) alongside the forming-bar tick; never affects bars.
  const [quoteTime, setQuoteTime] = useState<number | null>(null);

  // ── Indicators (Item 1) — overlay series attach to the main pane; oscillators
  // render as a stacked, time-synced column below. The host needs the live chart
  // handle + bars, which we mirror into state (a ref alone won't re-render). This is
  // display-only OBSERVATION on a timer — the data pipeline is never touched. ──────
  const [chartHandle, setChartHandle] = useState<ChartHandle | null>(null);
  const [bars, setBars] = useState<ChartBar[]>([]);
  useEffect(() => { setChartHandle(chartRef.current); }, []);
  useEffect(() => {
    if (!symbol) { setBars([]); return; }
    const refresh = () => setBars(chartRef.current?.getBarsSnapshot() ?? []);
    refresh();
    const t = setInterval(refresh, 700); // pick up loads/merges + the forming bar (~1.4 Hz)
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, symbol, timeframe, reloadKey]);

  // ── Drawing engine (area G) — additive, mounts a canvas overlay + toolbar +
  // object-manager sibling of the chart. The overlay only consumes the additive
  // ChartHandle accessors; the chart pipeline above/below is untouched. ──────────
  const paneRef = useRef<HTMLDivElement>(null);
  const drawingStore = useRef<DrawingStore>(null as unknown as DrawingStore);
  if (drawingStore.current === null) drawingStore.current = new DrawingStore();
  const [activeTool, setActiveTool] = useState<DrawingKind | null>(null);
  // Persisted drawing preferences (default style + magnet) — seeded from the settings
  // store, written back through it. Lazy-init so the first render already has them.
  const [drawStyle, setDrawStyle] = useState<DrawingStyle>(() => loadDefaultStyle());
  const [magnet, setMagnetState] = useState<boolean>(() => loadMagnet());
  const setDrawStyleP = useCallback((s: DrawingStyle) => { setDrawStyle(s); saveDefaultStyle(s); }, []);
  const setMagnetP = useCallback((v: boolean) => { setMagnetState(v); saveMagnet(v); }, []);
  // The context key the store currently holds (so a context change saves the OLD
  // key's drawings before loading the NEW key's). null until the first load.
  const drawKeyRef = useRef<string | null>(null);
  // Debounced save of the live store to the current context key (a drag fires many
  // mutations; coalesce them into one IPC write).
  const saveNow = useRef(debounce(() => {
    saveDrawings(drawKeyRef.current, drawingStore.current.list());
  }, 400)).current;
  // A stable OverlayChart that delegates to the live chartRef (which is null until the
  // Chart mounts) — so the overlay reads real projections as soon as they're available.
  const overlayChart = useMemo<OverlayChart>(() => ({
    priceToCoordinate: (p) => chartRef.current?.priceToCoordinate(p) ?? null,
    coordinateToPrice: (y) => chartRef.current?.coordinateToPrice(y) ?? null,
    timeToCoordinate: (t) => chartRef.current?.timeToCoordinate(t) ?? null,
    coordinateToTime: (x) => chartRef.current?.coordinateToTime(x) ?? null,
    getVisibleLogicalRange: () => chartRef.current?.getVisibleLogicalRange() ?? null,
    getBarsSnapshot: () => chartRef.current?.getBarsSnapshot() ?? [],
    onViewChange: (cb) => chartRef.current?.onViewChange(cb) ?? (() => {}),
  }), []);
  // A stable READ-ONLY accessor for the visual overlays (session breaks + countdown) —
  // delegates to the live chartRef, satisfies both BreaksChart and CountdownChart. Like
  // overlayChart it touches only the additive ChartHandle accessors (never the pipeline).
  const chartAccess = useMemo(() => ({
    lastBar: () => chartRef.current?.lastBar() ?? null,
    priceToCoordinate: (p: number) => chartRef.current?.priceToCoordinate(p) ?? null,
    timeToCoordinate: (t: number) => chartRef.current?.timeToCoordinate(t) ?? null,
    getBarsSnapshot: () => chartRef.current?.getBarsSnapshot() ?? [],
    onViewChange: (cb: () => void) => chartRef.current?.onViewChange(cb) ?? (() => {}),
  }), []);
  // The chart context-menu actions: shell ones come from props (new order / settings);
  // reset-zoom + screenshot are served locally from the chartRef (no shell needed).
  const drawActions = useMemo<DrawingActions>(() => ({
    onNewOrder,
    onOpenSettings,
    onResetZoom: () => { try { chartRef.current?.getChartApi()?.timeScale().resetTimeScale(); } catch { /* chart gone */ } },
    onScreenshot: () => {
      const canvas = chartRef.current?.takeScreenshot();
      if (!canvas) return;
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `${symbol ?? 'chart'}.png`; a.click();
        URL.revokeObjectURL(url);
      });
    },
  }), [onNewOrder, onOpenSettings, symbol]);

  // ── Live tick → build the candle, exactly like MT5 ─────────────────────────
  // Candles are built FROM THE TICK STREAM (~9 ticks/s), not polled. The broker's
  // candle endpoint only snapshots the forming bar every few seconds, so a polled
  // candle pops in already 30-40 points wide and sits frozen. Building from ticks,
  // a new candle is born as a doji at its first tick and grows tick-by-tick. The
  // bucket is anchored to the broker's bar PHASE (the last loaded bar's time) so it
  // lines up with the broker's grid (incl. its timezone offset).
  const formBar = (price: number, time: number) => {
    if (!Number.isFinite(price)) return;
    const lb = chartRef.current?.lastBar() ?? null;
    if (!lb) return;
    const tfSec = TF_SECONDS[tfRef.current] ?? 3600;
    const t = Number.isFinite(time) ? time : Date.now() / 1000;
    const bucket = lb.time + Math.floor((t - lb.time) / tfSec) * tfSec;
    if (bucket < lb.time) return; // tick older than the current candle → ignore
    if (bucket === lb.time) {
      // Same period → grow the candle: move the close, stretch the wicks (only out).
      chartRef.current?.update({ time: lb.time, open: lb.open, close: price, high: Math.max(lb.high, price), low: Math.min(lb.low, price) });
    } else {
      // Next period → a fresh candle, born SMALL (open=high=low=close) and grown by the ticks that follow.
      chartRef.current?.update({ time: bucket, open: price, high: price, low: price, close: price });
    }
  };

  // ── Chart loading ──────────────────────────────────────────────────────────
  // For COARSE timeframes only, extend history window by window with growing windows,
  // merging only NEW older bars each time (so the recent view never moves), up to a
  // ~240-bar buffer or until history runs out. The busy-guard stops it racing the
  // proactive scroll-loader.
  const backgroundFill = useCallback(async (id: string, sym: string, tf: number, gen: number, oldest: number, coarse: boolean, loaded: number) => {
    if (!coarse || loaded >= 240) return;
    chartRef.current?.setBusy(true);
    try {
      let hours = 336;
      let cur = oldest;
      let total = loaded;
      for (let step = 0; step < 8 && total < 240; step++) {
        if (gen !== loadGen.current) return;
        let chunk: ChartBar[];
        try { chunk = await api.candlesByHours(id, sym, tf, Math.round(hours)); } catch { return; }
        if (gen !== loadGen.current || chunk.length === 0) return;
        const older = chunk.filter((b) => b.time < cur);
        if (older.length === 0) return; // didn't reach further back → exhausted
        chartRef.current?.merge(older);
        total += older.length;
        cur = older[0]!.time;
        hours *= 1.8;
        if (hours > 90000) return;
      }
    } finally {
      chartRef.current?.setBusy(false);
    }
  }, []);

  const loadChart = useCallback(async (id: string, symbol: string, tf: number, reloadK: number) => {
    const gen = ++loadGen.current;
    // Show the prominent recent/initial loading badge (Item 9) — owned here, for the
    // duration of THIS pane's broker fetch + hole-fill loop. Cleared once setData has
    // painted (success) or on error, below.
    setRecentLoading(true);
    // Snap the chart to the latest candle on a genuine instrument/timeframe change OR
    // an EXPLICIT "reload chart data" (a reloadKey bump — the user asked for fresh data,
    // so put them on the newest bar). A PASSIVE re-render of the SAME chart (no reloadKey
    // change) must NOT snap — a user parked on history keeps their place while it reloads.
    const chartKey = `${id}:${symbol}:${tf}`;
    const explicitReload = reloadK !== lastReloadKey.current;
    const resetView = explicitReload || chartKey !== lastChartKey.current;
    lastReloadKey.current = reloadK;
    lastChartKey.current = chartKey;
    // Drop any in-flight scroll/zoom history fetch from the chart we're leaving, so
    // quick navigation doesn't pile a storm of stale deep-history requests on the broker.
    void api.cancelHistory();
    onLoadRef.current?.();
    chartRef.current?.setMarkers([]);
    try {
      await api.watch(id, [symbol]); // ensure ticks flow for the charted symbol
      const coarse = tf >= 16385;    // H1+ hit the slow deep-history walk
      // Fetch the broker's history (fresh — no caching). The most recent bars from
      // this endpoint LAG the live tick stream, so we don't trust them for the
      // visible edge…
      const tfSec = TF_SECONDS[tf] ?? 3600;
      let histBars = coarse ? await api.candlesByHours(id, symbol, tf, 168) : await api.candlesLive(id, symbol, tf, 200);
      if (gen !== loadGen.current) return;
      // The fast/live store MISSES minutes for any window the broker connection wasn't
      // streaming. The deep op=0x66 walk HAS those bars. Backfill the hole BEFORE the
      // first paint (so the chart never flashes the gap), blocking on the deep walk and
      // retrying for BTC's fresh-warm densify lag — capped on a time budget. (Coarse
      // TFs densify via backgroundFill.)
      if (!coarse && hasHole(histBars, tfSec)) {
        chartRef.current?.setBusy(true);
        // try/finally so the busy flag is ALWAYS cleared — a bare `return` on the
        // supersede check used to skip setBusy(false), latching busy=true and disabling
        // the proactive scroll-loader (no more deep history).
        try {
          const deadline = Date.now() + 6000;
          let prevDeepLen = -1;
          for (let attempt = 0; hasHole(histBars, tfSec) && Date.now() < deadline; attempt++) {
            if (attempt > 0) await new Promise((r) => setTimeout(r, 1200)); // densify lag — wait, retry
            let deep: ChartBar[]; try { deep = await api.candlesLive(id, symbol, tf, 4000); } catch { deep = []; }
            if (gen !== loadGen.current) return;
            if (deep.length > histBars.length) histBars = deep;
            // If the deep walk stopped GROWING, the remaining hole is one the broker can't
            // fill (a weekend / market-closed gap), not a down-window. Stop instead of
            // retrying it. A still-densifying walk keeps growing, so it keeps going.
            if (deep.length <= prevDeepLen) break;
            prevDeepLen = deep.length;
          }
        } finally {
          chartRef.current?.setBusy(false);
        }
      }
      // …rebuild the recent window from the real-time tick buffer and merge it OVER the
      // broker history (tick bars win where they exist; broker bars fill older history +
      // any tick gap). This is what makes M1 identical whether freshly built live or
      // rebuilt after a timeframe round-trip.
      const recentBars = mergeTickWindow(histBars, tickBus.buffer(id, symbol), tfSec);
      chartRef.current?.setData(recentBars, resetView);
      setRecentLoading(false); // recent window painted → drop the prominent badge (Item 9)
      const first = recentBars[0]?.time, last = recentBars[recentBars.length - 1]?.time;
      onLog(`${symbol} ${TF_LABEL[tf]} — ${recentBars.length} bars ${first ? new Date(first * 1000).toISOString().slice(5, 16) : '?'}…${last ? new Date(last * 1000).toISOString().slice(5, 16) : '?'}${coarse ? ' (loading history…)' : ''}`);
      // Older history loads on demand via the scroll-loader; coarse TFs also extend in
      // the background. The recent window is always the fresh broker bars.
      void backgroundFill(id, symbol, tf, gen, recentBars[0]?.time ?? Math.floor(Date.now() / 1000), coarse, recentBars.length);
    } catch (e) {
      if (gen !== loadGen.current) return;
      setRecentLoading(false); // error on the current load → clear the badge
      chartRef.current?.clear();
      onLog(`couldn't load ${symbol}: ${humanizeError(e)}`);
    }
  }, [onLog, backgroundFill]);

  // Reload on a genuine chart-context change (or a forced reloadKey bump). Clear when
  // there's no symbol (e.g. the account was disconnected).
  useEffect(() => {
    if (accountId && symbol) void loadChart(accountId, symbol, timeframe, reloadKey ?? 0);
    else { chartRef.current?.clear(); setRecentLoading(false); setDeepLoading(false); setQuoteTime(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, symbol, timeframe, reloadKey, loadChart]);

  // Live tick → forming bar for THIS pane's symbol (via the shared one-subscription bus).
  // We also capture the tick's broker timestamp (display-only) to drive the in-chart
  // countdown's clock offset — formBar itself (the data pipeline) is untouched.
  useEffect(() => {
    if (!accountId || !symbol) return;
    return tickBus.on(accountId, symbol, (q) => { formBar(q.bid, q.time); setQuoteTime(q.time); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, symbol]);

  // Background symbol+TF watermark — large faded text behind the chart. Re-applied on
  // symbol/tf change (the text) + when the setting changes. The chart instance persists
  // across data loads + theme changes (chartTheme sets only the colour), so it stays put.
  useEffect(() => {
    chartRef.current?.setWatermark({
      visible: !!wmEnabled && !!symbol,
      text: symbol ? `${symbol}  ${TF_LABEL[timeframe] ?? ''}`.trim() : '',
      fontSize: wmFontSize ?? 60,
    });
  }, [symbol, timeframe, wmEnabled, wmFontSize]);

  // Apply the configured series type. The Chart instance persists across data loads
  // (setData re-feeds the active series), so applying on mount + on setting change is
  // enough. Default 'candles' is byte-identical to the legacy chart.
  useEffect(() => {
    chartRef.current?.setSeriesType(chartType ?? 'candles');
  }, [chartType]);

  // Item 7 — log vs linear price scale (1 = Logarithmic, 0 = Normal). Sticky on the
  // chart instance, so applying on change (+ mount) is enough.
  useEffect(() => {
    chartRef.current?.setPriceScaleMode(logScale ? 1 : 0);
  }, [logScale]);

  // Drawings are anchored in (time, price) on THIS chart's bars and SCOPED per
  // (account, symbol, tf). On a genuine context change: flush+save the OUTGOING
  // context's drawings, then LOAD the incoming context's (so a drawing made on one
  // instrument reappears when you return to it, and never projects onto another).
  useEffect(() => {
    const prevKey = drawKeyRef.current;
    if (prevKey !== null) {
      saveNow.flush(); // commit any pending debounced save for the old context…
      saveDrawings(prevKey, drawingStore.current.list()); // …and a final synchronous save
    }
    const nextKey = contextKey(accountId, symbol, timeframe);
    drawKeyRef.current = nextKey;
    drawingStore.current.load(loadDrawings(nextKey)); // empty list when none / no key
    setActiveTool(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, symbol, timeframe]);

  // Persist on any store mutation (debounced). The subscription also fires on
  // selection changes (harmless — the debounced save just re-writes the same list).
  useEffect(() => {
    const store = drawingStore.current;
    const off = store.subscribe(() => { if (drawKeyRef.current) saveNow(); });
    return () => { off(); saveNow.flush(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(ref, () => ({
    setMarkers: (markers) => chartRef.current?.setMarkers(markers),
    getDrawingStore: () => drawingStore.current,
    setActiveTool: (kind) => setActiveTool(kind),
    getVisibleTimeRange: () => chartRef.current?.getVisibleTimeRange() ?? null,
    getLastBarTime: () => { const b = chartRef.current?.getBarsSnapshot(); return b && b.length ? b[b.length - 1]!.time : null; },
    isOverPriceAxis: (clientX) => {
      const el = paneRef.current;
      const api = chartRef.current?.getChartApi();
      if (!el || !api) return false;
      let w = 0;
      try { w = api.priceScale('right').width(); } catch { /* chart gone */ }
      if (w <= 0) return false;
      return clientX >= el.getBoundingClientRect().right - w;
    },
  }), []);

  // Surface armed-tool changes so the mobile shell knows whether a chart tap would DRAW
  // (tool armed) or should dismiss the drawing toolbar (no tool armed). (Item 4.)
  useEffect(() => { onActiveToolChange?.(activeTool); }, [activeTool]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="chart-pane">
      {/* The chart + all its absolute overlays live in .chart-main (the positioned
          parent paneRef points at); the indicator oscillator stack sits BELOW it in
          the flex column, shrinking the chart rather than overlapping it. */}
      <div className="chart-main" ref={paneRef}>
        <Chart
          ref={chartRef}
          onNeedOlder={async (oldestTime, count) => (accountId && symbol ? api.candlesBefore(accountId, symbol, timeframe, oldestTime, count) : [])}
          onLoading={(s) => setDeepLoading(s.older)}
        />
        {/* Session breaks (Item 5): MT5 period separators. A READ-ONLY transparent canvas
            BEHIND the drawing overlay (zIndex 1) — pointer-events:none, no pipeline deps. */}
        {symbol && (
          <SessionBreaks paneRef={paneRef} chart={chartAccess} tfSec={TF_SECONDS[timeframe] ?? 3600} />
        )}
        {/* Cute-theme candle decoration: when a kitty theme (Cotton Candy / Macaron) is
            active, draws cat ears + a face on each candle. READ-ONLY canvas at zIndex 1
            (above the chart, below the trade overlay); no-ops on every other theme. */}
        {symbol && <KittyLayer paneRef={paneRef} chart={chartAccess} />}
        {/* Trade visualization (MT5-style): open positions (full-width dashed open-price
            level + a left "SIDE VOL, ±P&L" label + a right-axis price tag + a direction
            arrow at the entry candle) + closed trades (entry arrow → dotted connector → exit
            arrow). READ-ONLY canvas at zIndex 2 (above session breaks, below the drawing
            overlay). Always mounted when a symbol is charted — it no-ops on an empty trade
            set, and mounting unconditionally means an empty `tradesFor` can never silently
            hide the layer. */}
        {symbol && <TradeLayer paneRef={paneRef} chart={chartAccess} trades={trades ?? []} symbol={symbol} positionSymbols={positionSymbols} />}
        {/* Drawing engine (area G): the canvas overlay + the left tool toolbar (with
            style row) + the object-manager panel. The overlay is idle pointer-events:
            none → the chart still scrolls/zooms/crosshairs; tools/selection capture it. */}
        {symbol && (
          <DrawingLayer
            paneRef={paneRef}
            chart={overlayChart}
            store={drawingStore.current}
            activeTool={activeTool}
            setActiveTool={setActiveTool}
            magnet={magnet}
            setMagnet={setMagnetP}
            style={drawStyle}
            setStyle={setDrawStyleP}
            trade={trade}
            actions={drawActions}
            onPlaceOrder={onPlaceOrder}
            isMobile={isMobile}
          />
        )}
        {/* In-chart candle countdown (Item 13): on the right price axis, just below the
            last-price label. pointer-events:none; gated by chart.showCountdown. */}
        {showCountdown !== false && (
          <CandleCountdown chart={chartAccess} timeframe={timeframe} quoteTime={quoteTime} visible={!!symbol} />
        )}
        {/* Item 9 — recent/initial load: a PROMINENT badge at the TOP-LEFT of the chart. */}
        {recentLoading && symbol && (
          <div className="chart-loading-recent"><span className="tat-spinner" /> Loading…</div>
        )}
        {/* Item 8 — deep/scroll-back history load: a spinner at the LEFT data edge,
            vertically centred (the empty area just past the oldest loaded candle). */}
        {deepLoading && symbol && (
          <div className="chart-loading-deep" style={{ top: '50%' }}><span className="tat-spinner" /> Loading history…</div>
        )}
        {/* Item 7 — log/linear price-scale toggle, bottom-right corner of the chart. */}
        {symbol && (
          <button
            className="scale-toggle"
            title={logScale ? 'Logarithmic scale — click for linear' : 'Linear scale — click for logarithmic'}
            // On touch, stamp this tap as consumed (at pointer-down, before the chart's
            // touch-end fires) so the shell's tap→TF-strip gesture skips it — same #8 hand-off
            // the drawing layer uses. Without this a lin/log tap ALSO opens the TF dial (#24).
            onPointerDown={(e) => { if (e.pointerType === 'touch') markDrawTapConsumed(); }}
            onClick={() => setLogScale((v) => { localStorage.setItem('ta.logScale', v ? '0' : '1'); return !v; })}
          >{logScale ? 'log' : 'lin'}</button>
        )}
        {!symbol && (
          <div className="chart-empty">
            <div className="chart-empty-card">
              {hasConnection ? (
                <>
                  <h3>Pick a symbol</h3>
                  <p className="muted">Choose a symbol in Market Watch to chart it.</p>
                </>
              ) : (
                <>
                  <h3>Connect your broker account</h3>
                  <p className="muted">Connect an MT4/MT5 account to see live quotes and charts.</p>
                  {onConnect && (
                    <button className="primary chart-empty-cta" onClick={onConnect}>＋ Connect a broker account</button>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
      {/* Indicators (Item 1): overlay series attach to the main pane above; oscillator
          instances render as a stacked, time-synced column beneath the chart. */}
      {accountId && symbol && (
        <IndicatorHost
          chart={chartHandle}
          bars={bars}
          accountId={accountId}
          symbol={symbol}
          timeframe={timeframe}
        />
      )}
    </div>
  );
});
