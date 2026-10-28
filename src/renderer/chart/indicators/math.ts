/**
 * MT5-EXACT indicator math — pure functions over a chart bar array.
 *
 * ⚠️ FIDELITY: MetaTrader 5's indicators use SPECIFIC documented recurrences, NOT
 * the textbook formulas. Every function here is a VERBATIM port of MetaTrader's own
 * reference indicator sources, so the overlays match the platform bar-for-bar. We
 * compute over the chart's `{ time, open, high, low, close, volume? }` bar.
 *
 * Load-bearing facts preserved from the ports (do NOT "simplify"):
 *   - SMA  : first value at index period-1; recompute the window sum each bar
 *            (no running carry) exactly like SimpleMA's inner loop.
 *   - EMA  : buffer[0]=price[0] (no warm-up null); k = 2/(1+period).
 *   - SMMA : seed at period-1 = SMA of first `period`; then Wilder recursion
 *            (buffer[i] = (buffer[i-1]*(p-1)+price[i])/p).
 *   - LWMA : newest bar carries weight `period`, oldest weight 1.
 *   - RSI  : Wilder; seed at index `period` (NOT period-1); avgLoss==0 →
 *            (avgGain==0 ? 50 : 100). The flat-market value is 50, not 0/NaN.
 *   - ATR  : ⚠️ SMA of True Range, NOT Wilder. seed at index `period` =
 *            mean(TR[1..period]); recursion ATR[i]=ATR[i-1]+(TR[i]-TR[i-period])/p.
 *            TR[i]=max(high,prevClose)-min(low,prevClose); TR[0]=0.
 *   - MACD : MAIN = EMA(fast)-EMA(slow) at every bar; SIGNAL = *Simple* MA of
 *            MAIN (NOT an EMA), first value at index signalSMA-1.
 *   - Stoch: %K with slowing; %D = plain SMA of %K (maMethod arg is ignored by
 *            MetaQuotes' own Stochastic). %D non-null from index dPeriod-1.
 *   - ADX  : +DI/-DI/ADX smoothed with ExponentialMA (k=2/(period+1)), NOT
 *            Wilder; explicit 0 seeds at index 0; value at every bar from index 1.
 *   - CCI  : (price - SMA) / (0.015 * meanAbsDeviation); D==0 → CCI=0.
 *   - Mom  : price[i]*100/price[i-period]; first value at index `period`.
 *   - Bands: middle = SMA; StdDev only when i >= period (STRICT) so at i==period-1
 *            the bands collapse onto the middle; ±deviation·StdDev.
 *   - Ichi : Tenkan/Kijun/SpanA/SpanB midlines (HH+LL)/2, partial-window clamped
 *            at index 0 (value at every bar); displacement is a cosmetic shift.
 *   - VWAP : Σ(typical·vol)/Σ(vol), session-anchored; resets per session.
 *   - Vol  : the volume series + per-bar up/down colour (vol>prev ? up : down).
 *
 * Output convention: each function returns a CHRONOLOGICAL array aligned 1:1 with
 * `bars` (index i = bar i). Positions MT5 leaves empty (warm-up) are `null`, so a
 * renderer can align series by index/time and simply skip the nulls.
 */

/** The chart bar this math operates over. `volume` is OPTIONAL — the terminal's
 *  `ChartBar` carries OHLC only; a feed that supplies (tick) volume may widen it.
 *  Volume-weighted indicators (VWAP, Volume) read `volume`/`tickVolume` if present
 *  and otherwise have no value (§29 — never fabricate volume). */
export interface IndiBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Tick volume, when the feed supplies it (most FX feeds carry it as `volume`). */
  volume?: number;
  /** Alternative field name some feeds use for tick volume. */
  tickVolume?: number;
  /** Broker real (traded) volume — frequently 0/absent on FX. */
  realVolume?: number;
}

/** A chronological series aligned 1:1 with the bars; `null` at warm-up positions. */
export type Series = (number | null)[];

// ── MT5 enum ids (mirrors the transpiler's `types.ts`) ────────────────────────

/** ENUM_APPLIED_PRICE numeric ids. */
export const APPLIED = {
  PRICE_CLOSE: 1,
  PRICE_OPEN: 2,
  PRICE_HIGH: 3,
  PRICE_LOW: 4,
  PRICE_MEDIAN: 5,
  PRICE_TYPICAL: 6,
  PRICE_WEIGHTED: 7,
} as const;

/** ENUM_MA_METHOD numeric ids. */
export const MA_METHOD = {
  MODE_SMA: 0,
  MODE_EMA: 1,
  MODE_SMMA: 2,
  MODE_LWMA: 3,
} as const;

/** ENUM_STO_PRICE numeric ids. */
export const STO_PRICE = {
  STO_LOWHIGH: 0,
  STO_CLOSECLOSE: 1,
} as const;

/** ENUM_APPLIED_VOLUME numeric ids. */
export const APPLIED_VOLUME = {
  VOLUME_TICK: 0,
  VOLUME_REAL: 1,
} as const;

/**
 * Map a bar to its applied price exactly as MT5 does.
 * (MEDIAN = (H+L)/2, TYPICAL = (H+L+C)/3, WEIGHTED = (H+L+2C)/4.)
 */
export function appliedPrice(bar: IndiBar, applied: number): number {
  switch (applied) {
    case APPLIED.PRICE_CLOSE:
      return bar.close;
    case APPLIED.PRICE_OPEN:
      return bar.open;
    case APPLIED.PRICE_HIGH:
      return bar.high;
    case APPLIED.PRICE_LOW:
      return bar.low;
    case APPLIED.PRICE_MEDIAN:
      return (bar.high + bar.low) / 2.0;
    case APPLIED.PRICE_TYPICAL:
      return (bar.high + bar.low + bar.close) / 3.0;
    case APPLIED.PRICE_WEIGHTED:
      return (bar.high + bar.low + 2.0 * bar.close) / 4.0;
    default:
      throw new Error(`appliedPrice: unknown ENUM_APPLIED_PRICE id ${applied}`);
  }
}

/** Read a bar's volume honestly: prefer the explicit field, else `volume`/`tickVolume`.
 *  Returns `null` when the feed supplied no volume at all (so the caller surfaces
 *  "no value" rather than treating 0/absent volume as real — §29). */
function barVolume(bar: IndiBar, useReal: boolean): number | null {
  if (useReal) return typeof bar.realVolume === 'number' ? bar.realVolume : null;
  if (typeof bar.tickVolume === 'number') return bar.tickVolume;
  if (typeof bar.volume === 'number') return bar.volume;
  return null;
}

/** Extract the applied-price series, chronological. */
function priceSeries(bars: readonly IndiBar[], applied: number): number[] {
  const n = bars.length;
  const price = new Array<number>(n);
  for (let i = 0; i < n; i++) price[i] = appliedPrice(bars[i]!, applied);
  return price;
}

/** Apply MT5 ma_shift: value at bar i = base value at bar (i-shift). */
function applyShift(base: Series, shift: number): Series {
  if (shift === 0) return base;
  const n = base.length;
  const out: Series = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const src = i - shift;
    out[i] = src >= 0 && src < n ? base[src]! : null;
  }
  return out;
}

// ── SMA — MovingAverages.mqh `SimpleMA` ───────────────────────────────────────
/**
 * Simple Moving Average. First value at index period-1; the window sum is
 * recomputed each bar (no running carry) exactly like SimpleMA's inner loop.
 */
export function sma(
  bars: readonly IndiBar[],
  period: number,
  applied: number = APPLIED.PRICE_CLOSE,
  shift = 0,
): Series {
  const n = bars.length;
  const out: Series = new Array(n).fill(null);
  if (period <= 0 || n === 0) return out;
  const price = priceSeries(bars, applied);
  const base: Series = new Array(n).fill(null);
  for (let pos = period - 1; pos < n; pos++) {
    let sum = 0.0;
    for (let i = 0; i < period; i++) sum += price[pos - i]!;
    base[pos] = sum / period;
  }
  return applyShift(base, shift);
}

// ── EMA — MovingAverages.mqh `ExponentialMAOnBuffer` (begin=0) ────────────────
/**
 * Exponential MA. buffer[0]=price[0]; buffer[i]=price[i]*k+buffer[i-1]*(1-k),
 * k=2/(1+period). Every bar (from index 0) has a value (no warm-up null).
 */
export function ema(
  bars: readonly IndiBar[],
  period: number,
  applied: number = APPLIED.PRICE_CLOSE,
  shift = 0,
): Series {
  const n = bars.length;
  const out: Series = new Array(n).fill(null);
  if (period <= 0 || n === 0) return out;
  const price = priceSeries(bars, applied);
  const k = 2.0 / (1.0 + period);
  out[0] = price[0]!;
  for (let i = 1; i < n; i++) {
    out[i] = price[i]! * k + (out[i - 1] as number) * (1.0 - k);
  }
  return applyShift(out, shift);
}

// ── SMMA (Wilder RMA) — MovingAverages.mqh `SmoothedMAOnBuffer` (begin=0) ──────
/**
 * Smoothed MA (SMMA = Wilder's RMA). Empty for the first period-1 bars; seed at
 * index period-1 = SMA of the first `period` prices; then
 * buffer[i]=(buffer[i-1]*(period-1)+price[i])/period.
 */
