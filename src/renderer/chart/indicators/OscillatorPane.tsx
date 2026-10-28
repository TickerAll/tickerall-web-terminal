/**
 * OscillatorPane — a self-contained sub-chart for ONE oscillator indicator
 * instance (RSI / MACD / Stochastic / ATR / ADX / CCI / Momentum / Volume).
 *
 * lightweight-charts v4 has no native multi-pane, so each oscillator gets its OWN
 * `createChart` (a short ~120px chart) and stays TIME-SYNCED to the main chart by
 * mirroring its visible LOGICAL range. Because we feed this sub-chart's series the
 * SAME bar timestamps (one point per bar that has a value), the main chart's
 * logical indices line up 1:1 with this one's — so applying the main's logical
 * range here keeps the columns pixel-aligned through every pan/zoom.
 *
 * Theming follows the repo pattern: seed colours from the active
 * tokens at mount, then `registerChart` a re-theme callback so a live theme switch
 * repaints this pane too. The pane carries its own scoped `<style>` (injected once)
 * using the app's CSS vars, so it needs no edits to index.html.
 */

import { useEffect, useRef } from 'react';
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  type LineData,
  type HistogramData,
} from 'lightweight-charts';
import { getActiveTokens, registerChart } from '../../theme/chartRegistry';
import type { ThemeTokens } from '../../theme/tokens';
import { getIndicator, type IndiPoint } from './registry';
import type { IndicatorInstance } from './manager';
import type { IndiBar } from './math';

/** Resolve a colour token that may be a `var(--x)` against the live computed style,
 *  falling back to a sensible literal if the var isn't set yet. lightweight-charts'
 *  canvas can't read CSS vars, so we materialise them to literals. */
function resolveColor(color: string, fallback: string): string {
  if (!color.startsWith('var(')) return color;
  const name = color.slice(4, -1).trim(); // `var(--x)` → `--x`
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch {
    return fallback;
  }
}

export interface OscillatorPaneProps {
  /** The oscillator instance to render (its params + colours). */
  instance: IndicatorInstance;
  /** The chart's bars (oldest→newest). The indicator is recomputed when this changes. */
  bars: IndiBar[];
  /** Subscribe to the MAIN chart's view changes; return an unsubscribe. */
  onMainViewChange: (cb: () => void) => () => void;
  /** Read the MAIN chart's current visible logical range (or null). */
  getMainVisibleLogicalRange: () => { from: number; to: number } | null;
  /** Remove this pane (the ✕ in the header). */
  onRemove: () => void;
  /** Optional pane height in px (default 120). */
  height?: number;
}

