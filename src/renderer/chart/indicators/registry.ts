/**
 * Indicator catalog — the registry of every indicator the chart can plot.
 *
 * Each entry declares its parameters (for the edit UI), its output series (for the
 * renderer + default colours), and a `compute(bars, params)` that returns one
 * `{ time, value }[]` per output key. The math is MT5-EXACT (see `math.ts`); the
 * registry only adapts the buffer shapes into time-stamped series that
 * lightweight-charts' `setData` consumes directly (it skips the warm-up `null`s,
 * so the series start where MT5 has a plottable value — and time-align with the
 * candles by their `time`).
 *
 * `pane`:
 *   - 'overlay'    → drawn on the MAIN price pane (shares the price axis).
 *   - 'oscillator' → drawn in its own time-synced sub-chart below the main chart.
 *
 * Output `type`:
 *   - 'line'      → a line series.
 *   - 'histogram' → a histogram series (MACD/Volume).
 *   - 'dots'      → a line series drawn as point markers only (no connecting line);
 *                   for the dot/marker indicators (Parabolic SAR, Fractals) that
 *                   lightweight-charts v4 has no native scatter series for.
 */

import {
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
  MA_METHOD,
  APPLIED,
  STO_PRICE,
  VOLUME_COLOR,
  type IndiBar,
  type Series,
} from './math';

/** One time-stamped sample of an output series (lightweight-charts point). */
export interface IndiPoint {
  /** UNIX epoch seconds (= the bar's `time`). */
  time: number;
  value: number;
}

export type IndiParamType = 'int' | 'float' | 'select';

export interface IndiParam {
  name: string;
  label: string;
  type: IndiParamType;
  /** Default value (number for int/float, number id for select). */
  default: number;
  min?: number;
  max?: number;
  /** For `select`: the option list (label + numeric id). */
  options?: { label: string; value: number }[];
}

export interface IndiOutput {
  key: string;
  label: string;
  /** Default colour token — a CSS var (e.g. `var(--accent)`) or a literal hex. */
  defaultColor: string;
  /** 'line' | 'histogram' | 'dots' (point-markers only — Parabolic SAR, Fractals). */
  type: 'line' | 'histogram' | 'dots';
}

export interface IndicatorDef {
  id: string;
  label: string;
  pane: 'overlay' | 'oscillator';
  params: IndiParam[];
  outputs: IndiOutput[];
  /** Compute every output series from the bars + (validated) params. */
  compute(bars: readonly IndiBar[], params: Record<string, number>): Record<string, IndiPoint[]>;
}

// ── helpers ───────────────────────────────────────────────────────────────────

/** Read a param with a fallback to the def default (so a missing/NaN value can't
 *  crash compute — the UI validates, but compute stays defensive). */