export function smma(
  bars: readonly IndiBar[],
  period: number,
  applied: number = APPLIED.PRICE_CLOSE,
  shift = 0,
): Series {
  const n = bars.length;
  const out: Series = new Array(n).fill(null);
  if (period <= 0 || n === 0 || n < period) return out;
  const price = priceSeries(bars, applied);
  let sum = 0.0;
  for (let i = 0; i < period; i++) sum += price[i]!;
  out[period - 1] = sum / period;
  for (let i = period; i < n; i++) {
    out[i] = ((out[i - 1] as number) * (period - 1) + price[i]!) / period;
  }
  return applyShift(out, shift);
}

// ── LWMA — MovingAverages.mqh `LinearWeightedMAOnBuffer` (begin=0) ────────────
/**
 * Linear Weighted MA. Empty for the first period-1 bars; from index period-1 the
 * value at pos is Σ price[pos-period+1+j]*(j+1) / Σ(j+1), so the newest bar in the
 * window carries weight `period`, the oldest weight 1.
 */
export function lwma(
  bars: readonly IndiBar[],
  period: number,
  applied: number = APPLIED.PRICE_CLOSE,
  shift = 0,
): Series {
  const n = bars.length;
  const out: Series = new Array(n).fill(null);
  if (period <= 0 || n === 0 || n < period) return out;
  const price = priceSeries(bars, applied);
  let weight = 0;
  for (let l = 1; l <= period; l++) weight += l;
  for (let pos = period - 1; pos < n; pos++) {
    let sum = 0.0;
    for (let j = 0; j < period; j++) sum += price[pos - period + 1 + j]! * (j + 1);
    out[pos] = sum / weight;
  }
  return applyShift(out, shift);
}

/** Dispatch the four ENUM_MA_METHOD smoothings (iMA). */
export function ma(
  bars: readonly IndiBar[],
  period: number,
  method: number,
  applied: number = APPLIED.PRICE_CLOSE,
  shift = 0,
): Series {
  switch (method) {
    case MA_METHOD.MODE_SMA:
      return sma(bars, period, applied, shift);
    case MA_METHOD.MODE_EMA:
      return ema(bars, period, applied, shift);
    case MA_METHOD.MODE_SMMA:
      return smma(bars, period, applied, shift);
    case MA_METHOD.MODE_LWMA:
      return lwma(bars, period, applied, shift);
    default:
      throw new Error(`ma: unknown ENUM_MA_METHOD id ${method}`);
  }
}

// ── RSI — RSI ────────────────────────────────────
/** MT5's RSI value from avg gain/loss, including the avgLoss==0 branches. */
function rsiFrom(avgGain: number, avgLoss: number): number {
  if (avgLoss !== 0.0) return 100.0 - 100.0 / (1.0 + avgGain / avgLoss);
  if (avgGain !== 0.0) return 100.0;
  return 50.0; // flat market — MT5 reports 50, not 0/NaN.
}

/**
 * Relative Strength Index (Wilder). Seed at index `period` (NOT period-1) = simple
 * average of the first `period` diffs; then Wilder recursion from period+1. First
 * valid value at index `period`. Needs `n > period`.
 */
export function rsi(
  bars: readonly IndiBar[],
  period: number,
  applied: number = APPLIED.PRICE_CLOSE,
): Series {
  const n = bars.length;
  const out: Series = new Array(n).fill(null);
  if (period < 1 || n <= period) return out;
  const price = priceSeries(bars, applied);

  let sumPos = 0.0;
  let sumNeg = 0.0;
  for (let i = 1; i <= period; i++) {
    const diff = price[i]! - price[i - 1]!;
    sumPos += diff > 0 ? diff : 0;
    sumNeg += diff < 0 ? -diff : 0;
  }
  let avgGain = sumPos / period;
  let avgLoss = sumNeg / period;
  out[period] = rsiFrom(avgGain, avgLoss);

  for (let i = period + 1; i < n; i++) {
    const diff = price[i]! - price[i - 1]!;
    const up = diff > 0.0 ? diff : 0.0;
    const dn = diff < 0.0 ? -diff : 0.0;
    avgGain = (avgGain * (period - 1) + up) / period;
    avgLoss = (avgLoss * (period - 1) + dn) / period;
    out[i] = rsiFrom(avgGain, avgLoss);
  }
  return out;
}

// ── ATR — ATR (SMA of True Range, NOT Wilder) ─────
/**
 * Average True Range. ⚠️ SMA of True Range, NOT Wilder. seed at index `period` =
 * mean(TR[1..period]); then ATR[i]=ATR[i-1]+(TR[i]-TR[i-period])/period.
 * TR[i]=max(high,prevClose)-min(low,prevClose); TR[0]=0. Needs `n > period`.
 * Ignores applied price (reads OHLC).
 */
export function atr(bars: readonly IndiBar[], period: number): Series {
  const n = bars.length;
  const out: Series = new Array(n).fill(null);
  if (period <= 0 || n <= period) return out;

  const tr = new Array<number>(n);
  tr[0] = 0.0;
  for (let i = 1; i < n; i++) {
    const h = bars[i]!.high;
    const l = bars[i]!.low;
    const pc = bars[i - 1]!.close;
    tr[i] = Math.max(h, pc) - Math.min(l, pc);
  }

  let firstValue = 0.0;
  for (let i = 1; i <= period; i++) firstValue += tr[i]!;
  firstValue /= period;
  out[period] = firstValue;

  for (let i = period + 1; i < n; i++) {
    out[i] = (out[i - 1] as number) + (tr[i]! - tr[i - period]!) / period;
  }
  return out;
}

// ── MACD — MACD ──────────────────────────────────
export interface MacdBuffers {
  /** buffer 0 — MAIN = EMA(fast) - EMA(slow). */
  main: Series;
  /** buffer 1 — SIGNAL = *Simple* MA of MAIN (NOT an EMA). */
  signal: Series;
}

/** ExponentialMAOnBuffer (begin=0): full-length EMA series, value at every bar. */
function emaBuffer(price: readonly number[], period: number): number[] {
  const n = price.length;
  const out = new Array<number>(n);
  if (n === 0) return out;
  const k = 2.0 / (1.0 + period);
  out[0] = price[0]!;
  for (let i = 1; i < n; i++) out[i] = price[i]! * k + out[i - 1]! * (1.0 - k);
  return out;
}

/**
 * MACD. MAIN = EMA(fast)-EMA(slow) at every bar; SIGNAL = SimpleMAOnBuffer over
 * MAIN with period=signalSMA (first visible value at index signalSMA-1). The
 * signal is a SIMPLE MA, not an EMA. signalSMA<=1 leaves SIGNAL all-null (matches
 * SimpleMAOnBuffer's `period<=1` guard).
 */
export function macd(
  bars: readonly IndiBar[],
  fastEMA: number,
  slowEMA: number,
  signalSMA: number,
  applied: number = APPLIED.PRICE_CLOSE,
): MacdBuffers {
  const n = bars.length;
  const main: Series = new Array(n).fill(null);
  const signal: Series = new Array(n).fill(null);
  if (fastEMA <= 0 || slowEMA <= 0 || signalSMA <= 0 || n === 0)
    return { main, signal };

  const price = priceSeries(bars, applied);
  const fast = emaBuffer(price, fastEMA);
  const slow = emaBuffer(price, slowEMA);
  const macdLine = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    macdLine[i] = fast[i]! - slow[i]!;
    main[i] = macdLine[i]!;
  }

  if (signalSMA > 1 && signalSMA <= n) {
    let firstValue = 0.0;
    for (let i = 0; i < signalSMA; i++) firstValue += macdLine[i]!;
    signal[signalSMA - 1] = firstValue / signalSMA;
    for (let i = signalSMA; i < n; i++) {
      signal[i] =
        (signal[i - 1] as number) + (macdLine[i]! - macdLine[i - signalSMA]!) / signalSMA;
    }
  }
  return { main, signal };
}

// ── Stochastic — Stochastic ──────────────────────
export interface StochasticBuffers {
  /** buffer 0 — %K (MAIN). */
  main: Series;
  /** buffer 1 — %D (SIGNAL = SMA(dPeriod) of %K). */
  signal: Series;
}

/**
 * Stochastic Oscillator. %K with slowing (null before index (kPeriod-1)+(slowing-1)),
 * %D = plain SMA of %K (the maMethod arg is IGNORED — MetaQuotes' own indicator
 * always uses SMA for %D). %D non-null from index dPeriod-1 onward (reads the %K
 * buffer where warm-up cells are treated as 0, matching the source). priceField:
 * STO_LOWHIGH(0) extremes over HIGH/LOW; STO_CLOSECLOSE(1) over CLOSE. The %K
 * numerator is always CLOSE. Needs `n > kPeriod+dPeriod+slowing`.
 */