export function OscillatorPane({
  instance,
  bars,
  onMainViewChange,
  getMainVisibleLogicalRange,
  onRemove,
  height = 120,
}: OscillatorPaneProps) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  /** One series per output key (line or histogram). */
  const seriesByKey = useRef<Map<string, ISeriesApi<'Line'> | ISeriesApi<'Histogram'>>>(new Map());
  /** Keep latest props in refs so the chart effect (run once) reads fresh values. */
  const barsRef = useRef(bars);
  barsRef.current = bars;
  const instRef = useRef(instance);
  instRef.current = instance;
  const tokensRef = useRef<ThemeTokens>(getActiveTokens());
  /** Guard against applying our own range echo back as a "user" change. */
  const applyingRange = useRef(false);

  const def = getIndicator(instance.indicatorId);

  // ── create the sub-chart ONCE; wire theme + main-view sync ──────────────────
  useEffect(() => {
    if (!def) return;
    const tokens = getActiveTokens();
    tokensRef.current = tokens;
    const c = createChart(el.current!, {
      layout: { background: { color: tokens.chartBg }, textColor: tokens.scaleText, fontSize: 10 },
      grid: { vertLines: { color: tokens.grid }, horzLines: { color: tokens.grid } },
      rightPriceScale: { borderColor: tokens.scaleBorder },
      timeScale: {
        borderColor: tokens.scaleBorder,
        timeVisible: true,
        secondsVisible: false,
        // Hide this pane's own axis labels — the MAIN chart's time axis is the
        // shared reference below the stack; a per-oscillator axis is redundant.
        visible: false,
      },
      crosshair: { mode: 0 },
      handleScroll: false, // the user pans/zooms the MAIN chart; this one follows.
      handleScale: false,
      autoSize: true,
    });
    chart.current = c;

    // Build one series per output key with the instance's (resolved) colour.
    const map = seriesByKey.current;
    for (const out of def.outputs) {
      const col = resolveColor(
        instRef.current.colors[out.key] ?? out.defaultColor,
        out.defaultColor.startsWith('var(') ? tokens.accent : out.defaultColor,
      );
      if (out.type === 'histogram') {
        map.set(out.key, c.addHistogramSeries({ color: col, priceLineVisible: false, lastValueVisible: false }));
      } else if (out.type === 'dots') {
        // Point-markers only (no connecting line) — for any dot-style oscillator.
        map.set(out.key, c.addLineSeries({ color: col, lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: 2, priceLineVisible: false, lastValueVisible: false }));
      } else {
        map.set(out.key, c.addLineSeries({ color: col, lineWidth: 1, priceLineVisible: false, lastValueVisible: false }));
      }
    }

    // Re-theme: repaint chrome + re-resolve var() series colours.
    const applyTheme = (t: ThemeTokens) => {
      tokensRef.current = t;
      chart.current?.applyOptions({
        layout: { background: { color: t.chartBg }, textColor: t.scaleText },
        grid: { vertLines: { color: t.grid }, horzLines: { color: t.grid } },
        rightPriceScale: { borderColor: t.scaleBorder },
        timeScale: { borderColor: t.scaleBorder },
      });
      const d = getIndicator(instRef.current.indicatorId);
      if (!d) return;
      for (const out of d.outputs) {
        const s = seriesByKey.current.get(out.key);
        if (!s) continue;
        s.applyOptions({
          color: resolveColor(
            instRef.current.colors[out.key] ?? out.defaultColor,
            out.defaultColor.startsWith('var(') ? t.accent : out.defaultColor,
          ),
        });
      }
    };
    applyTheme(tokens);
    const unregister = registerChart(applyTheme);

    // Time-sync: when the MAIN chart pans/zooms, mirror its logical range here.
    const syncRange = () => {
      const r = getMainVisibleLogicalRange();
      if (!r) return;
      applyingRange.current = true;
      try {
        chart.current?.timeScale().setVisibleLogicalRange({ from: r.from, to: r.to });
      } catch {
        /* chart torn down mid-apply */
      }
      applyingRange.current = false;
    };
    const offMain = onMainViewChange(syncRange);

    // Seed data + initial range now that series exist.
    drawAll();
    syncRange();

    return () => {
      offMain();
      unregister();
      seriesByKey.current.clear();
      c.remove();
      chart.current = null;
    };
    // Mount once. Data/colour updates flow through the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── recompute + redraw when the bars change ─────────────────────────────────
  useEffect(() => {
    drawAll();
    // After new data, re-assert the main's range so a data swap can't reset zoom.
    const r = getMainVisibleLogicalRange();
    if (r) {
      applyingRange.current = true;
      try {
        chart.current?.timeScale().setVisibleLogicalRange({ from: r.from, to: r.to });
      } catch {
        /* torn down */
      }
      applyingRange.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bars]);

  // ── re-apply colours when the instance's colours change ─────────────────────
  useEffect(() => {
    const d = getIndicator(instance.indicatorId);
    if (!d) return;
    for (const out of d.outputs) {
      const s = seriesByKey.current.get(out.key);
      if (!s) continue;
      s.applyOptions({
        color: resolveColor(
          instance.colors[out.key] ?? out.defaultColor,
          out.defaultColor.startsWith('var(') ? tokensRef.current.accent : out.defaultColor,
        ),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance.colors]);

  // ── recompute + redraw when params change ───────────────────────────────────
  useEffect(() => {
    drawAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance.params]);

  /** Compute the indicator from the latest bars and push each output onto its series. */
  function drawAll() {
    const d = getIndicator(instRef.current.indicatorId);
    if (!d || !chart.current) return;
    let outputs: Record<string, IndiPoint[]>;
    try {
      outputs = d.compute(barsRef.current, instRef.current.params);
    } catch {
      // A malformed param slipped through — clear rather than crash the pane.
      for (const s of seriesByKey.current.values()) s.setData([]);
      return;
    }
    for (const out of d.outputs) {
      const s = seriesByKey.current.get(out.key);
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
  }

  if (!def) return null;

  return (
    <div className="ind-osc" style={{ height }}>
      <div className="ind-osc-head">
        <span className="ind-osc-title">{def.label}</span>
        <button type="button" className="ind-osc-x" title="Remove indicator" onClick={onRemove}>
          ✕
        </button>
      </div>
      <div className="ind-osc-chart" ref={el} />
      <IndicatorStyleScope />
    </div>
  );
}

/** Scoped styles for the oscillator pane stack — injected once (a module-level
 *  flag dedupes across panes). Uses the app's CSS vars so it follows the theme. */
let stylesInjected = false;
function IndicatorStyleScope() {
  useEffect(() => {
    if (stylesInjected) return;
    stylesInjected = true;
    const style = document.createElement('style');
    style.setAttribute('data-indicators', 'oscillator');
    style.textContent = OSC_CSS;
    document.head.appendChild(style);
  }, []);
  return null;
}

const OSC_CSS = `
.ind-osc { position: relative; display: flex; flex-direction: column; border-top: 1px solid var(--line); background: var(--chart-bg, var(--bg)); }
.ind-osc-head { display: flex; align-items: center; justify-content: space-between; height: 18px; padding: 0 8px; font-size: 10px; color: var(--muted); user-select: none; }
.ind-osc-title { font-weight: 600; letter-spacing: .02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ind-osc-x { background: transparent; border: none; color: var(--muted); cursor: pointer; font-size: 11px; padding: 0 3px; border-radius: 4px; line-height: 1; }
.ind-osc-x:hover { background: var(--hover); color: var(--fg); }
.ind-osc-chart { flex: 1 1 0; min-height: 0; }
`;
