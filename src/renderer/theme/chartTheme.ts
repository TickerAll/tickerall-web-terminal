/**
 * Map `ThemeTokens` → lightweight-charts option shapes, so a chart re-themes by
 * `chart.applyOptions(chartOptions)` + `candleSeries.applyOptions(candleOptions)` +
 * `overlaySeries.applyOptions(overlayOptions)`.
 *
 * The shapes are DeepPartial of LWC's `ChartOptions` / `CandlestickSeriesPartialOptions`
 * / `LineSeriesPartialOptions` — passing only the keys the theme controls, so
 * everything else (autoSize, crosshair mode, timeVisible, line widths, …) is left
 * untouched by `applyOptions` (it merges).
 *
 * IMPORTANT (byte-identical default): for the `dark` tokens these produce EXACTLY the
 * options Chart.tsx passes at `createChart` today — same bg, scale
 * text, grid, scale borders, candle colours, overlay colour. The watermark stays
 * `visible:false` (the original chart has none) unless a caller opts in.
 */

import type {
  DeepPartial, ChartOptions, CandlestickSeriesPartialOptions, LineSeriesPartialOptions,
} from 'lightweight-charts';
import type { ThemeTokens } from './tokens';
import type { ChartColorOverrides } from '../../shared/settingsSchema';
import { isColorOverrideSet } from '../../shared/settingsSchema';
import { getSetting } from '../settings/store';

export interface ChartThemeOptions {
  /** For `chart.applyOptions(...)`. */
  chartOptions: DeepPartial<ChartOptions>;
  /** For the candlestick `series.applyOptions(...)`. */
  candleOptions: CandlestickSeriesPartialOptions;
  /** For the overlay line `series.applyOptions(...)`. */
  overlayOptions: LineSeriesPartialOptions;
}

/**
 * Build the main-chart theme option triple from tokens, then layer the user's
 * `chart.colors` overrides (Item 6) on top. An override field left UNSET (absent /
 * null / empty string) is skipped, so when the user has set NO overrides the result is
 * EXACTLY the token-derived options — dark stays byte-identical.
 *
 * Each set override maps onto the same LWC option the corresponding token feeds:
 *   upBody → candle up body+wick (matches the token default, which uses the body
 *   colour for the wick unless the user separately sets wickUp/wickDown);
 *   background/grid/text → chart layout; crosshair → both crosshair lines + their
 *   label backgrounds; text → scale + crosshair-label text.
 */
export function chartTheme(t: ThemeTokens): ChartThemeOptions {
  const base: ChartThemeOptions = {
    chartOptions: {
      layout: { background: { color: t.chartBg }, textColor: t.scaleText },
      grid: { vertLines: { color: t.grid }, horzLines: { color: t.grid } },
      rightPriceScale: { borderColor: t.scaleBorder },
      timeScale: { borderColor: t.scaleBorder },
      // Theme owns only the watermark COLOUR; visibility/text/fontSize are owned by the
      // chart's setWatermark (the configurable symbol+TF background). Hidden by the lib
      // default until enabled, so dark stays identical until the feature turns it on.
      watermark: { color: t.watermark },
    },
    candleOptions: {
      upColor: t.upBody, downColor: t.downBody,
      wickUpColor: t.upBody, wickDownColor: t.downBody,
      borderColor: t.candleBorder,
      borderVisible: t.candleBorder !== 'transparent',
    },
    overlayOptions: { color: t.gold },
  };
  return applyColorOverrides(base, getChartColorOverrides());
}

/** Read the user's chart-colour overrides from the settings store (safe: returns an
 *  empty object before the store has hydrated or if the section is missing). */
function getChartColorOverrides(): ChartColorOverrides {
  const v = getSetting<ChartColorOverrides | undefined>('chart.colors');
  return v && typeof v === 'object' ? v : {};
}

/**
 * Layer set colour overrides onto a computed theme triple. Mutates a shallow copy —
 * the input `base` is not changed. Only fields that are actually SET (non-empty
 * strings) are applied; everything else is left exactly as the tokens produced it, so
 * an all-unset override object yields a byte-identical result.
 */
export function applyColorOverrides(base: ChartThemeOptions, o: ChartColorOverrides): ChartThemeOptions {
  if (!o) return base;
  const upSet = isColorOverrideSet(o.upBody);
  const downSet = isColorOverrideSet(o.downBody);
  const wickUpSet = isColorOverrideSet(o.wickUp);
  const wickDownSet = isColorOverrideSet(o.wickDown);
  const bgSet = isColorOverrideSet(o.background);
  const gridSet = isColorOverrideSet(o.grid);
  const crossSet = isColorOverrideSet(o.crosshair);
  const textSet = isColorOverrideSet(o.text);
  // Nothing set → return the base untouched (byte-identical guarantee).
  if (!(upSet || downSet || wickUpSet || wickDownSet || bgSet || gridSet || crossSet || textSet)) return base;

  // Candle overrides. The body override also drives the wick (matching the token
  // default) UNLESS the user gave an explicit wick colour for that side.
  const candleOptions: CandlestickSeriesPartialOptions = { ...base.candleOptions };
  if (upSet) { candleOptions.upColor = o.upBody!; candleOptions.wickUpColor = o.upBody!; }
  if (downSet) { candleOptions.downColor = o.downBody!; candleOptions.wickDownColor = o.downBody!; }
  if (wickUpSet) candleOptions.wickUpColor = o.wickUp!;
  if (wickDownSet) candleOptions.wickDownColor = o.wickDown!;

  // Chart-level overrides. Build only the sub-objects that change, so applyOptions
  // (which deep-merges) doesn't disturb any key we didn't touch.
  const chartOptions: DeepPartial<ChartOptions> = { ...base.chartOptions };
  if (bgSet || textSet) {
    chartOptions.layout = {
      ...(base.chartOptions.layout ?? {}),
      ...(bgSet ? { background: { color: o.background! } } : {}),
      ...(textSet ? { textColor: o.text! } : {}),
    };
  }
  if (gridSet) {
    chartOptions.grid = { vertLines: { color: o.grid! }, horzLines: { color: o.grid! } };
  }
  if (crossSet) {
    chartOptions.crosshair = {
      vertLine: { color: o.crosshair!, labelBackgroundColor: o.crosshair! },
      horzLine: { color: o.crosshair!, labelBackgroundColor: o.crosshair! },
    };
  }

  return { chartOptions, candleOptions, overlayOptions: base.overlayOptions };
}

export interface EquityThemeOptions {
  chartOptions: DeepPartial<ChartOptions>;
  /** Equity curve line options. */
  equityOptions: LineSeriesPartialOptions;
  /** Balance curve line options. */
  balanceOptions: LineSeriesPartialOptions;
}

/** Build the equity-chart theme from tokens. */
export function equityChartTheme(t: ThemeTokens): EquityThemeOptions {
  return {
    chartOptions: {
      layout: { background: { color: t.equityBg }, textColor: t.equityText },
      grid: { vertLines: { color: t.grid }, horzLines: { color: t.grid } },
      rightPriceScale: { borderColor: t.scaleBorder },
      timeScale: { borderColor: t.scaleBorder },
    },
    equityOptions: { color: t.equityLine },
    balanceOptions: { color: t.balanceLine },
  };
}