export function stochastic(
  bars: readonly IndiBar[],
  kPeriod: number,
  dPeriod: number,
  slowing: number,
  priceField: number = STO_PRICE.STO_LOWHIGH,
): StochasticBuffers {
  const n = bars.length;
  const main: Series = new Array(n).fill(null);
  const signal: Series = new Array(n).fill(null);
  if (kPeriod <= 0 || dPeriod <= 0 || slowing <= 0 || n === 0)
    return { main, signal };
  if (n <= kPeriod + dPeriod + slowing) return { main, signal };

  const high = new Array<number>(n);
  const low = new Array<number>(n);
  const close = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    high[i] = bars[i]!.high;
    low[i] = bars[i]!.low;
    close[i] = bars[i]!.close;
  }

  const lowSrc = priceField === STO_PRICE.STO_CLOSECLOSE ? close : low;
  const highSrc = priceField === STO_PRICE.STO_CLOSECLOSE ? close : high;

  const lowes = new Array<number | null>(n).fill(null);
  const highes = new Array<number | null>(n).fill(null);
  for (let i = kPeriod - 1; i < n; i++) {
    let dmin = Infinity;
    let dmax = -Infinity;
    for (let k = i - kPeriod + 1; k <= i; k++) {
      if (lowSrc[k]! < dmin) dmin = lowSrc[k]!;
      if (highSrc[k]! > dmax) dmax = highSrc[k]!;
    }
    lowes[i] = dmin;
    highes[i] = dmax;
  }

  const firstK = kPeriod - 1 + (slowing - 1);
  for (let i = firstK; i < n; i++) {
    let sumLow = 0.0;
    let sumHigh = 0.0;
    for (let k = i - slowing + 1; k <= i; k++) {
      sumLow += close[k]! - (lowes[k] as number);
      sumHigh += (highes[k] as number) - (lowes[k] as number);
    }
    main[i] = sumHigh === 0.0 ? 100.0 : (sumLow / sumHigh) * 100.0;
  }

  const firstSignal = dPeriod - 1;
  for (let i = firstSignal; i < n; i++) {
    let sum = 0.0;
    for (let k = 0; k < dPeriod; k++) {
      const v = main[i - k];
      sum += v === null ? 0.0 : v;
    }
    signal[i] = sum / dPeriod;
  }
  return { main, signal };
}

// ── ADX — ADX (ExponentialMA smoothing, NOT Wilder)
export interface AdxBuffers {
  /** buffer 0 — ADX (MAIN). */
  main: Series;
  /** buffer 1 — +DI. */
  plusDI: Series;
  /** buffer 2 — -DI. */
  minusDI: Series;
}

/**
 * Average Directional Movement Index. +DI/-DI/ADX are smoothed with ExponentialMA
 * (k=2/(period+1)), NOT Wilder's SMMA. Explicit 0 seeds at index 0; a value at
 * every bar from index 1. Needs `n >= period`. Reads OHLC (no applied price).
 */
export function adx(bars: readonly IndiBar[], period: number): AdxBuffers {
  const n = bars.length;
  const main: Series = new Array(n).fill(null);
  const plusDI: Series = new Array(n).fill(null);
  const minusDI: Series = new Array(n).fill(null);
  if (period <= 0 || n === 0 || n < period) return { main, plusDI, minusDI };

  const k = 2.0 / (period + 1.0);
  let pdiPrev = 0.0;
  let ndiPrev = 0.0;
  let adxPrev = 0.0;
  main[0] = 0.0;
  plusDI[0] = 0.0;
  minusDI[0] = 0.0;

  for (let i = 1; i < n; i++) {
    const highP = bars[i]!.high;
    const prevHigh = bars[i - 1]!.high;
    const lowP = bars[i]!.low;
    const prevLow = bars[i - 1]!.low;
    const prevClose = bars[i - 1]!.close;

    let tmpPos = highP - prevHigh;
    let tmpNeg = prevLow - lowP;
    if (tmpPos < 0.0) tmpPos = 0.0;
    if (tmpNeg < 0.0) tmpNeg = 0.0;
    if (tmpPos > tmpNeg) {
      tmpNeg = 0.0;
    } else if (tmpPos < tmpNeg) {
      tmpPos = 0.0;
    } else {
      tmpPos = 0.0;
      tmpNeg = 0.0;
    }

    const tr = Math.max(
      Math.max(Math.abs(highP - lowP), Math.abs(highP - prevClose)),
      Math.abs(lowP - prevClose),
    );
    let pd: number;
    let nd: number;
    if (tr !== 0.0) {
      pd = (100.0 * tmpPos) / tr;
      nd = (100.0 * tmpNeg) / tr;
    } else {
      pd = 0.0;
      nd = 0.0;
    }

    const pdi = pd * k + pdiPrev * (1.0 - k);
    const ndi = nd * k + ndiPrev * (1.0 - k);
    pdiPrev = pdi;
    ndiPrev = ndi;

    let dx: number;
    const denom = pdi + ndi;
    if (denom !== 0.0) {
      dx = 100.0 * Math.abs((pdi - ndi) / denom);
    } else {
      dx = 0.0;
    }

    const adxVal = dx * k + adxPrev * (1.0 - k);
    adxPrev = adxVal;

    plusDI[i] = pdi;
    minusDI[i] = ndi;
    main[i] = adxVal;
  }
  return { main, plusDI, minusDI };
}

// ── CCI — CCI ────────────────────────────────────
/**
 * Commodity Channel Index = (price - SMA) / (0.015 * meanAbsDeviation). The
 * `/0.015` is folded into the multiplyer; a flat window (D==0) → CCI=0 (not NaN).
 * First value at index period-1. Default applied price is PRICE_TYPICAL (iCCI).
 */
export function cci(
  bars: readonly IndiBar[],
  period: number,
  applied: number = APPLIED.PRICE_TYPICAL,
): Series {
  const n = bars.length;
  const out: Series = new Array(n).fill(null);
  if (period <= 0 || n === 0 || n < period) return out;
  const price = priceSeries(bars, applied);
  const multiplyer = 0.015 / period;

  for (let i = period - 1; i < n; i++) {
    let sum = 0.0;
    for (let j = 0; j < period; j++) sum += price[i - j]!;
    const sp = sum / period;
    let tmpD = 0.0;
    for (let j = 0; j < period; j++) tmpD += Math.abs(price[i - j]! - sp);
    const d = tmpD * multiplyer;
    const m = price[i]! - sp;
    out[i] = d !== 0.0 ? m / d : 0.0;
  }
  return out;
}

// ── Momentum — Momentum ──────────────────────────
/**
 * Momentum = price[i]*100/price[i-period]. First written index is `period` (the
 * computation loop starts at `period`, NOT period-1 — it would need price[-1]).
 */
export function momentum(
  bars: readonly IndiBar[],
  period: number,
  applied: number = APPLIED.PRICE_CLOSE,
): Series {
  const n = bars.length;
  const out: Series = new Array(n).fill(null);
  if (period <= 0 || n === 0) return out;
  const price = priceSeries(bars, applied);
  for (let i = period; i < n; i++) out[i] = (price[i]! * 100.0) / price[i - period]!;
  return out;
}

// ── Bollinger Bands — BB ─────────────────────────
export interface BandsBuffers {
  /** buffer 0 — middle (SMA). */
  middle: Series;
  /** buffer 1 — upper = middle + deviation·StdDev. */
  upper: Series;
  /** buffer 2 — lower = middle - deviation·StdDev. */
  lower: Series;
}

/**
 * Bollinger Bands. Middle = SimpleMA; StdDev is computed only when i >= period
 * (STRICT — note `>= period`, not `>= period-1`), so at the first bar the middle
 * exists (i==period-1) the bands COLLAPSE onto the middle (StdDev=0). upper/lower
 * = middle ± deviation·StdDev. Default applied price PRICE_CLOSE (iBands).
 */
export function bollinger(
  bars: readonly IndiBar[],
  period: number,
  deviation: number,
  applied: number = APPLIED.PRICE_CLOSE,
  shift = 0,
): BandsBuffers {
  const n = bars.length;
  const middle: Series = new Array(n).fill(null);
  const upper: Series = new Array(n).fill(null);
  const lower: Series = new Array(n).fill(null);
  if (period <= 0 || n === 0) return { middle, upper, lower };
  const price = priceSeries(bars, applied);

  for (let i = period - 1; i < n; i++) {
    let sum = 0.0;
    for (let j = 0; j < period; j++) sum += price[i - j]!;
    const ml = sum / period;
    middle[i] = ml;

    let stdDev = 0.0;
    if (i >= period) {
      let acc = 0.0;
      for (let j = 0; j < period; j++) {
        const d = price[i - j]! - ml;
        acc += d * d;
      }
      stdDev = Math.sqrt(acc / period);
    }
    upper[i] = ml + deviation * stdDev;
    lower[i] = ml - deviation * stdDev;
  }
  return {
    middle: applyShift(middle, shift),
    upper: applyShift(upper, shift),
    lower: applyShift(lower, shift),
  };
}

// ── Ichimoku — Ichimoku ──────────────────────────
export interface IchimokuBuffers {
  /** buffer 0 — Tenkan-sen (Conversion line). */
  tenkan: Series;
  /** buffer 1 — Kijun-sen (Base line). */
  kijun: Series;
  /** buffer 2 — Senkou Span A (Leading Span A). Displayed shifted +kijun. */
  senkouA: Series;
  /** buffer 3 — Senkou Span B (Leading Span B). Displayed shifted +kijun. */
  senkouB: Series;
  /** buffer 4 — Chikou Span (Lagging Span = close). Displayed shifted -kijun. */
  chikou: Series;
  /** PLOT_SHIFT for each line, in bars (+forward / -backward). */
  shift: {
    tenkan: 0;
    kijun: 0;
    senkouA: number; // = +kijunPeriod
    senkouB: number; // = +kijunPeriod
    chikou: number; // = -kijunPeriod
  };
}

/** Max HIGH over the window ending at bar i, CLAMPED at index 0 (partial-window
 *  value at every bar; never empty — mirrors MT5's `Highest`). */
function highestHigh(bars: readonly IndiBar[], period: number): number[] {
  const n = bars.length;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let hh = -Infinity;
    for (let k = i; k > i - period && k >= 0; k--) {
      const h = bars[k]!.high;
      if (h > hh) hh = h;
    }
    out[i] = hh;
  }
  return out;
}

/** Min LOW over the window ending at bar i, CLAMPED at index 0 (see highestHigh). */
function lowestLow(bars: readonly IndiBar[], period: number): number[] {
  const n = bars.length;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let ll = Infinity;
    for (let k = i; k > i - period && k >= 0; k--) {
      const l = bars[k]!.low;
      if (l < ll) ll = l;
    }
    out[i] = ll;
  }
  return out;
}

