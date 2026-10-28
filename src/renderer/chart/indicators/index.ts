/**
 * Chart indicators — public surface for the integrator.
 *
 * A self-contained indicators feature with MT5-EXACT math: ≥12 indicators (7
 * overlays + 8 oscillators), ported VERBATIM from MetaQuotes' own reference sources
 * via the sibling transpiler's MT5-exact runtime. See `math.ts` for the per-
 * indicator recurrence notes (ATR = SMA-of-TR not Wilder; RSI Wilder; EMA seeding;
 * etc.).
 *
 * ════════════════════════════════════════════════════════════════════════════════
 * MOUNT_GUIDE — how the integrator wires this into `ChartPane.tsx`
 * ════════════════════════════════════════════════════════════════════════════════
 *
 * Everything lives under `src/renderer/chart/indicators/`. Nothing here edits any
 * existing file; the two components below are dropped into ChartPane's render.
 *
 * ── 1) The toolbar button: <IndicatorMenu/> ───────────────────────────────────
 *
 * Place the "Indicators" button in the chart's toolbar (next to the timeframe / tool
 * controls). It's a self-contained button + popover that writes through the shared
 * manager — no props beyond the chart context:
 *
 *   import { IndicatorMenu } from '../chart/indicators';
 *   …
 *   <IndicatorMenu
 *     accountId={accountId}
 *     symbol={symbol}
 *     timeframe={timeframe}
 *   />
 *
 *   Props:
 *     accountId  : string | null   — the pane's account id (its `accountId` prop)
 *     symbol     : string | null   — the pane's symbol (its `symbol` prop)
 *     timeframe  : number          — the pane's timeframe (its `timeframe` prop)
 *
 *   The button auto-disables when `symbol` is null (no chart to attach to). The
 *   popover handles add / edit (params + colours) / show-hide / remove. If the
 *   toolbar lives OUTSIDE `.chart-pane`, that's fine — the menu only needs the
 *   context props; it shares the SAME `indicatorManager` singleton the host reads.
 *
 * ── 2) The mount: <IndicatorHost/> ────────────────────────────────────────────
 *
 * Render INSIDE `.chart-pane`, BELOW the main `<Chart>`, in a flex COLUMN. The host
 * attaches OVERLAY indicators imperatively onto the main chart (no DOM) and renders
 * the OSCILLATOR stack as real DOM beneath the chart:
 *
 *   import { IndicatorHost } from '../chart/indicators';
 *   …
 *   // .chart-pane must be `display:flex; flex-direction:column` for the oscillator
 *   // stack to sit below the chart. The existing `.chart-pane` is
 *   // `position:relative; flex:1 1 0`; wrap the <Chart> in a `flex:1 1 0; min-height:0`
 *   // box and put the host after it, OR make `.chart-pane` a column and give the
 *   // chart `flex:1 1 0; min-height:0`. Concretely, in ChartPane's return:
 *
 *   <div className="chart-pane" ref={paneRef} style={{ display: 'flex', flexDirection: 'column' }}>
 *     <div style={{ position: 'relative', flex: '1 1 0', minHeight: 0 }}>
 *       <Chart ref={chartRef} … />
 *       {symbol && <DrawingLayer … />}        // (drawing overlay stays on the chart box)
 *       {historyLoading && symbol && <div className="chart-loading">…</div>}
 *       {!symbol && <div className="chart-empty">…</div>}
 *     </div>
 *     <IndicatorHost
 *       chart={chartRef.current}
 *       bars={bars}
 *       accountId={accountId}
 *       symbol={symbol}
 *       timeframe={timeframe}
 *     />
 *   </div>
 *
 *   Props:
 *     chart      : ChartHandle | null  — `chartRef.current` (the main Chart's
 *                  imperative handle). May be null on first render — the host
 *                  attaches overlays once it's non-null (re-runs when it appears).
 *                  ⚠️ `chartRef.current` is a ref, so to make the host RE-RENDER when
 *                  the chart mounts, mirror it into state (see "getting the props").
 *     bars       : ChartBar[]          — the chart's bars (oldest→newest). Recompute
 *                  fires on change. Use the same array you feed the chart.
 *     accountId  : string | null
 *     symbol     : string | null
 *     timeframe  : number
 *     oscillatorHeight? : number       — per-oscillator pane height (default 120).
 *     maxStackHeight?   : number       — cap + scroll the oscillator column (optional).
 *
 *   The host renders `null` when there are no visible oscillators (overlays attach
 *   imperatively), so it adds no layout when unused.
 *
 * ── Getting the props in ChartPane ────────────────────────────────────────────
 *
 *   • accountId / symbol / timeframe : already ChartPane props (pass straight through).
 *
 *   • chart (the handle) : ChartPane holds `const chartRef = useRef<ChartHandle>(null)`.
 *     A ref doesn't trigger re-render when it's populated, so mirror it into state on
 *     mount so the host re-renders once the chart exists:
 *
 *       const [chartHandle, setChartHandle] = useState<ChartHandle | null>(null);
 *       useEffect(() => { setChartHandle(chartRef.current); }, []);
 *       // …then pass chart={chartHandle}.
 *     (A one-time effect is enough — the handle identity is stable for the pane's life;
 *      the host internally tolerates a null→handle transition.)
 *
 *   • bars : the host needs the bar array. ChartPane keeps bars inside the Chart
 *     component, exposed via `chartRef.current.getBarsSnapshot()`. Mirror them into
 *     state so the host recomputes when they change. Two clean options:
 *       (a) In ChartPane's load/merge/forming-bar code paths (loadChart, backgroundFill,
 *           formBar), after updating the chart call `setBars(chartRef.current!.getBarsSnapshot())`.
 *       (b) Lightweight poll on a timer or on the chart's `onViewChange` + a tick
 *           subscription. (a) is preferred — it's exact and event-driven.
 *     Then pass `bars={bars}`. Volume is optional on ChartBar; VWAP/Volume indicators
 *     degrade honestly (they report "no volume" if the feed doesn't carry it).
 *
 * ── Notes ─────────────────────────────────────────────────────────────────────
 *   • Per-chart scoping + persistence is automatic: the host calls
 *     `manager.setContext("${accountId}:${symbol}:${tf}")`, and the manager saves /
 *     restores that context's instances in localStorage (key `tat.indicators.v1:<ctx>`).
 *     The menu shares the same singleton, so adding from the menu shows on the chart.
 *   • Theming is automatic (charts register for live re-theme; CSS-var styles are
 *     injected once). No index.html edits needed.
 *   • lightweight-charts v4.2.3 has no native panes — that's why each oscillator is
 *     its own time-synced sub-chart; overlays share the main price axis.
 * ════════════════════════════════════════════════════════════════════════════════
 */

