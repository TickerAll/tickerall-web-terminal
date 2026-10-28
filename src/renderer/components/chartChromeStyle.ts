/**
 * Chart-chrome CSS, injected once from JS (mirrors ThemeProvider.ensureChromeStyle) so
 * we never edit index.html. Covers the two history-loading indicators (recent/initial
 * top-left + deep/scroll-back at the left data edge) and the in-chart candle-countdown
 * badge. All colours read the theme `--vars` set on :root, so they recolour with the
 * palette automatically.
 *
 * Idempotent: a single <style id="chart-chrome"> is appended to <head> the first time
 * any chart pane mounts.
 */

const STYLE_ID = 'chart-chrome';

const CSS = `
@keyframes tat-chart-spin { to { transform: rotate(360deg); } }

/* Item 9 — recent/initial load: a PROMINENT badge at the TOP-LEFT of the chart. */
.chart-loading-recent {
  position: absolute; top: 10px; left: 12px; z-index: 6;
  display: flex; align-items: center; gap: 9px;
  padding: 7px 13px;
  background: var(--chart-loading-bg);
  border: 1px solid var(--line2);
  border-radius: 7px;
  color: var(--fg); font-size: 12px; font-weight: 600;
  letter-spacing: .2px;
  box-shadow: 0 2px 10px var(--shadow);
  pointer-events: none;
}
.chart-loading-recent .tat-spinner {
  width: 15px; height: 15px;
  border: 2.5px solid var(--line2);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: tat-chart-spin .7s linear infinite;
  flex: none;
}

/* Item 8 — deep/scroll-back history load: a spinner at the LEFT edge, vertically
   centred (the empty area just past the oldest loaded candle). Positioned by the
   component (top is set inline near the data edge); this is the chip styling. */
.chart-loading-deep {
  position: absolute; left: 10px; z-index: 6;
  transform: translateY(-50%);
  display: flex; align-items: center; gap: 7px;
  padding: 4px 10px;
  background: var(--chart-loading-bg);
  border: 1px solid var(--line2);
  border-radius: 999px;
  color: var(--muted); font-size: 11px;
  pointer-events: none;
}
.chart-loading-deep .tat-spinner {
  width: 11px; height: 11px;
  border: 2px solid var(--line2);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: tat-chart-spin .7s linear infinite;
  flex: none;
}

/* Item 13 — candle countdown INSIDE the chart, on the RIGHT price axis just below the
   last-price label (TradingView/MT5 style). The top is set inline (anchored to the
   forming bar's price→y); this hugs the right edge. */
.chart-countdown {
  position: absolute; right: 2px; z-index: 4;
  padding: 1px 6px;
  background: var(--chart-loading-bg);
  border: 1px solid var(--line2);
  border-radius: 4px;
  color: var(--muted); font-size: 11px; font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1.4;
  white-space: nowrap;
  pointer-events: none;
}
`;

let injected = false;

/** Inject the chart-chrome <style> once (idempotent). Safe to call on every pane mount. */
export function ensureChartChromeStyle(): void {
  if (injected || typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) { injected = true; return; }
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
  injected = true;
}