function midline(hh: number[], ll: number[]): Series {
  const n = hh.length;
  const out: Series = new Array(n);
  for (let i = 0; i < n; i++) out[i] = (hh[i]! + ll[i]!) / 2.0;
  return out;
}

/**
 * Ichimoku Kinko Hyo. Tenkan/Kijun/SpanA/SpanB are midlines (HH+LL)/2 with the
 * extremes partial-window-clamped at index 0 (a value at EVERY bar); Span A =
 * (Tenkan+Kijun)/2; Chikou = close. The forward/backward displacement is a
 * COSMETIC PLOT_SHIFT (+kijun for the spans, -kijun for Chikou) — the buffers
 * store the value at the computation bar, exactly as CopyBuffer returns it; use
 * `displaced(...)` to build the as-plotted view.
 */
export function ichimoku(
  bars: readonly IndiBar[],
  tenkanPeriod = 9,
  kijunPeriod = 26,
  senkouBPeriod = 52,
): IchimokuBuffers {
  const n = bars.length;
  const empty = (): Series => new Array(n).fill(null);
  const shift = {
    tenkan: 0 as const,
    kijun: 0 as const,
    senkouA: kijunPeriod,
    senkouB: kijunPeriod,
    chikou: -kijunPeriod,
  };
  if (tenkanPeriod <= 0 || kijunPeriod <= 0 || senkouBPeriod <= 0 || n === 0) {
    return {
      tenkan: empty(),
      kijun: empty(),
      senkouA: empty(),
      senkouB: empty(),
      chikou: empty(),
      shift,
    };
  }

  const tenkan = midline(
    highestHigh(bars, tenkanPeriod),
    lowestLow(bars, tenkanPeriod),
  );
  const kijun = midline(highestHigh(bars, kijunPeriod), lowestLow(bars, kijunPeriod));
  const senkouA: Series = new Array(n);
  for (let i = 0; i < n; i++) senkouA[i] = (tenkan[i]! + kijun[i]!) / 2.0;
  const senkouB = midline(
    highestHigh(bars, senkouBPeriod),
    lowestLow(bars, senkouBPeriod),
  );
  const chikou: Series = empty();
  for (let i = 0; i < n; i++) chikou[i] = bars[i]!.close;

  return { tenkan, kijun, senkouA, senkouB, chikou, shift };
}

/**
 * Build the DISPLACED (as-plotted) view of a buffer: the value plotted AT bar i is
 * the computed value at bar (i - shift). A positive shift pushes the line forward
 * in time (the cloud, +kijun); a negative shift pulls it back (Chikou, -kijun).
 * Positions that map outside [0, n) are null. (The raw buffer is the un-displaced
 * series — what CopyBuffer returns — so a renderer applies this to position the
 * cloud / lagging span.)
 */
export function displaced(buffer: Series, shift: number): Series {
  const n = buffer.length;
  const out: Series = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const src = i - shift;
    out[i] = src >= 0 && src < n ? buffer[src]! : null;
  }
  return out;
}

// ── VWAP — session-anchored, volume-weighted typical price ────────────────────
/** Which volume series weighted the average — for truthful plot labelling. */
export type VwapVolumeKind = 'tick' | 'real' | 'none';

export interface VwapResult {
  /** Session-anchored VWAP, chronological, 1:1 with `bars` (null = no value). */
  vwap: Series;
  /** Honest label for which volume weighted the average ('none' = no volume in the
   *  feed → VWAP could not be computed; surfaced rather than fabricated, §29). */
  volumeKind: VwapVolumeKind;
  /** Chronological indices where a new session began (for session separators). */
  sessionStarts: number[];
}

export interface VwapOptions {
  /** Decide whether bar `i` starts a new session (default: UTC-day boundary). */
  isSessionStart?: (bar: IndiBar, prev: IndiBar | undefined, index: number) => boolean;
  /** Weight by broker REAL (traded) volume instead of tick volume. Default false. */
  useRealVolume?: boolean;
}

/** Default session anchor: a new session begins on a later UTC calendar day. */
export function utcDayBoundary(
  bar: IndiBar,
  prev: IndiBar | undefined,
  _index: number,
): boolean {
  if (prev === undefined) return true;
  const dayOf = (t: number): number => Math.floor(t / 86400);
  return dayOf(bar.time) !== dayOf(prev.time);
}

/**
 * Session-anchored VWAP: VWAP[i] = Σ(typical·vol)/Σ(vol) over the current session
 * up to bar i (typical = (H+L+C)/3). The accumulator resets at each session
 * boundary. Weights by TICK volume by default (the only universally-available
 * volume — the result is a tick-volume VWAP, labelled as such via `volumeKind`;
 * NOT presented as real-traded-volume VWAP). A session with 0 cumulative volume
 * (or a feed with no volume) has NO value at that bar (`null`) — §29, never invent
 * a price.
 */
export function vwap(bars: readonly IndiBar[], opts: VwapOptions = {}): VwapResult {
  const n = bars.length;
  const out: Series = new Array(n).fill(null);
  const useReal = opts.useRealVolume === true;
  const sessionStarts: number[] = [];
  const isSessionStart = opts.isSessionStart ?? utcDayBoundary;
  // Detect up front whether the feed supplies ANY usable volume, so the honest
  // `volumeKind` is 'none' when it doesn't (rather than silently all-null).
  let sawVolume = false;
  for (let i = 0; i < n; i++) {
    if (barVolume(bars[i]!, useReal) !== null) {
      sawVolume = true;
      break;
    }
  }
  const volumeKind: VwapVolumeKind = !sawVolume ? 'none' : useReal ? 'real' : 'tick';
  if (n === 0 || !sawVolume) return { vwap: out, volumeKind, sessionStarts };

  let cumPV = 0.0;
  let cumVol = 0.0;
  for (let i = 0; i < n; i++) {
    const bar = bars[i]!;
    const prev = i > 0 ? bars[i - 1]! : undefined;
    if (isSessionStart(bar, prev, i)) {
      cumPV = 0.0;
      cumVol = 0.0;
      sessionStarts.push(i);
    }
    const tp = appliedPrice(bar, APPLIED.PRICE_TYPICAL);
    const vol = barVolume(bar, useReal) ?? 0;
    cumPV += tp * vol;
    cumVol += vol;
    out[i] = cumVol > 0 ? cumPV / cumVol : null;
  }
  return { vwap: out, volumeKind, sessionStarts };
}

// ── Volumes — Volumes ────────────────────────────
export type VolumeKind = 'tick' | 'real' | 'none';

/** Color index for the Volumes histogram (matches the source buffer 1). */
export const VOLUME_COLOR = {
  UP: 0, // volume[i] > volume[i-1]
  DOWN: 1, // volume[i] <= volume[i-1]
} as const;

export interface VolumeResult {
  /** buffer 0 — the volume series (chronological; `null` where the feed has none). */
  volume: Series;
  /** buffer 1 — per-bar colour index: 0 = up, 1 = down. First bar = UP. */
  color: number[];
  /** Honest label for which volume series was drawn. */
  volumeKind: VolumeKind;
  /** Optional Simple MA of the volume series (null when no MA requested). */
  ma: Series | null;
}

export interface VolumeOptions {
  /** ENUM_APPLIED_VOLUME — VOLUME_TICK(0, default) | VOLUME_REAL(1). */
  appliedVolume?: number;
  /** Period for an optional Simple MA of the volume series (0 = none). */
  maPeriod?: number;
}

/**
 * Volumes. buffer[i]=volume[i]; color[i]=(volume[i]>volume[i-1]) ? UP : DOWN; the
 * first bar is UP by convention. Default series is TICK volume (labelled via
 * `volumeKind`; NOT passed off as real traded volume — §29). A bar with no volume
 * in the feed is `null` in `volume` (not coerced to 0). Optional Simple MA of the
 * volume series (same SimpleMA recurrence; first value at maPeriod-1).
 */
export function volume(bars: readonly IndiBar[], opts: VolumeOptions = {}): VolumeResult {
  const n = bars.length;
  const useReal = opts.appliedVolume === APPLIED_VOLUME.VOLUME_REAL;
  const vol: Series = new Array(n).fill(null);
  const color = new Array<number>(n);
  let sawVolume = false;

  for (let i = 0; i < n; i++) {
    const v = barVolume(bars[i]!, useReal);
    if (v !== null) sawVolume = true;
    vol[i] = v;
    if (i === 0) {
      color[i] = VOLUME_COLOR.UP;
    } else {
      const cur = v ?? 0;
      const prev = (vol[i - 1] as number | null) ?? 0;
      color[i] = cur > prev ? VOLUME_COLOR.UP : VOLUME_COLOR.DOWN;
    }
  }
  const volumeKind: VolumeKind = !sawVolume ? 'none' : useReal ? 'real' : 'tick';

  let ma: Series | null = null;
  const maPeriod = opts.maPeriod ?? 0;
  if (maPeriod > 0 && n > 0 && sawVolume) {
    const out: Series = new Array(n).fill(null);
    for (let pos = maPeriod - 1; pos < n; pos++) {
      let sum = 0.0;
      let ok = true;
      for (let j = 0; j < maPeriod; j++) {
        const vv = vol[pos - j];
        if (vv === null) {
          ok = false;
          break;
        }
        sum += vv;
      }
      out[pos] = ok ? sum / maPeriod : null;
    }
    ma = out;
  }
  return { volume: vol, color, volumeKind, ma };
}

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Additional MT5 indicators (iDeMarker … iFractals)                        ║
// ║                                                                            ║
// ║  Each is a VERBATIM port of MetaQuotes' documented recurrence (the help    ║
// ║  pages + the stock `*` sources), composed     ║
// ║  from the SAME primitives above so the smoothing math stays identical to   ║
// ║  iMA/iATR/iMACD. Output convention is unchanged: a CHRONOLOGICAL `Series`   ║
// ║  aligned 1:1 with `bars`, `null` at the warm-up positions MT5 leaves empty.║
// ╚══════════════════════════════════════════════════════════════════════════╝