export { IndicatorHost } from './IndicatorHost';
export type { IndicatorHostProps } from './IndicatorHost';
export { IndicatorMenu } from './IndicatorMenu';
export type { IndicatorMenuProps } from './IndicatorMenu';
export { OscillatorPane } from './OscillatorPane';
export type { OscillatorPaneProps } from './OscillatorPane';

export {
  IndicatorManager,
  indicatorManager,
  indicatorContextKey,
  nextInstanceId,
} from './manager';
export type { IndicatorInstance } from './manager';

export {
  INDICATORS,
  getIndicator,
  isVolumeBased,
} from './registry';
export type {
  IndicatorDef,
  IndiParam,
  IndiParamType,
  IndiOutput,
  IndiPoint,
} from './registry';

export type { IndiBar, Series } from './math';
// Re-export the MT5-exact math functions for any consumer that wants them directly.
export {
  sma,
  ema,
  smma,
  lwma,
  ma,
  rsi,
  atr,
  macd,
  stochastic,
  adx,
  cci,
  momentum,
  bollinger,
  ichimoku,
  vwap,
  volume,
  // ── the 20 additional MT5 indicators ──
  demarker,
  williamsR,
  bearsPower,
  bullsPower,
  osma,
  rvi,
  trix,
  stddev,
  mfi,
  obv,
  ad,
  awesome,
  accelerator,
  alligator,
  gator,
  adxWilder,
  envelopes,
  parabolicSar,
  fractals,
  force,
  displaced,
  appliedPrice,
  APPLIED,
  MA_METHOD,
  STO_PRICE,
  APPLIED_VOLUME,
  VOLUME_COLOR,
} from './math';
export type {
  RviBuffers,
  AlligatorBuffers,
  GatorBuffers,
  EnvelopesBuffers,
  FractalsBuffers,
} from './math';