function p(params: Record<string, number>, name: string, fallback: number): number {
  const v = params[name];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Zip a chronological `Series` (with warm-up nulls) onto the bars' timestamps,
 *  dropping the nulls. The result is exactly the set of points MT5 has a value for. */
function toPoints(bars: readonly IndiBar[], series: Series): IndiPoint[] {
  const out: IndiPoint[] = [];
  const n = Math.min(bars.length, series.length);
  for (let i = 0; i < n; i++) {
    const v = series[i];
    if (v === null || v === undefined || Number.isNaN(v)) continue;
    out.push({ time: bars[i]!.time, value: v });
  }
  return out;
}

/** The ENUM_APPLIED_PRICE select options (shared by price-based indicators). */
const APPLIED_OPTIONS: { label: string; value: number }[] = [
  { label: 'Close', value: APPLIED.PRICE_CLOSE },
  { label: 'Open', value: APPLIED.PRICE_OPEN },
  { label: 'High', value: APPLIED.PRICE_HIGH },
  { label: 'Low', value: APPLIED.PRICE_LOW },
  { label: 'Median (HL/2)', value: APPLIED.PRICE_MEDIAN },
  { label: 'Typical (HLC/3)', value: APPLIED.PRICE_TYPICAL },
  { label: 'Weighted (HLCC/4)', value: APPLIED.PRICE_WEIGHTED },
];

/** A reusable "applied price" param defaulting to Close. */
const appliedParam = (def: number = APPLIED.PRICE_CLOSE): IndiParam => ({
  name: 'applied',
  label: 'Apply to',
  type: 'select',
  default: def,
  options: APPLIED_OPTIONS,
});

/** The ENUM_MA_METHOD select options (shared by Force / StdDev / Envelopes). */
const MA_METHOD_OPTIONS: { label: string; value: number }[] = [
  { label: 'Simple (SMA)', value: MA_METHOD.MODE_SMA },
  { label: 'Exponential (EMA)', value: MA_METHOD.MODE_EMA },
  { label: 'Smoothed (SMMA)', value: MA_METHOD.MODE_SMMA },
  { label: 'Linear Weighted (LWMA)', value: MA_METHOD.MODE_LWMA },
];

/** A reusable "MA method" param. */
const maMethodParam = (def: number = MA_METHOD.MODE_SMA): IndiParam => ({
  name: 'method',
  label: 'MA method',
  type: 'select',
  default: def,
  options: MA_METHOD_OPTIONS,
});

/** A reusable tick/real volume select (for the volume-based indicators). */
const volumeParam = (): IndiParam => ({
  name: 'useReal',
  label: 'Volume',
  type: 'select',
  default: 0,
  options: [
    { label: 'Tick volume', value: 0 },
    { label: 'Real volume', value: 1 },
  ],
});

// ── a single shared `iMA` overlay factory (SMA/EMA/WMA/SMMA) ───────────────────
/** Build an overlay MA indicator for one ENUM_MA_METHOD (keeps the math identical;
 *  only the method id + colour + label differ). */
function maOverlay(
  id: string,
  label: string,
  method: number,
  defaultColor: string,
): IndicatorDef {
  return {
    id,
    label,
    pane: 'overlay',
    params: [
      { name: 'period', label: 'Period', type: 'int', default: 14, min: 1, max: 5000 },
      { name: 'shift', label: 'Shift', type: 'int', default: 0, min: -1000, max: 1000 },
      appliedParam(),
    ],
    outputs: [{ key: 'line', label, defaultColor, type: 'line' }],
    compute(bars, params) {
      const series = ma(
        bars,
        Math.max(1, Math.round(p(params, 'period', 14))),
        method,
        Math.round(p(params, 'applied', APPLIED.PRICE_CLOSE)),
        Math.round(p(params, 'shift', 0)),
      );
      return { line: toPoints(bars, series) };
    },
  };
}

// ── the catalog ────────────────────────────────────────────────────────────────

export const INDICATORS: IndicatorDef[] = [
  // ── Overlays (main price pane) ──────────────────────────────────────────────
  maOverlay('sma', 'Moving Average (SMA)', MA_METHOD.MODE_SMA, 'var(--accent)'),
  maOverlay('ema', 'Moving Average (EMA)', MA_METHOD.MODE_EMA, 'var(--gold)'),
  maOverlay('wma', 'Moving Average (LWMA)', MA_METHOD.MODE_LWMA, '#a259ff'),
  maOverlay('smma', 'Moving Average (SMMA)', MA_METHOD.MODE_SMMA, '#30a46c'),

  {
    id: 'bbands',
    label: 'Bollinger Bands',
    pane: 'overlay',
    params: [
      { name: 'period', label: 'Period', type: 'int', default: 20, min: 1, max: 5000 },
      { name: 'deviation', label: 'Deviation', type: 'float', default: 2, min: 0.1, max: 10 },
      { name: 'shift', label: 'Shift', type: 'int', default: 0, min: -1000, max: 1000 },
      appliedParam(),
    ],
    outputs: [
      { key: 'upper', label: 'Upper', defaultColor: 'var(--accent)', type: 'line' },
      { key: 'middle', label: 'Middle', defaultColor: 'var(--muted)', type: 'line' },
      { key: 'lower', label: 'Lower', defaultColor: 'var(--accent)', type: 'line' },
    ],
    compute(bars, params) {
      const b = bollinger(
        bars,
        Math.max(1, Math.round(p(params, 'period', 20))),
        p(params, 'deviation', 2),
        Math.round(p(params, 'applied', APPLIED.PRICE_CLOSE)),
        Math.round(p(params, 'shift', 0)),
      );
      return {
        upper: toPoints(bars, b.upper),
        middle: toPoints(bars, b.middle),
        lower: toPoints(bars, b.lower),
      };
    },
  },

  {
    id: 'ichimoku',
    label: 'Ichimoku Kinko Hyo',
    pane: 'overlay',
    params: [
      { name: 'tenkan', label: 'Tenkan-sen', type: 'int', default: 9, min: 1, max: 1000 },
      { name: 'kijun', label: 'Kijun-sen', type: 'int', default: 26, min: 1, max: 1000 },
      { name: 'senkouB', label: 'Senkou Span B', type: 'int', default: 52, min: 1, max: 1000 },
    ],
    outputs: [
      { key: 'tenkan', label: 'Tenkan-sen', defaultColor: '#e5484d', type: 'line' },
      { key: 'kijun', label: 'Kijun-sen', defaultColor: 'var(--accent)', type: 'line' },
      { key: 'senkouA', label: 'Senkou Span A', defaultColor: '#30a46c', type: 'line' },
      { key: 'senkouB', label: 'Senkou Span B', defaultColor: '#f5a623', type: 'line' },
      { key: 'chikou', label: 'Chikou Span', defaultColor: 'var(--muted)', type: 'line' },
    ],
    compute(bars, params) {
      const tenkan = Math.max(1, Math.round(p(params, 'tenkan', 9)));
      const kijun = Math.max(1, Math.round(p(params, 'kijun', 26)));
      const senkouB = Math.max(1, Math.round(p(params, 'senkouB', 52)));
      const ich = ichimoku(bars, tenkan, kijun, senkouB);
      // The cloud spans + Chikou are drawn DISPLACED on the chart (PLOT_SHIFT).
      // We materialise the as-plotted series here by mapping each buffer value to
      // the BAR TIME it is drawn under: a +kijun span value computed at bar i is
      // drawn at bar (i+kijun)'s time; a -kijun Chikou value at (i-kijun)'s time.
      // (Values whose target bar is outside the loaded range are dropped — MT5
      // draws the forward cloud into future whitespace, which a renderer can add
      // separately; here we cover the on-chart bars only.) Tenkan/Kijun are not
      // displaced (shift 0).
      return {
        tenkan: toPoints(bars, ich.tenkan),
        kijun: toPoints(bars, ich.kijun),
        senkouA: shiftPointsByBars(bars, ich.senkouA, ich.shift.senkouA),
        senkouB: shiftPointsByBars(bars, ich.senkouB, ich.shift.senkouB),
        chikou: shiftPointsByBars(bars, ich.chikou, ich.shift.chikou),
      };
    },
  },

  {
    id: 'vwap',
    label: 'VWAP (session)',
    pane: 'overlay',
    params: [
      {
        name: 'useReal',
        label: 'Volume',
        type: 'select',
        default: 0,
        options: [
          { label: 'Tick volume', value: 0 },
          { label: 'Real volume', value: 1 },
        ],
      },
    ],
    outputs: [{ key: 'vwap', label: 'VWAP', defaultColor: 'var(--gold)', type: 'line' }],
    compute(bars, params) {
      const r = vwap(bars, { useRealVolume: Math.round(p(params, 'useReal', 0)) === 1 });
      return { vwap: toPoints(bars, r.vwap) };
    },
  },

  {
    id: 'envelopes',
    label: 'Envelopes',
    pane: 'overlay',
    params: [
      { name: 'period', label: 'Period', type: 'int', default: 14, min: 1, max: 5000 },
      { name: 'deviation', label: 'Deviation %', type: 'float', default: 0.1, min: 0.001, max: 100 },
      { name: 'shift', label: 'Shift', type: 'int', default: 0, min: -1000, max: 1000 },
      maMethodParam(),
      appliedParam(),
    ],
    outputs: [
      { key: 'upper', label: 'Upper', defaultColor: 'var(--accent)', type: 'line' },
      { key: 'lower', label: 'Lower', defaultColor: 'var(--accent)', type: 'line' },
    ],
    compute(bars, params) {
      const e = envelopes(
        bars,
        Math.max(1, Math.round(p(params, 'period', 14))),
        p(params, 'deviation', 0.1),
        Math.round(p(params, 'method', MA_METHOD.MODE_SMA)),
        Math.round(p(params, 'applied', APPLIED.PRICE_CLOSE)),
        Math.round(p(params, 'shift', 0)),
      );
      return { upper: toPoints(bars, e.upper), lower: toPoints(bars, e.lower) };
    },
  },

  {
    id: 'sar',
    label: 'Parabolic SAR',
    pane: 'overlay',
    params: [
      { name: 'step', label: 'Step', type: 'float', default: 0.02, min: 0.001, max: 1 },
      { name: 'maximum', label: 'Maximum', type: 'float', default: 0.2, min: 0.001, max: 1 },
    ],
    outputs: [{ key: 'sar', label: 'SAR', defaultColor: 'var(--gold)', type: 'dots' }],
    compute(bars, params) {
      const series = parabolicSar(
        bars,
        p(params, 'step', 0.02),
        p(params, 'maximum', 0.2),
      );
      return { sar: toPoints(bars, series) };
    },
  },

  {
    id: 'alligator',
    label: 'Alligator',
    pane: 'overlay',
    params: [
      { name: 'jawPeriod', label: 'Jaws period', type: 'int', default: 13, min: 1, max: 1000 },
      { name: 'jawShift', label: 'Jaws shift', type: 'int', default: 8, min: 0, max: 1000 },
      { name: 'teethPeriod', label: 'Teeth period', type: 'int', default: 8, min: 1, max: 1000 },
      { name: 'teethShift', label: 'Teeth shift', type: 'int', default: 5, min: 0, max: 1000 },
      { name: 'lipsPeriod', label: 'Lips period', type: 'int', default: 5, min: 1, max: 1000 },
      { name: 'lipsShift', label: 'Lips shift', type: 'int', default: 3, min: 0, max: 1000 },
      appliedParam(APPLIED.PRICE_MEDIAN),
    ],
    outputs: [
      { key: 'jaw', label: 'Jaws', defaultColor: 'var(--accent)', type: 'line' },
      { key: 'teeth', label: 'Teeth', defaultColor: '#e5484d', type: 'line' },
      { key: 'lips', label: 'Lips', defaultColor: '#30a46c', type: 'line' },
    ],
    compute(bars, params) {
      const a = alligator(
        bars,
        Math.max(1, Math.round(p(params, 'jawPeriod', 13))),
        Math.max(0, Math.round(p(params, 'jawShift', 8))),
        Math.max(1, Math.round(p(params, 'teethPeriod', 8))),
        Math.max(0, Math.round(p(params, 'teethShift', 5))),
        Math.max(1, Math.round(p(params, 'lipsPeriod', 5))),
        Math.max(0, Math.round(p(params, 'lipsShift', 3))),
        Math.round(p(params, 'applied', APPLIED.PRICE_MEDIAN)),
      );
      // Each line is drawn FORWARD-shifted (PLOT_SHIFT) — map its computed value to
      // the bar `shift` ahead, exactly like the Ichimoku cloud.
      return {
        jaw: shiftPointsByBars(bars, a.jaw, a.shift.jaw),
        teeth: shiftPointsByBars(bars, a.teeth, a.shift.teeth),
        lips: shiftPointsByBars(bars, a.lips, a.shift.lips),
      };
    },
  },

  {
    id: 'fractals',
    label: 'Fractals',
    pane: 'overlay',
    params: [],
    outputs: [
      { key: 'upper', label: 'Up fractal', defaultColor: 'var(--accent)', type: 'dots' },
      { key: 'lower', label: 'Down fractal', defaultColor: '#e5484d', type: 'dots' },
    ],
    compute(bars, _params) {
      const f = fractals(bars);
      return { upper: toPoints(bars, f.upper), lower: toPoints(bars, f.lower) };
    },
  },

  // ── Oscillators (own sub-pane) ──────────────────────────────────────────────
  {
    id: 'rsi',
    label: 'RSI',
    pane: 'oscillator',
    params: [
      { name: 'period', label: 'Period', type: 'int', default: 14, min: 1, max: 5000 },
      appliedParam(),
    ],
    outputs: [{ key: 'rsi', label: 'RSI', defaultColor: 'var(--accent)', type: 'line' }],
    compute(bars, params) {
      const series = rsi(
        bars,
        Math.max(1, Math.round(p(params, 'period', 14))),
        Math.round(p(params, 'applied', APPLIED.PRICE_CLOSE)),
      );
      return { rsi: toPoints(bars, series) };
    },
  },

  {
    id: 'macd',
    label: 'MACD',
    pane: 'oscillator',
    params: [
      { name: 'fast', label: 'Fast EMA', type: 'int', default: 12, min: 1, max: 5000 },
      { name: 'slow', label: 'Slow EMA', type: 'int', default: 26, min: 1, max: 5000 },
      { name: 'signal', label: 'Signal SMA', type: 'int', default: 9, min: 1, max: 5000 },
      appliedParam(),
    ],
    outputs: [
      { key: 'histogram', label: 'MACD Histogram', defaultColor: 'var(--muted)', type: 'histogram' },
      { key: 'main', label: 'MACD', defaultColor: 'var(--accent)', type: 'line' },
      { key: 'signal', label: 'Signal', defaultColor: '#e5484d', type: 'line' },
    ],
    compute(bars, params) {
      const m = macd(
        bars,
        Math.max(1, Math.round(p(params, 'fast', 12))),
        Math.max(1, Math.round(p(params, 'slow', 26))),
        Math.max(1, Math.round(p(params, 'signal', 9))),
        Math.round(p(params, 'applied', APPLIED.PRICE_CLOSE)),
      );
      // The histogram is MAIN - SIGNAL where BOTH have a value (MT5's MACD pane
      // draws the difference column). Computed here so the renderer just plots it.
      const hist: Series = new Array(bars.length).fill(null);
      for (let i = 0; i < bars.length; i++) {
        const a = m.main[i];
        const s = m.signal[i];
        if (a !== null && a !== undefined && s !== null && s !== undefined) hist[i] = a - s;
      }
      return {
        histogram: toPoints(bars, hist),
        main: toPoints(bars, m.main),
        signal: toPoints(bars, m.signal),
      };
    },
  },

  {
    id: 'stochastic',
    label: 'Stochastic',
    pane: 'oscillator',
    params: [
      { name: 'kPeriod', label: '%K Period', type: 'int', default: 5, min: 1, max: 5000 },
      { name: 'dPeriod', label: '%D Period', type: 'int', default: 3, min: 1, max: 5000 },
      { name: 'slowing', label: 'Slowing', type: 'int', default: 3, min: 1, max: 5000 },
      {
        name: 'priceField',
        label: 'Price field',
        type: 'select',
        default: STO_PRICE.STO_LOWHIGH,
        options: [
          { label: 'Low/High', value: STO_PRICE.STO_LOWHIGH },
          { label: 'Close/Close', value: STO_PRICE.STO_CLOSECLOSE },
        ],
      },
    ],
    outputs: [
      { key: 'main', label: '%K', defaultColor: 'var(--accent)', type: 'line' },
      { key: 'signal', label: '%D', defaultColor: '#e5484d', type: 'line' },
    ],
    compute(bars, params) {
      const s = stochastic(
        bars,
        Math.max(1, Math.round(p(params, 'kPeriod', 5))),
        Math.max(1, Math.round(p(params, 'dPeriod', 3))),
        Math.max(1, Math.round(p(params, 'slowing', 3))),
        Math.round(p(params, 'priceField', STO_PRICE.STO_LOWHIGH)),
      );
      return { main: toPoints(bars, s.main), signal: toPoints(bars, s.signal) };
    },
  },

  {
    id: 'atr',
    label: 'ATR',
    pane: 'oscillator',
    params: [{ name: 'period', label: 'Period', type: 'int', default: 14, min: 1, max: 5000 }],
    outputs: [{ key: 'atr', label: 'ATR', defaultColor: 'var(--gold)', type: 'line' }],
    compute(bars, params) {
      const series = atr(bars, Math.max(1, Math.round(p(params, 'period', 14))));
      return { atr: toPoints(bars, series) };
    },
  },

  {
    id: 'adx',
    label: 'ADX',
    pane: 'oscillator',
    params: [{ name: 'period', label: 'Period', type: 'int', default: 14, min: 1, max: 5000 }],
    outputs: [
      { key: 'main', label: 'ADX', defaultColor: 'var(--gold)', type: 'line' },
      { key: 'plusDI', label: '+DI', defaultColor: '#30a46c', type: 'line' },
      { key: 'minusDI', label: '-DI', defaultColor: '#e5484d', type: 'line' },
    ],
    compute(bars, params) {
      const a = adx(bars, Math.max(1, Math.round(p(params, 'period', 14))));
      return {
        main: toPoints(bars, a.main),
        plusDI: toPoints(bars, a.plusDI),
        minusDI: toPoints(bars, a.minusDI),
      };
    },
  },

  {
    id: 'cci',
    label: 'CCI',
    pane: 'oscillator',
    params: [
      { name: 'period', label: 'Period', type: 'int', default: 14, min: 1, max: 5000 },
      appliedParam(APPLIED.PRICE_TYPICAL),
    ],
    outputs: [{ key: 'cci', label: 'CCI', defaultColor: 'var(--accent)', type: 'line' }],
    compute(bars, params) {
      const series = cci(
        bars,
        Math.max(1, Math.round(p(params, 'period', 14))),
        Math.round(p(params, 'applied', APPLIED.PRICE_TYPICAL)),
      );
      return { cci: toPoints(bars, series) };
    },
  },

  {
    id: 'momentum',
    label: 'Momentum',
    pane: 'oscillator',
    params: [
      { name: 'period', label: 'Period', type: 'int', default: 14, min: 1, max: 5000 },
      appliedParam(),
    ],
    outputs: [{ key: 'momentum', label: 'Momentum', defaultColor: 'var(--accent)', type: 'line' }],
    compute(bars, params) {
      const series = momentum(
        bars,
        Math.max(1, Math.round(p(params, 'period', 14))),
        Math.round(p(params, 'applied', APPLIED.PRICE_CLOSE)),
      );
      return { momentum: toPoints(bars, series) };
    },
  },

  {
    id: 'volume',
    label: 'Volumes',
    pane: 'oscillator',
    params: [
      {
        name: 'appliedVolume',
        label: 'Volume',
        type: 'select',
        default: 0,
        options: [
          { label: 'Tick volume', value: 0 },
          { label: 'Real volume', value: 1 },
        ],
      },
      { name: 'maPeriod', label: 'MA period (0=off)', type: 'int', default: 0, min: 0, max: 5000 },
    ],
    outputs: [
      { key: 'volume', label: 'Volume', defaultColor: 'var(--muted)', type: 'histogram' },
      { key: 'ma', label: 'Volume MA', defaultColor: 'var(--gold)', type: 'line' },
    ],
    compute(bars, params) {
      const r = volume(bars, {
        appliedVolume: Math.round(p(params, 'appliedVolume', 0)),
        maPeriod: Math.max(0, Math.round(p(params, 'maPeriod', 0))),
      });
      const out: Record<string, IndiPoint[]> = { volume: toPoints(bars, r.volume) };
      out.ma = r.ma ? toPoints(bars, r.ma) : [];
      return out;
    },
  },

  {
    id: 'demarker',
    label: 'DeMarker',
    pane: 'oscillator',
    params: [{ name: 'period', label: 'Period', type: 'int', default: 14, min: 1, max: 5000 }],
    outputs: [{ key: 'demarker', label: 'DeMarker', defaultColor: 'var(--accent)', type: 'line' }],
    compute(bars, params) {
      const series = demarker(bars, Math.max(1, Math.round(p(params, 'period', 14))));
      return { demarker: toPoints(bars, series) };
    },
  },

  {
    id: 'wpr',
    label: 'Williams %R',
    pane: 'oscillator',
    params: [{ name: 'period', label: 'Period', type: 'int', default: 14, min: 1, max: 5000 }],
    outputs: [{ key: 'wpr', label: '%R', defaultColor: 'var(--accent)', type: 'line' }],
    compute(bars, params) {
      const series = williamsR(bars, Math.max(1, Math.round(p(params, 'period', 14))));
      return { wpr: toPoints(bars, series) };
    },
  },

  {
    id: 'force',
    label: 'Force Index',
    pane: 'oscillator',
    params: [
      { name: 'period', label: 'Period', type: 'int', default: 13, min: 1, max: 5000 },
      maMethodParam(MA_METHOD.MODE_SMA),
      volumeParam(),
    ],
    outputs: [{ key: 'force', label: 'Force', defaultColor: 'var(--gold)', type: 'line' }],
    compute(bars, params) {
      const series = force(
        bars,
        Math.max(1, Math.round(p(params, 'period', 13))),
        Math.round(p(params, 'method', MA_METHOD.MODE_SMA)),
        Math.round(p(params, 'useReal', 0)) === 1,
      );
      return { force: toPoints(bars, series) };
    },
  },

  {
    id: 'bears',
    label: 'Bears Power',
    pane: 'oscillator',
    params: [{ name: 'period', label: 'Period', type: 'int', default: 13, min: 1, max: 5000 }],
    outputs: [{ key: 'bears', label: 'Bears Power', defaultColor: '#e5484d', type: 'histogram' }],
    compute(bars, params) {
      const series = bearsPower(bars, Math.max(1, Math.round(p(params, 'period', 13))));
      return { bears: toPoints(bars, series) };
    },
  },

  {
    id: 'bulls',
    label: 'Bulls Power',
    pane: 'oscillator',
    params: [{ name: 'period', label: 'Period', type: 'int', default: 13, min: 1, max: 5000 }],
    outputs: [{ key: 'bulls', label: 'Bulls Power', defaultColor: '#30a46c', type: 'histogram' }],
    compute(bars, params) {
      const series = bullsPower(bars, Math.max(1, Math.round(p(params, 'period', 13))));
      return { bulls: toPoints(bars, series) };
    },
  },

  {
    id: 'osma',
    label: 'OsMA (MA of Oscillator)',
    pane: 'oscillator',
    params: [
      { name: 'fast', label: 'Fast EMA', type: 'int', default: 12, min: 1, max: 5000 },
      { name: 'slow', label: 'Slow EMA', type: 'int', default: 26, min: 1, max: 5000 },
      { name: 'signal', label: 'Signal SMA', type: 'int', default: 9, min: 1, max: 5000 },
      appliedParam(),
    ],
    outputs: [{ key: 'osma', label: 'OsMA', defaultColor: 'var(--muted)', type: 'histogram' }],
    compute(bars, params) {
      const series = osma(
        bars,
        Math.max(1, Math.round(p(params, 'fast', 12))),
        Math.max(1, Math.round(p(params, 'slow', 26))),
        Math.max(1, Math.round(p(params, 'signal', 9))),
        Math.round(p(params, 'applied', APPLIED.PRICE_CLOSE)),
      );
      return { osma: toPoints(bars, series) };
    },
  },

  {
    id: 'rvi',
    label: 'Relative Vigor Index',
    pane: 'oscillator',
    params: [{ name: 'period', label: 'Period', type: 'int', default: 10, min: 1, max: 5000 }],
    outputs: [
      { key: 'main', label: 'RVI', defaultColor: 'var(--accent)', type: 'line' },
      { key: 'signal', label: 'Signal', defaultColor: '#e5484d', type: 'line' },
    ],
    compute(bars, params) {
      const r = rvi(bars, Math.max(1, Math.round(p(params, 'period', 10))));
      return { main: toPoints(bars, r.main), signal: toPoints(bars, r.signal) };
    },
  },

  {
    id: 'trix',
    label: 'TRIX',
    pane: 'oscillator',
    params: [
      { name: 'period', label: 'Period', type: 'int', default: 14, min: 1, max: 5000 },
      appliedParam(),
    ],
    outputs: [{ key: 'trix', label: 'TRIX', defaultColor: 'var(--accent)', type: 'line' }],
    compute(bars, params) {
      const series = trix(
        bars,
        Math.max(1, Math.round(p(params, 'period', 14))),
        Math.round(p(params, 'applied', APPLIED.PRICE_CLOSE)),
      );
      return { trix: toPoints(bars, series) };
    },
  },

  {
    id: 'stddev',
    label: 'Standard Deviation',
    pane: 'oscillator',
    params: [
      { name: 'period', label: 'Period', type: 'int', default: 20, min: 1, max: 5000 },
      maMethodParam(MA_METHOD.MODE_SMA),
      appliedParam(),
    ],
    outputs: [{ key: 'stddev', label: 'StdDev', defaultColor: 'var(--gold)', type: 'line' }],
    compute(bars, params) {
      const series = stddev(
        bars,
        Math.max(1, Math.round(p(params, 'period', 20))),
        Math.round(p(params, 'method', MA_METHOD.MODE_SMA)),
        Math.round(p(params, 'applied', APPLIED.PRICE_CLOSE)),
      );
      return { stddev: toPoints(bars, series) };
    },
  },

  {
    id: 'mfi',
    label: 'Money Flow Index',
    pane: 'oscillator',
    params: [
      { name: 'period', label: 'Period', type: 'int', default: 14, min: 1, max: 5000 },
      volumeParam(),
    ],
    outputs: [{ key: 'mfi', label: 'MFI', defaultColor: 'var(--accent)', type: 'line' }],
    compute(bars, params) {
      const series = mfi(
        bars,
        Math.max(1, Math.round(p(params, 'period', 14))),
        Math.round(p(params, 'useReal', 0)) === 1,
      );
      return { mfi: toPoints(bars, series) };
    },
  },

  {
    id: 'obv',
    label: 'On Balance Volume',
    pane: 'oscillator',
    params: [volumeParam()],
    outputs: [{ key: 'obv', label: 'OBV', defaultColor: 'var(--accent)', type: 'line' }],
    compute(bars, params) {
      const series = obv(bars, Math.round(p(params, 'useReal', 0)) === 1);
      return { obv: toPoints(bars, series) };
    },
  },

  {
    id: 'ad',
    label: 'Accumulation/Distribution',
    pane: 'oscillator',
    params: [volumeParam()],
    outputs: [{ key: 'ad', label: 'A/D', defaultColor: 'var(--accent)', type: 'line' }],
    compute(bars, params) {
      const series = ad(bars, Math.round(p(params, 'useReal', 0)) === 1);
      return { ad: toPoints(bars, series) };
    },
  },

  {
    id: 'ao',
    label: 'Awesome Oscillator',
    pane: 'oscillator',
    params: [],
    outputs: [{ key: 'ao', label: 'AO', defaultColor: 'var(--muted)', type: 'histogram' }],
    compute(bars, _params) {
      const series = awesome(bars);
      return { ao: toPoints(bars, series) };
    },
  },

  {
    id: 'ac',
    label: 'Accelerator Oscillator',
    pane: 'oscillator',
    params: [],
    outputs: [{ key: 'ac', label: 'AC', defaultColor: 'var(--muted)', type: 'histogram' }],
    compute(bars, _params) {
      const series = accelerator(bars);
      return { ac: toPoints(bars, series) };
    },
  },

  {
    id: 'gator',
    label: 'Gator Oscillator',
    pane: 'oscillator',
    params: [
      { name: 'jawPeriod', label: 'Jaws period', type: 'int', default: 13, min: 1, max: 1000 },
      { name: 'jawShift', label: 'Jaws shift', type: 'int', default: 8, min: 0, max: 1000 },
      { name: 'teethPeriod', label: 'Teeth period', type: 'int', default: 8, min: 1, max: 1000 },
      { name: 'teethShift', label: 'Teeth shift', type: 'int', default: 5, min: 0, max: 1000 },
      { name: 'lipsPeriod', label: 'Lips period', type: 'int', default: 5, min: 1, max: 1000 },
      { name: 'lipsShift', label: 'Lips shift', type: 'int', default: 3, min: 0, max: 1000 },
      appliedParam(APPLIED.PRICE_MEDIAN),
    ],
    outputs: [
      { key: 'upper', label: 'Upper', defaultColor: '#30a46c', type: 'histogram' },
      { key: 'lower', label: 'Lower', defaultColor: '#e5484d', type: 'histogram' },
    ],
    compute(bars, params) {
      const g = gator(
        bars,
        Math.max(1, Math.round(p(params, 'jawPeriod', 13))),
        Math.max(0, Math.round(p(params, 'jawShift', 8))),
        Math.max(1, Math.round(p(params, 'teethPeriod', 8))),
        Math.max(0, Math.round(p(params, 'teethShift', 5))),
        Math.max(1, Math.round(p(params, 'lipsPeriod', 5))),
        Math.max(0, Math.round(p(params, 'lipsShift', 3))),
        Math.round(p(params, 'applied', APPLIED.PRICE_MEDIAN)),
      );
      return { upper: toPoints(bars, g.upper), lower: toPoints(bars, g.lower) };
    },
  },

  {
    id: 'adxwilder',
    label: 'ADX Wilder',
    pane: 'oscillator',
    params: [{ name: 'period', label: 'Period', type: 'int', default: 14, min: 1, max: 5000 }],
    outputs: [
      { key: 'main', label: 'ADX', defaultColor: 'var(--gold)', type: 'line' },
      { key: 'plusDI', label: '+DI', defaultColor: '#30a46c', type: 'line' },
      { key: 'minusDI', label: '-DI', defaultColor: '#e5484d', type: 'line' },
    ],
    compute(bars, params) {
      const a = adxWilder(bars, Math.max(1, Math.round(p(params, 'period', 14))));
      return {
        main: toPoints(bars, a.main),
        plusDI: toPoints(bars, a.plusDI),
        minusDI: toPoints(bars, a.minusDI),
      };
    },
  },
];

/** Whether an indicator reads the feed's (tick/real) volume — so the host can show
 *  an honest "no volume data" note instead of an empty pane when the feed carries no
 *  volume (§29: these indicators return EMPTY series rather than fabricating volume).
 *  Covers the price-volume indicators (Volumes, VWAP) and the volume oscillators
 *  (Force, MFI, OBV, A/D). */
export function isVolumeBased(id: string): boolean {
  return (
    id === 'volume' ||
    id === 'vwap' ||
    id === 'force' ||
    id === 'mfi' ||
    id === 'obv' ||
    id === 'ad'
  );
}

/** Map an output series' VALUE to the bar that's `shift` bars away (the cosmetic
 *  Ichimoku PLOT_SHIFT). A value at chronological index i is drawn under the bar at
 *  index (i + shift); we look up THAT bar's time. Targets outside the loaded range
 *  are dropped (the forward cloud into future whitespace is left to a dedicated
 *  renderer). */
function shiftPointsByBars(bars: readonly IndiBar[], series: Series, shift: number): IndiPoint[] {
  if (shift === 0) return toPoints(bars, series);
  const out: IndiPoint[] = [];
  const n = bars.length;
  for (let i = 0; i < Math.min(n, series.length); i++) {
    const v = series[i];
    if (v === null || v === undefined || Number.isNaN(v)) continue;
    const target = i + shift;
    if (target < 0 || target >= n) continue;
    out.push({ time: bars[target]!.time, value: v });
  }
  // lightweight-charts requires strictly-ascending time; a negative shift keeps
  // order, a positive shift keeps order too (monotonic map), so no sort needed —
  // but de-dup defensively in case two source indices map to the same bar.
  return out;
}

/** Look up an indicator def by id. */
export function getIndicator(id: string): IndicatorDef | undefined {
  return INDICATORS.find((d) => d.id === id);
}

/** The colour index meaning, re-exported for a renderer that wants up/down volume
 *  bars (not used by the default single-colour histogram, but available). */
export { VOLUME_COLOR };