// ── small array-of-number smoothings (operate on a raw number[] buffer) ───────
// These mirror the bar-based sma/ema/smma above but take a pre-computed value
// buffer (e.g. the DeMax series, the RVI numerator, the median price). They share
// the EXACT recurrences (SimpleMA / ExponentialMAOnBuffer / SmoothedMAOnBuffer),
// just over a number[] instead of re-reading bars.

/** SimpleMA over a value buffer: first value at index period-1, recompute the
 *  window sum each bar (MovingAverages.mqh `SimpleMA`). */
function smaBuf(src: readonly number[], period: number): Series {
  const n = src.length;
  const out: Series = new Array(n).fill(null);
  if (period <= 0 || n < period) return out;
  for (let pos = period - 1; pos < n; pos++) {
    let sum = 0.0;
    for (let i = 0; i < period; i++) sum += src[pos - i]!;
    out[pos] = sum / period;
  }
  return out;
}

/** SmoothedMA (Wilder RMA) over a value buffer: empty for the first period-1,
 *  seed at period-1 = SMA of the first `period`, then Wilder recursion. */
function smmaBuf(src: readonly number[], period: number): Series {
  const n = src.length;
  const out: Series = new Array(n).fill(null);
  if (period <= 0 || n < period) return out;
  let sum = 0.0;
  for (let i = 0; i < period; i++) sum += src[i]!;
  out[period - 1] = sum / period;
  for (let i = period; i < n; i++) {
    out[i] = ((out[i - 1] as number) * (period - 1) + src[i]!) / period;
  }
  return out;
}

/** LinearWeightedMA over a value buffer (newest weight=period, oldest=1). */
function lwmaBuf(src: readonly number[], period: number): Series {
  const n = src.length;
  const out: Series = new Array(n).fill(null);
  if (period <= 0 || n < period) return out;
  let weight = 0;
  for (let l = 1; l <= period; l++) weight += l;
  for (let pos = period - 1; pos < n; pos++) {
    let sum = 0.0;
    for (let j = 0; j < period; j++) sum += src[pos - period + 1 + j]! * (j + 1);
    out[pos] = sum / weight;
  }
  return out;
}

/** Dispatch the four ENUM_MA_METHOD smoothings over a raw value buffer. */
function maBuf(src: readonly number[], period: number, method: number): Series {
  switch (method) {
    case MA_METHOD.MODE_SMA:
      return smaBuf(src, period);
    case MA_METHOD.MODE_EMA:
      return emaBufSeries(src, period);
    case MA_METHOD.MODE_SMMA:
      return smmaBuf(src, period);
    case MA_METHOD.MODE_LWMA:
      return lwmaBuf(src, period);
    default:
      throw new Error(`maBuf: unknown ENUM_MA_METHOD id ${method}`);
  }
}

/** ExponentialMAOnBuffer over a value buffer, returned as a Series (out[0]=src[0],
 *  a value at every bar). Wraps the bare-array `emaBuffer` above. */
function emaBufSeries(src: readonly number[], period: number): Series {
  const n = src.length;
  const out: Series = new Array(n).fill(null);
  if (period <= 0 || n === 0) return out;
  const buf = emaBuffer(src, period);
  for (let i = 0; i < n; i++) out[i] = buf[i]!;
  return out;
}

// ── median / typical price buffers (shared by AO/AC/Alligator/Gator) ──────────
/** Median price (H+L)/2 at every bar. */
function medianBuf(bars: readonly IndiBar[]): number[] {
  const n = bars.length;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = (bars[i]!.high + bars[i]!.low) / 2.0;
  return out;
}

// ── DeMarker — iDeMarker / DeMarker ──────────────────────────────────
/**
 * DeMarker. DeMax(i) = high(i)>high(i-1) ? high(i)-high(i-1) : 0; DeMin(i) =
 * low(i)<low(i-1) ? low(i-1)-low(i) : 0 (both 0 at bar 0). DeMarker =
 * SMA(DeMax,period) / (SMA(DeMax,period) + SMA(DeMin,period)); when the
 * denominator is 0 (a perfectly flat window) MT5 yields 0. The SMA seeds the
 * window at index period (DeMax/DeMin start at index 1), so the first value is at
 * index `period`. Bounded [0,1].
 */
export function demarker(bars: readonly IndiBar[], period: number): Series {
  const n = bars.length;
  const out: Series = new Array(n).fill(null);
  if (period <= 0 || n === 0) return out;
  const deMax = new Array<number>(n);
  const deMin = new Array<number>(n);
  deMax[0] = 0.0;
  deMin[0] = 0.0;
  for (let i = 1; i < n; i++) {
    const dh = bars[i]!.high - bars[i - 1]!.high;
    const dl = bars[i - 1]!.low - bars[i]!.low;
    deMax[i] = dh > 0 ? dh : 0.0;
    deMin[i] = dl > 0 ? dl : 0.0;
  }
  // SimpleMA of DeMax/DeMin; the meaningful window first closes at index `period`
  // (DeMax[1..period]). out[period-1] would average DeMax[0..period-1] incl. the
  // 0-seed at index 0 — MetaQuotes' iDeMarker leaves that first cell unplotted
  // (PLOT_DRAW_BEGIN=period), so we start at `period`.
  for (let i = period; i < n; i++) {
    let sMax = 0.0;
    let sMin = 0.0;
    for (let j = 0; j < period; j++) {
      sMax += deMax[i - j]!;
      sMin += deMin[i - j]!;
    }
    const denom = sMax + sMin;
    out[i] = denom !== 0.0 ? sMax / denom : 0.0;
  }
  return out;
}

// ── Williams %R — iWPR / WPR ─────────────────────────────────────────
/**
 * Williams' Percent Range. %R = (MaxHigh(period) - close) / (MaxHigh(period) -
 * MinLow(period)) * (-100), where MaxHigh/MinLow are the highest HIGH / lowest LOW
 * over the last `period` bars (inclusive). First value at index period-1; a flat
 * range (MaxHigh==MinLow) yields 0 (MetaQuotes guards the zero divisor). Bounded
 * [-100, 0].
 */
export function williamsR(bars: readonly IndiBar[], period: number): Series {
  const n = bars.length;
  const out: Series = new Array(n).fill(null);
  if (period <= 0 || n < period) return out;
  for (let i = period - 1; i < n; i++) {
    let hh = -Infinity;
    let ll = Infinity;
    for (let k = i - period + 1; k <= i; k++) {
      if (bars[k]!.high > hh) hh = bars[k]!.high;
      if (bars[k]!.low < ll) ll = bars[k]!.low;
    }
    const range = hh - ll;
    out[i] = range !== 0.0 ? ((hh - bars[i]!.close) / range) * -100.0 : 0.0;
  }
  return out;
}

// ── Bears / Bulls Power — iBearsPower / iBullsPower ───────────────────────────
/** Bears Power = low - EMA(close, period). Value at every bar (EMA seeds at 0). */
export function bearsPower(bars: readonly IndiBar[], period: number): Series {
  const n = bars.length;
  const out: Series = new Array(n).fill(null);
  if (period <= 0 || n === 0) return out;
  const e = ema(bars, period, APPLIED.PRICE_CLOSE);
  for (let i = 0; i < n; i++) {
    const ev = e[i];
    if (ev !== null && ev !== undefined) out[i] = bars[i]!.low - ev;
  }
  return out;
}

/** Bulls Power = high - EMA(close, period). Value at every bar. */
export function bullsPower(bars: readonly IndiBar[], period: number): Series {
  const n = bars.length;
  const out: Series = new Array(n).fill(null);
  if (period <= 0 || n === 0) return out;
  const e = ema(bars, period, APPLIED.PRICE_CLOSE);
  for (let i = 0; i < n; i++) {
    const ev = e[i];
    if (ev !== null && ev !== undefined) out[i] = bars[i]!.high - ev;
  }
  return out;
}

// ── OsMA — iOsMA (Moving Average of Oscillator) ───────────────────────────────
/**
 * OsMA = MACD main (EMA(fast)-EMA(slow)) − MACD signal (SimpleMA of main). Defined
 * only where BOTH MACD buffers have a value (i.e. from signalSMA-1). Default
 * 12/26/9 over PRICE_CLOSE. (Identical decomposition to MetaQuotes' OsMA, which
 * plots ExtMacdBuffer-ExtSignalBuffer.)
 */
export function osma(
  bars: readonly IndiBar[],
  fastEMA: number,
  slowEMA: number,
  signalSMA: number,
  applied: number = APPLIED.PRICE_CLOSE,
): Series {
  const n = bars.length;
  const out: Series = new Array(n).fill(null);
  const m = macd(bars, fastEMA, slowEMA, signalSMA, applied);
  for (let i = 0; i < n; i++) {
    const a = m.main[i];
    const s = m.signal[i];
    if (a !== null && a !== undefined && s !== null && s !== undefined) out[i] = a - s;
  }
  return out;
}

// ── RVI — iRVI / RVI ─────────────────────────────────────────────────
export interface RviBuffers {
  /** buffer 0 — MAIN_LINE. */
  main: Series;
  /** buffer 1 — SIGNAL_LINE (4-period 1,2,2,1 SWMA of main). */
  signal: Series;
}

/**
 * Relative Vigor Index. Per-bar the 4-tap symmetric numerator/denominator are
 *   value(i) = ((c-o) + 2(c1-o1) + 2(c2-o2) + (c3-o3)) / 6
 *   range(i) = ((h-l) + 2(h1-l1) + 2(h2-l2) + (h3-l3)) / 6
 * (subscript k = i-k; needs i>=3). MAIN = Σ value over `period` / Σ range over
 * `period` (the `/6` cancels, but kept for clarity); first MAIN at index period+2.
 * SIGNAL = (MAIN + 2·MAIN1 + 2·MAIN2 + MAIN3)/6; first SIGNAL three bars later.
 * Default ma_period = 10 (CiRVI). A 0 range-sum window yields MAIN 0.
 */
export function rvi(bars: readonly IndiBar[], period: number): RviBuffers {
  const n = bars.length;
  const main: Series = new Array(n).fill(null);
  const signal: Series = new Array(n).fill(null);
  if (period <= 0 || n < 4) return { main, signal };

  // Per-bar 4-tap SWMA of (close-open) and (high-low); defined from index 3.
  const value = new Array<number | null>(n).fill(null);
  const range = new Array<number | null>(n).fill(null);
  for (let i = 3; i < n; i++) {
    const co = (k: number) => bars[k]!.close - bars[k]!.open;
    const hl = (k: number) => bars[k]!.high - bars[k]!.low;
    value[i] = (co(i) + 2 * co(i - 1) + 2 * co(i - 2) + co(i - 3)) / 6.0;
    range[i] = (hl(i) + 2 * hl(i - 1) + 2 * hl(i - 2) + hl(i - 3)) / 6.0;
  }

  // MAIN = moving SUM(value,period)/SUM(range,period); window must be fully inside
  // the defined region (value/range start at index 3) → first MAIN at index period+2.
  const firstMain = period - 1 + 3;
  for (let i = firstMain; i < n; i++) {
    let sv = 0.0;
    let sr = 0.0;
    for (let j = 0; j < period; j++) {
      sv += value[i - j] as number;
      sr += range[i - j] as number;
    }
    main[i] = sr !== 0.0 ? sv / sr : 0.0;
  }

  // SIGNAL = 4-tap symmetric SWMA of MAIN; needs main[i..i-3] all present.
  for (let i = firstMain + 3; i < n; i++) {
    const m0 = main[i] as number;
    const m1 = main[i - 1] as number;
    const m2 = main[i - 2] as number;
    const m3 = main[i - 3] as number;
    signal[i] = (m0 + 2 * m1 + 2 * m2 + m3) / 6.0;
  }
  return { main, signal };
}

// ── TRIX — iTriX / TRIX ──────────────────────────────────────────────
/**
 * Triple Exponential Average. EMA1 = EMA(close,period); EMA2 = EMA(EMA1,period);
 * EMA3 = EMA(EMA2,period); TRIX(i) = (EMA3(i)-EMA3(i-1))/EMA3(i-1). MetaQuotes'
 * TRIX plots the raw 1-bar rate-of-change of EMA3 (NOT ×100). First value at
 * index 1 (each EMA seeds from index 0); EMA3(i-1)==0 yields 0. Default period 14.
 */
export function trix(
  bars: readonly IndiBar[],
  period: number,
  applied: number = APPLIED.PRICE_CLOSE,
): Series {
  const n = bars.length;
  const out: Series = new Array(n).fill(null);
  if (period <= 0 || n === 0) return out;
  const price = priceSeries(bars, applied);
  const e1 = emaBuffer(price, period);
  const e2 = emaBuffer(e1, period);
  const e3 = emaBuffer(e2, period);
  for (let i = 1; i < n; i++) {
    const prev = e3[i - 1]!;
    out[i] = prev !== 0.0 ? (e3[i]! - prev) / prev : 0.0;
  }
  return out;
}

// ── Standard Deviation — iStdDev / StdDev ────────────────────────────
/**
 * Standard Deviation. StdDev(i) = sqrt( Σ (price[i-j] - MA[i])² / period ), where
 * MA[i] is iMA(price, period, ma_method) at the same bar (the deviation is around
 * the indicator's OWN MA, not a separate mean). POPULATION StdDev (÷period). First
 * value at index period-1 (where the MA first exists). Default period 20, SMA,
 * PRICE_CLOSE.
 */
export function stddev(
  bars: readonly IndiBar[],
  period: number,
  method: number = MA_METHOD.MODE_SMA,
  applied: number = APPLIED.PRICE_CLOSE,
): Series {
  const n = bars.length;
  const out: Series = new Array(n).fill(null);
  if (period <= 0 || n < period) return out;
  const price = priceSeries(bars, applied);
  const maLine = ma(bars, period, method, applied);
  for (let i = period - 1; i < n; i++) {
    const m = maLine[i];
    if (m === null || m === undefined) continue;
    let acc = 0.0;
    for (let j = 0; j < period; j++) {
      const d = price[i - j]! - m;
      acc += d * d;
    }
    out[i] = Math.sqrt(acc / period);
  }
  return out;
}

// ── Force Index — iForce / Force (volume) ────────────────────────────
/**
 * Force Index = volume(i) · (MA(close,period,method)(i) − MA(close,period,method)(i-1)).
 * Default period 13, MODE_SMA, VOLUME_TICK. Reads tick (or real) volume — on a
 * feed with NO volume the whole series is `null` (§29, never fabricate). First
 * value at index `period` (the MA needs index period-1, and we take its 1-bar
 * difference).
 */
export function force(
  bars: readonly IndiBar[],
  period: number,
  method: number = MA_METHOD.MODE_SMA,
  useRealVolume = false,
): Series {
  const n = bars.length;
  const out: Series = new Array(n).fill(null);
  if (period <= 0 || n === 0) return out;
  // No volume in the feed → no value anywhere.
  let sawVolume = false;
  for (let i = 0; i < n; i++) {
    if (barVolume(bars[i]!, useRealVolume) !== null) { sawVolume = true; break; }
  }
  if (!sawVolume) return out;
  const maLine = ma(bars, period, method, APPLIED.PRICE_CLOSE);
  for (let i = 1; i < n; i++) {
    const cur = maLine[i];
    const prev = maLine[i - 1];
    if (cur === null || cur === undefined || prev === null || prev === undefined) continue;
    const vol = barVolume(bars[i]!, useRealVolume) ?? 0;
    out[i] = vol * (cur - prev);
  }
  return out;
}

// ── Money Flow Index — iMFI / MFI (volume) ───────────────────────────
/**
 * Money Flow Index. typical(i) = (H+L+C)/3; moneyFlow(i) = typical(i)·volume(i).
 * Over the last `period` bars, sum positive flows (where typical rose vs prev) and
 * negative flows (where it fell); MFI = 100 − 100/(1 + posSum/negSum). Equal-
 * typical bars contribute to NEITHER sum (MetaQuotes' rule). negSum==0 with
 * posSum>0 → 100; both 0 → 100 (degenerate, matches the +∞ ratio guard). First
 * value at index `period` (flows need a prior bar; the window closes at `period`).
 * No volume → all `null` (§29). Default period 14, VOLUME_TICK. Bounded [0,100].
 */
export function mfi(
  bars: readonly IndiBar[],
  period: number,
  useRealVolume = false,
): Series {
  const n = bars.length;
  const out: Series = new Array(n).fill(null);
  if (period <= 0 || n === 0) return out;
  let sawVolume = false;
  for (let i = 0; i < n; i++) {
    if (barVolume(bars[i]!, useRealVolume) !== null) { sawVolume = true; break; }
  }
  if (!sawVolume) return out;

  const typical = new Array<number>(n);
  const flow = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    typical[i] = (bars[i]!.high + bars[i]!.low + bars[i]!.close) / 3.0;
    flow[i] = typical[i]! * (barVolume(bars[i]!, useRealVolume) ?? 0);
  }
  // Window [i-period+1 .. i]; each bar's flow is signed by typical vs the bar
  // BEFORE it, so the window's leftmost bar needs index i-period (≥0) → first
  // value at index `period`.
  for (let i = period; i < n; i++) {
    let pos = 0.0;
    let neg = 0.0;
    for (let k = i - period + 1; k <= i; k++) {
      if (typical[k]! > typical[k - 1]!) pos += flow[k]!;
      else if (typical[k]! < typical[k - 1]!) neg += flow[k]!;
    }
    if (neg !== 0.0) out[i] = 100.0 - 100.0 / (1.0 + pos / neg);
    else out[i] = 100.0; // posSum/0 → MFI saturates at 100 (incl. both-zero).
  }
  return out;
}

// ── On Balance Volume — iOBV / OBV (volume) ──────────────────────────
/**
 * On Balance Volume. OBV(0) = volume(0); OBV(i) = OBV(i-1) + (close(i)>close(i-1) ?
 * +vol(i) : close(i)<close(i-1) ? −vol(i) : 0). A running cumulative sum, value at
 * every bar. No volume in the feed → all `null` (§29). Default VOLUME_TICK.
 */
export function obv(bars: readonly IndiBar[], useRealVolume = false): Series {
  const n = bars.length;
  const out: Series = new Array(n).fill(null);
  if (n === 0) return out;
  let sawVolume = false;
  for (let i = 0; i < n; i++) {
    if (barVolume(bars[i]!, useRealVolume) !== null) { sawVolume = true; break; }
  }
  if (!sawVolume) return out;
  let run = barVolume(bars[0]!, useRealVolume) ?? 0;
  out[0] = run;
  for (let i = 1; i < n; i++) {
    const vol = barVolume(bars[i]!, useRealVolume) ?? 0;
    const c = bars[i]!.close;
    const pc = bars[i - 1]!.close;
    if (c > pc) run += vol;
    else if (c < pc) run -= vol;
    out[i] = run;
  }
  return out;
}

// ── Accumulation/Distribution — iAD / AD (volume) ────────────────────
/**
 * Accumulation/Distribution. CLV(i) = ((close-low) − (high-close)) / (high-low)
 * (0 when high==low); AD(0) = CLV(0)·vol(0); AD(i) = AD(i-1) + CLV(i)·vol(i). A
 * running cumulative line, value at every bar. No volume → all `null` (§29).
 * Default VOLUME_TICK.
 */
export function ad(bars: readonly IndiBar[], useRealVolume = false): Series {
  const n = bars.length;
  const out: Series = new Array(n).fill(null);
  if (n === 0) return out;
  let sawVolume = false;
  for (let i = 0; i < n; i++) {
    if (barVolume(bars[i]!, useRealVolume) !== null) { sawVolume = true; break; }
  }
  if (!sawVolume) return out;
  const clv = (b: IndiBar): number => {
    const range = b.high - b.low;
    return range !== 0.0 ? ((b.close - b.low) - (b.high - b.close)) / range : 0.0;
  };
  let run = clv(bars[0]!) * (barVolume(bars[0]!, useRealVolume) ?? 0);
  out[0] = run;
  for (let i = 1; i < n; i++) {
    run += clv(bars[i]!) * (barVolume(bars[i]!, useRealVolume) ?? 0);
    out[i] = run;
  }
  return out;
}

// ── Awesome Oscillator — iAO / AO ────────────────────────────────────
/**
 * Awesome Oscillator = SMA(median, 5) − SMA(median, 34), median=(H+L)/2. Fixed
 * periods (no params). First value at index 33 (the 34-SMA's warm-up). Returns the
 * difference series; the per-bar up/down colour (AO>prev ? up : down) is computed
 * by the caller (matches MetaQuotes' DRAW_COLOR_HISTOGRAM colour rule).
 */
export function awesome(bars: readonly IndiBar[]): Series {
  const n = bars.length;
  const out: Series = new Array(n).fill(null);
  if (n === 0) return out;
  const med = medianBuf(bars);
  const fast = smaBuf(med, 5);
  const slow = smaBuf(med, 34);
  for (let i = 0; i < n; i++) {
    const f = fast[i];
    const s = slow[i];
    if (f !== null && f !== undefined && s !== null && s !== undefined) out[i] = f - s;
  }
  return out;
}

// ── Accelerator Oscillator — iAC / AC ────────────────────────────────
/**
 * Accelerator Oscillator = AO − SMA(AO, 5). Fixed periods. First value at index 37
 * (AO first at 33, then a 5-SMA of it). Returns the difference series; per-bar
 * up/down colour is the caller's (AC>prev ? up : down).
 */
export function accelerator(bars: readonly IndiBar[]): Series {
  const n = bars.length;
  const out: Series = new Array(n).fill(null);
  if (n === 0) return out;
  const ao = awesome(bars);
  // 5-SMA of AO, but AO has leading nulls; compute the SMA only over fully-present
  // windows (matches MetaQuotes computing AO into a buffer then SMAing it, where
  // the SMA's PLOT_DRAW_BEGIN accounts for AO's own begin).
  for (let i = 0; i < n; i++) {
    if (i < 4) continue;
    let ok = true;
    let sum = 0.0;
    for (let j = 0; j < 5; j++) {
      const v = ao[i - j];
      if (v === null || v === undefined) { ok = false; break; }
      sum += v;
    }
    const cur = ao[i];
    if (ok && cur !== null && cur !== undefined) out[i] = cur - sum / 5.0;
  }
  return out;
}

// ── Alligator — iAlligator / Alligator ───────────────────────────────
export interface AlligatorBuffers {
  /** buffer 0 — Jaws (blue): SMMA(median,13), PLOT_SHIFT +8. */
  jaw: Series;
  /** buffer 1 — Teeth (red): SMMA(median,8), PLOT_SHIFT +5. */
  teeth: Series;
  /** buffer 2 — Lips (green): SMMA(median,5), PLOT_SHIFT +3. */
  lips: Series;
  /** Forward PLOT_SHIFT (bars) per line. */
  shift: { jaw: number; teeth: number; lips: number };
}

/**
 * Alligator. Three Smoothed MAs (SMMA = Wilder RMA) of the MEDIAN price (H+L)/2,
 * each drawn shifted FORWARD by its own offset (a cosmetic PLOT_SHIFT, exactly like
 * the Ichimoku cloud): Jaws SMMA(13)+8, Teeth SMMA(8)+5, Lips SMMA(5)+3. The
 * buffers hold the value at the COMPUTATION bar (what CopyBuffer returns); use the
 * exposed `shift` to place each line. Defaults are the MT5 iAlligator defaults.
 */
export function alligator(
  bars: readonly IndiBar[],
  jawPeriod = 13,
  jawShift = 8,
  teethPeriod = 8,
  teethShift = 5,
  lipsPeriod = 5,
  lipsShift = 3,
  applied: number = APPLIED.PRICE_MEDIAN,
): AlligatorBuffers {
  const price = priceSeries(bars, applied);
  return {
    jaw: smmaBuf(price, jawPeriod),
    teeth: smmaBuf(price, teethPeriod),
    lips: smmaBuf(price, lipsPeriod),
    shift: { jaw: jawShift, teeth: teethShift, lips: lipsShift },
  };
}

// ── Gator Oscillator — iGator / Gator (histogram) ────────────────────
export interface GatorBuffers {
  /** buffer 0 — UPPER = |Jaws − Teeth| (drawn upward), PLOT_SHIFT +teethShift. */
  upper: Series;
  /** buffer 2 — LOWER = −|Teeth − Lips| (drawn downward), PLOT_SHIFT +lipsShift. */
  lower: Series;
  /** Forward PLOT_SHIFT (bars) per histogram. */
  shift: { upper: number; lower: number };
}

/**
 * Gator Oscillator (the Alligator's "appetite"). UPPER = |Jaws − Teeth|, LOWER =
 * −|Teeth − Lips|, where Jaws/Teeth/Lips are the Alligator SMMAs of median price.
 * MetaQuotes' Gator aligns each bar to the Alligator's SHIFTED lines, so the
 * difference at draw-bar t uses Jaws(t−jawShift)/Teeth(t−teethShift)/Lips
 * (t−lipsShift). We compute the differences on that aligned basis and return them
 * indexed at the DRAW bar (UPPER carries +teethShift, LOWER +lipsShift — the
 * remaining shift relative to where the lines were computed). The per-bar colour
 * (|value| grew vs prev ? green : red) is the caller's.
 */
export function gator(
  bars: readonly IndiBar[],
  jawPeriod = 13,
  jawShift = 8,
  teethPeriod = 8,
  teethShift = 5,
  lipsPeriod = 5,
  lipsShift = 3,
  applied: number = APPLIED.PRICE_MEDIAN,
): GatorBuffers {
  const n = bars.length;
  const a = alligator(
    bars, jawPeriod, jawShift, teethPeriod, teethShift, lipsPeriod, lipsShift, applied,
  );
  const upper: Series = new Array(n).fill(null);
  const lower: Series = new Array(n).fill(null);
  // Build the displaced (as-plotted) line values, then take the difference at each draw bar.
  const jawP = displaced(a.jaw, jawShift);
  const teethP = displaced(a.teeth, teethShift);
  const lipsP = displaced(a.lips, lipsShift);
  for (let i = 0; i < n; i++) {
    const j = jawP[i];
    const t = teethP[i];
    const l = lipsP[i];
    if (j !== null && j !== undefined && t !== null && t !== undefined) {
      upper[i] = Math.abs(j - t);
    }
    if (t !== null && t !== undefined && l !== null && l !== undefined) {
      lower[i] = -Math.abs(t - l);
    }
  }
  // The UPPER/LOWER are already positioned at the draw bar (we displaced the lines
  // before differencing), so no residual PLOT_SHIFT — report 0.
  return { upper, lower, shift: { upper: 0, lower: 0 } };
}

// ── ADX Wilder — iADXWilder / ADXW (Wilder smoothing) ────────────────
/**
 * ADX by Welles Wilder. DISTINCT from `adx` above (which the stock ADX smooths
 * with an EMA): ADXW smooths TR, +DM, −DM with WILDER averaging
 * (firstSum/period seed at index `period`, then `prev − prev/period + cur`), forms
 * +DI = 100·smPDM/smTR, −DI = 100·smNDM/smTR, DX = 100·|+DI−−DI|/(+DI+−DI), and the
 * final ADX is the Wilder average of DX. +DI/−DI first at index `period`; ADX first
 * at index 2·period−1. Reads OHLC. Default period 14.
 */
export function adxWilder(bars: readonly IndiBar[], period: number): AdxBuffers {
  const n = bars.length;
  const main: Series = new Array(n).fill(null);
  const plusDI: Series = new Array(n).fill(null);
  const minusDI: Series = new Array(n).fill(null);
  if (period <= 0 || n <= period) return { main, plusDI, minusDI };

  // Per-bar directional movement + true range (index 0 = 0; needs a prior bar).
  const pdm = new Array<number>(n).fill(0);
  const ndm = new Array<number>(n).fill(0);
  const tr = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) {
    const h = bars[i]!.high;
    const l = bars[i]!.low;
    const ph = bars[i - 1]!.high;
    const pl = bars[i - 1]!.low;
    const pc = bars[i - 1]!.close;
    let up = h - ph;
    let dn = pl - l;
    if (up < 0) up = 0;
    if (dn < 0) dn = 0;
    if (up > dn) dn = 0;
    else if (dn > up) up = 0;
    else { up = 0; dn = 0; }
    pdm[i] = up;
    ndm[i] = dn;
    tr[i] = Math.max(Math.max(Math.abs(h - l), Math.abs(h - pc)), Math.abs(l - pc));
  }

  // Wilder smoothing of pdm/ndm/tr over the window [1..]. Seed at index `period`
  // = sum of the first `period` values (indices 1..period); then
  // smoothed[i] = smoothed[i-1] - smoothed[i-1]/period + raw[i].
  const smTR = new Array<number | null>(n).fill(null);
  const smP = new Array<number | null>(n).fill(null);
  const smN = new Array<number | null>(n).fill(null);
  let sTR = 0.0;
  let sP = 0.0;
  let sN = 0.0;
  for (let i = 1; i <= period; i++) {
    sTR += tr[i]!;
    sP += pdm[i]!;
    sN += ndm[i]!;
  }
  smTR[period] = sTR;
  smP[period] = sP;
  smN[period] = sN;
  for (let i = period + 1; i < n; i++) {
    smTR[i] = (smTR[i - 1] as number) - (smTR[i - 1] as number) / period + tr[i]!;
    smP[i] = (smP[i - 1] as number) - (smP[i - 1] as number) / period + pdm[i]!;
    smN[i] = (smN[i - 1] as number) - (smN[i - 1] as number) / period + ndm[i]!;
  }

  // +DI/−DI and DX from the smoothed sums (from index `period`).
  const dx = new Array<number | null>(n).fill(null);
  for (let i = period; i < n; i++) {
    const t = smTR[i] as number;
    const pdi = t !== 0 ? (100.0 * (smP[i] as number)) / t : 0.0;
    const ndi = t !== 0 ? (100.0 * (smN[i] as number)) / t : 0.0;
    plusDI[i] = pdi;
    minusDI[i] = ndi;
    const denom = pdi + ndi;
    dx[i] = denom !== 0 ? (100.0 * Math.abs(pdi - ndi)) / denom : 0.0;
  }

  // ADX = Wilder average of DX. DX exists from index `period`; seed the ADX at
  // index 2·period−1 = mean(DX[period .. 2·period−1]); then Wilder recursion.
  const adxStart = 2 * period - 1;
  if (adxStart < n) {
    let sum = 0.0;
    for (let i = period; i <= adxStart; i++) sum += dx[i] as number;
    let prev = sum / period;
    main[adxStart] = prev;
    for (let i = adxStart + 1; i < n; i++) {
      prev = (prev * (period - 1) + (dx[i] as number)) / period;
      main[i] = prev;
    }
  }
  return { main, plusDI, minusDI };
}

// ── Envelopes — iEnvelopes / Envelopes ───────────────────────────────
export interface EnvelopesBuffers {
  /** buffer 0 — UPPER = MA·(1 + deviation/100). */
  upper: Series;
  /** buffer 1 — LOWER = MA·(1 − deviation/100). */
  lower: Series;
  /** The middle MA (not a stock Envelopes buffer, but exposed for plotting). */
  middle: Series;
}

/**
 * Envelopes. middle = iMA(price, period, ma_method) (default SMA, PRICE_CLOSE);
 * UPPER = middle·(1 + deviation/100), LOWER = middle·(1 − deviation/100). Warm-up
 * follows the MA. Default period 14, SMA, deviation 0.10 (percent). The `shift`
 * (ma_shift) flows through the MA.
 */
export function envelopes(
  bars: readonly IndiBar[],
  period: number,
  deviationPercent: number,
  method: number = MA_METHOD.MODE_SMA,
  applied: number = APPLIED.PRICE_CLOSE,
  shift = 0,
): EnvelopesBuffers {
  const n = bars.length;
  const upper: Series = new Array(n).fill(null);
  const lower: Series = new Array(n).fill(null);
  const middle = ma(bars, period, method, applied, shift);
  const f = deviationPercent / 100.0;
  for (let i = 0; i < n; i++) {
    const m = middle[i];
    if (m === null || m === undefined) continue;
    upper[i] = m * (1.0 + f);
    lower[i] = m * (1.0 - f);
  }
  return { upper, lower, middle };
}

// ── Parabolic SAR — iSAR / Parabolic ─────────────────────────────────
/**
 * Parabolic SAR (Welles Wilder), ported from MetaQuotes' `Parabolic`.
 *
 * Initialisation (Parabolic): the FIRST output is at index 1. The starting
 * direction is decided from bars[0]→bars[1]: if close[1] > close[0] we start LONG
 * (sar[1] = low[0]), else SHORT (sar[1] = high[0]); EP is seeded with the matching
 * extreme of bar 1; AF = step.
 *
 * Each subsequent bar:
 *   sar[i] = sar[i-1] + AF · (EP − sar[i-1]);
 *   - LONG: if a new high, EP = high[i] and AF = min(AF+step, max). SAR is CLAMPED
 *     not to exceed min(low[i-1], low[i-2]). If price breaks below SAR
 *     (low[i] < sar[i]) the trend FLIPS to short: sar[i] = prior EP (the run's
 *     highest high), dir = short, EP = low[i], AF = step.
 *   - SHORT mirrors: clamp to max(high[i-1], high[i-2]); flip up when high[i] > sar.
 *
 * Returns one continuous series (value at every bar from index 1) — a renderer
 * draws it as dots. Defaults step 0.02, max 0.20.
 */
export function parabolicSar(
  bars: readonly IndiBar[],
  step: number,
  maximum: number,
): Series {
  const n = bars.length;
  const out: Series = new Array(n).fill(null);
  if (n < 2 || step <= 0 || maximum <= 0) return out;

  let dirLong: boolean;
  let sar: number;
  let ep: number;
  let af = step;

  // Seed from bars[0]→bars[1].
  if (bars[1]!.close >= bars[0]!.close) {
    dirLong = true;
    sar = bars[0]!.low; // start the parabola at the prior low
    ep = bars[1]!.high;
  } else {
    dirLong = false;
    sar = bars[0]!.high;
    ep = bars[1]!.low;
  }
  out[1] = sar;

  for (let i = 2; i < n; i++) {
    const h = bars[i]!.high;
    const l = bars[i]!.low;

    // Advance the parabola.
    let nextSar = sar + af * (ep - sar);

    if (dirLong) {
      // Clamp: SAR may not exceed the lowest low of the prior two bars.
      const cap = Math.min(bars[i - 1]!.low, bars[i - 2]!.low);
      if (nextSar > cap) nextSar = cap;

      if (l < nextSar) {
        // Flip to short.
        dirLong = false;
        nextSar = ep; // place SAR at the run's extreme high
        ep = l;
        af = step;
      } else {
        if (h > ep) {
          ep = h;
          af = Math.min(af + step, maximum);
        }
      }
    } else {
      // Clamp: SAR may not fall below the highest high of the prior two bars.
      const cap = Math.max(bars[i - 1]!.high, bars[i - 2]!.high);
      if (nextSar < cap) nextSar = cap;

      if (h > nextSar) {
        // Flip to long.
        dirLong = true;
        nextSar = ep; // place SAR at the run's extreme low
        ep = h;
        af = step;
      } else {
        if (l < ep) {
          ep = l;
          af = Math.min(af + step, maximum);
        }
      }
    }

    sar = nextSar;
    out[i] = sar;
  }
  return out;
}

// ── Fractals — iFractals / Fractals ──────────────────────────────────
export interface FractalsBuffers {
  /** buffer 0 — UPPER fractal: the bar's HIGH when it's a 5-bar local max (else null). */
  upper: Series;
  /** buffer 1 — LOWER fractal: the bar's LOW when it's a 5-bar local min (else null). */
  lower: Series;
}

/**
 * Bill Williams' Fractals. An UP fractal sits at bar i (2 ≤ i ≤ n−3) when its HIGH
 * is strictly greater than the highs of the two bars on EACH side:
 *   high[i] > high[i-1] ∧ high[i] > high[i-2] ∧ high[i] > high[i+1] ∧ high[i] > high[i+2].
 * A DOWN fractal mirrors on LOW (strictly lower than the four neighbours). The
 * value stored is the fractal bar's high/low; all other bars are `null`. (Matches
 * MetaQuotes' Fractals, which writes high[i]/low[i] at the centre bar.) A
 * renderer draws these as up/down markers.
 */
export function fractals(bars: readonly IndiBar[]): FractalsBuffers {
  const n = bars.length;
  const upper: Series = new Array(n).fill(null);
  const lower: Series = new Array(n).fill(null);
  for (let i = 2; i < n - 2; i++) {
    const h = bars[i]!.high;
    if (
      h > bars[i - 1]!.high &&
      h > bars[i - 2]!.high &&
      h > bars[i + 1]!.high &&
      h > bars[i + 2]!.high
    ) {
      upper[i] = h;
    }
    const l = bars[i]!.low;
    if (
      l < bars[i - 1]!.low &&
      l < bars[i - 2]!.low &&
      l < bars[i + 1]!.low &&
      l < bars[i + 2]!.low
    ) {
      lower[i] = l;
    }
  }
  return { upper, lower };
}
