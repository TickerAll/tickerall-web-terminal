/**
 * TradeLayer — MT5-style trade visualisation: the user's open + closed trades drawn
 * over the chart, the way MetaTrader 5 marks them.
 *
 * An OPEN position is drawn exactly as MT5 mobile does it: a full-width DASHED line at
 * the open price, a LEFT-anchored label on that line ("BUY 0.01,  -0.82" — side +
 * volume, then the live floating P&L), a coloured PRICE TAG on the right axis at that
 * level, and a direction ARROW (▲ BUY / ▼ SELL) placed AT THE CANDLE WHERE THE TRADE WAS
 * OPENED — projected from (openTime, openPrice). The arrow only shows while that entry
 * time is on-screen (MT5 hides off-screen markers); the line + label + tag always
 * represent the live position regardless of pan/zoom. A CLOSED trade is its entry arrow
 * → a dotted connector → an exit arrow (the closing deal, opposite direction), at the two
 * deals' (time, price). Arrow colour encodes DIRECTION (buy = accent/blue, sell = down/
 * red), never P&L; the connector + P&L text are tinted by P&L sign.
 *
 * It is a READ-ONLY, transparent canvas overlay inside `.chart-main` — modelled exactly
 * on `SessionBreaks`: it depends on NOTHING from the data pipeline or the drawing engine.
 * It consumes only the additive chart accessors the integrator passes (`getBarsSnapshot()`
 * for the live right edge, `timeToCoordinate()` / `priceToCoordinate()` to project, and
 * `onViewChange()` to repaint on pan/zoom) plus a ResizeObserver on the pane. It NEVER
 * touches the data pipeline. `pointer-events:none`, so it never blocks scroll/zoom/
 * crosshair, and it sits ABOVE the session breaks (z1) but BELOW the drawing overlay (z3),
 * at z-index 2.
 *
 * Colours come from the active theme tokens (`getActiveTokens()`), so trades recolour with
 * the palette: `tokens.accent` (BUY) / `tokens.down` (SELL) for direction, `tokens.up` /
 * `tokens.down` for P&L sign, `tokens.onAccent` for the price-tag text on its fill. It
 * re-themes via `registerChart` (same as SessionBreaks).
 *
 * It re-renders when `trades` changes (a new prop array re-runs the heavy effect's deps and
 * re-binds) and otherwise repaints live via the rAF poll — an open trade's `profit` and the
 * live right-edge bar move without any chart event, so a once-per-frame poll keeps the
 * projection (and the live P&L text) current, just like SessionBreaks tracks the forming bar.
 */

import { useEffect, useRef } from 'react';
import { getActiveTokens, registerChart } from '../theme/chartRegistry';
import { tradeMarkerOps } from '../chart/tradeMarkers';

/** A single trade to draw on the chart — open position or closed/historical trade.
 *  Times are epoch SECONDS (matching the chart's bar/coordinate domain). */
export interface ChartTrade {
  id: string;
  /** Provenance tag — a broker-executed trade. Tagged where the trade is built, never sniffed
   *  from the id. */
  source: 'real';
  side: 'BUY' | 'SELL';
  open: boolean;            // true = currently-open position, false = closed/historical
  openTime: number | null;  // epoch SECONDS; null = unknown (some open trades / brokers omit it)
  openPrice: number;
  closeTime?: number;       // epoch s — closed trades only (always present when open=false)
  closePrice?: number;      // closed trades only
  currentPrice?: number;    // open trades only: the live price (P&L is fed live via `profit`)
  profit: number;           // signed money — realized (closed) or floating (open)
  volume?: number;          // lots (for the on-chart label, e.g. "BUY 0.10")
}

/** The minimal chart access this overlay needs (the integrator passes ChartPane's
 *  `chartAccess` object, which already has exactly these). */
export interface TradeChartAccess {
  priceToCoordinate(price: number): number | null;
  timeToCoordinate(time: number): number | null;   // epoch seconds → x px (null if off-range)
  getBarsSnapshot(): { time: number }[];            // oldest→newest; last = the live/right edge
  onViewChange(cb: () => void): () => void;
}

interface Props {
  /** The pane element the overlay sizes itself to (`.chart-main`, position:relative). */
  paneRef: React.RefObject<HTMLDivElement | null>;
  /** Live chart accessors (a subset of ChartHandle) the integrator wires from ChartPane. */
  chart: TradeChartAccess;
  /** The trades to render — open positions + closed/historical trades. Empty → nothing. */
  trades: ChartTrade[];
  /** The charted symbol — used only by the on-chart "no trades on this symbol" diagnostic. */
  symbol?: string;
  /** Every symbol that currently has an OPEN position on this chart's account. When this
   *  overlay gets NO trades for `symbol` but the account holds positions on OTHER symbols,
   *  the chart shows that — surfacing a symbol-string mismatch (e.g. a position on
   *  "BTCUSDm" while charting "BTCUSD") instead of a silent empty overlay. */
  positionSymbols?: string[];
}

// ── Marker geometry (CSS px; scaled to dpr by the canvas transform) ──────────────
const ARROW_W = 12;         // entry-arrow half-width (triangle base = 2*ARROW_W) — LARGE + haloed so the entry candle is unmistakable
const ARROW_H = 17;         // entry-arrow height (tip to base)
const ARROW_GAP = 4;        // gap between the price point and the arrow base/tip
const ARROW_HALO = 3.5;     // halo-outline width drawn under the fill (separates the arrow from the candle it sits on)
const LEVEL_W = 2.5;        // open-price level line width (clearly visible, per MT5)
const LINE_DASH = [6, 5];   // dashed pattern for the open-price level + the closed-trade connector
const LABEL_FONT = '700 13px ui-monospace, SFMono-Regular, Menlo, monospace'; // BOLD + larger so it reads over candles
const TAG_FONT = '700 11px ui-monospace, SFMono-Regular, Menlo, monospace';   // right-axis price tag (bold)
const TAG_PAD = 6;          // price-tag horizontal padding
const LABEL_H = 20;         // label/tag row height — also the MIN vertical gap when dodging stacked labels

/** Format a signed money value for the floating P&L label (always shows the sign). */
function fmtPnl(v: number): string {
  const s = v >= 0 ? '+' : '-';
  return s + Math.abs(v).toFixed(2);
}

/** Lots for a trade label, e.g. "0.10" / "1.50" / "10.00". */
function fmtVol(v: number | undefined): string {
  return v == null ? '' : v.toFixed(2);
}

/** Adaptive price for an on-chart tag (no symbol digit-count is available to this overlay):
 *  more decimals for smaller prices, fewer for larger — good enough for a label. */
function fmtPx(p: number | undefined): string {
  if (p == null) return '';
  const a = Math.abs(p);
  const d = a >= 100 ? 2 : a >= 1 ? 4 : 5;
  return p.toFixed(d);
}

export function TradeLayer({ paneRef, chart, trades, symbol, positionSymbols }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<TradeChartAccess>(chart);
  chartRef.current = chart;
  // The trades to draw, kept in a ref so the rAF `paint()` closure always reads the
  // latest array without re-running the heavy effect; a `trades` change also re-renders
  // and re-schedules a paint (via the effect dep + scheduleRef below).
  const tradesRef = useRef<ChartTrade[]>(trades);
  tradesRef.current = trades;
  // Diagnostic inputs (charted symbol + the account's open-position symbols), in refs so
  // paint() reads the latest without re-running the heavy effect.
  const symbolRef = useRef<string | undefined>(symbol);
  symbolRef.current = symbol;
  const posSymsRef = useRef<string[] | undefined>(positionSymbols);
  posSymsRef.current = positionSymbols;
  // Re-render on a trades / symbol / position-symbols change → repaint with the new state
  // (without re-running the heavy effect / re-binding observers).
  const scheduleRef = useRef<() => void>(() => {});
  const posSymsKey = (positionSymbols ?? []).join(',');
  useEffect(() => { scheduleRef.current(); }, [trades, symbol, posSymsKey]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const pane = paneRef.current;
    if (!pane) return;

    // rAF coalescer — many triggers (pan/zoom, live-poll, resize, theme, trades change)
    // → one paint.
    let rafId = 0;
    const schedule = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => { rafId = 0; paint(); });
    };
    // Expose to the component-level effect so a trades change repaints (without re-running
    // this heavy effect / re-binding observers).
    scheduleRef.current = schedule;

    // HiDPI fit: back the canvas with devicePixelRatio physical pixels, draw in CSS px.
    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = pane.clientWidth;
      const h = pane.clientHeight;
      const pw = Math.max(1, Math.round(w * dpr));
      const ph = Math.max(1, Math.round(h * dpr));
      if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      schedule();
    };
    fit();

    const ro = new ResizeObserver(fit);
    ro.observe(pane);

    // Pan/zoom → repaint in lockstep. Re-bind if the chart instance changes.
    let offView = chartRef.current?.onViewChange(schedule) ?? (() => {});

    // Re-theme → repaint with the new token colours.
    const unregister = registerChart(() => schedule());

    // Live-update detector. LWC exposes no "data changed" event, and an OPEN trade's
    // `profit` + the live right-edge bar move without any view event, so we poll once per
    // frame: when the bar count or the first/last bar's time changes (a new forming bar, a
    // scroll-load prepend), or there is any open trade on screen, re-place the markers and
    // refresh the live P&L. Cheap — a length + endpoints compare; open trades repaint every
    // frame so their label tracks the live P&L the parent feeds.
    let lastLen = -1, lastFirst = -1, lastLast = -1;
    let running = true;
    const pollFrame = () => {
      if (!running) return;
      const c = chartRef.current;
      if (c) {
        const bars = c.getBarsSnapshot();
        const n = bars.length;
        const ft = n ? bars[0]!.time : -1;
        const lt = n ? bars[n - 1]!.time : -1;
        const hasOpen = tradesRef.current.some((t) => t.open);
        if (n !== lastLen || ft !== lastFirst || lt !== lastLast || hasOpen) {
          lastLen = n; lastFirst = ft; lastLast = lt;
          schedule();
        }
      }
      requestAnimationFrame(pollFrame);
    };
    requestAnimationFrame(pollFrame);

    // ── Marker primitives (all in CSS px; the ctx is pre-scaled to dpr) ───────────

    /** A LARGE filled direction triangle at the price point (x, y): point-up for BUY (drawn
     *  just BELOW the point, tip toward the price), point-down for SELL (just ABOVE). A halo
     *  outline (the chart canvas colour) is stroked under the fill so the marker always
     *  separates from the candle body it sits on — the entry candle is never ambiguous. */
    function arrow(ctx: CanvasRenderingContext2D, x: number, y: number, up: boolean, color: string, halo: string) {
      ctx.save();
      ctx.beginPath();
      if (up) {
        const tipY = y + ARROW_GAP;          // BUY: tip at the price point, base below it
        ctx.moveTo(x, tipY);
        ctx.lineTo(x - ARROW_W, tipY + ARROW_H);
        ctx.lineTo(x + ARROW_W, tipY + ARROW_H);
      } else {
        const tipY = y - ARROW_GAP;          // SELL: tip at the price point, base above it
        ctx.moveTo(x, tipY);
        ctx.lineTo(x - ARROW_W, tipY - ARROW_H);
        ctx.lineTo(x + ARROW_W, tipY - ARROW_H);
      }
      ctx.closePath();
      ctx.lineJoin = 'round';
      ctx.lineWidth = ARROW_HALO;
      ctx.strokeStyle = halo;              // halo first (wider), then the solid fill on top
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.restore();
    }

    /** A rounded-rect path helper (no Path2D.roundRect dependency for older runtimes). */
    function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
      const rr = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + rr, y);
      ctx.arcTo(x + w, y, x + w, y + h, rr);
      ctx.arcTo(x + w, y + h, x, y + h, rr);
      ctx.arcTo(x, y + h, x, y, rr);
      ctx.arcTo(x, y, x + w, y, rr);
      ctx.closePath();
    }

    /** The right-axis PRICE TAG for an open position's level — the coloured box MT5 shows on
     *  the price axis (over the native axis number) at the open-price row. Flush to the
     *  right edge, clamped vertically inside the canvas. */
    function priceTag(ctx: CanvasRenderingContext2D, y: number, text: string, fill: string, fg: string, W: number, H: number) {
      ctx.save();
      ctx.font = TAG_FONT;
      ctx.textBaseline = 'middle';
      const tw = ctx.measureText(text).width;
      const w = tw + TAG_PAD * 2, h = LABEL_H;
      const bx = W - w;
      const by = Math.max(0, Math.min(H - h, Math.round(y) - h / 2));
      ctx.fillStyle = fill;
      roundRect(ctx, bx, by, w, h, 2);
      ctx.fill();
      ctx.fillStyle = fg;
      ctx.fillText(text, bx + TAG_PAD, by + h / 2 + 0.5);
      ctx.restore();
    }

    /** A compact BUY/SELL badge on a CLOSED trade's ENTRY arrow — every trade marker is labelled
     *  with its side, matching the open-position label. Centred on x,
     *  offset clear of the arrow (below a BUY arrow, above a SELL arrow): panel backdrop + a
     *  side-tinted hairline + side-tinted text, so it reads over candles like the open label. */
    function sideTag(ctx: CanvasRenderingContext2D, x: number, y: number, up: boolean, text: string, color: string, panelColor: string) {
      ctx.save();
      ctx.font = TAG_FONT;
      ctx.textBaseline = 'middle';
      const tw = ctx.measureText(text).width;
      const w = tw + TAG_PAD * 2, h = LABEL_H - 4;
      const bx = Math.round(x - w / 2);
      const by = Math.round(up ? y + ARROW_GAP + ARROW_H + 3 : y - ARROW_GAP - ARROW_H - 3 - h);
      ctx.fillStyle = panelColor;
      roundRect(ctx, bx, by, w, h, 3);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      roundRect(ctx, bx, by, w, h, 3);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.fillText(text, bx + TAG_PAD, by + h / 2 + 0.5);
      ctx.restore();
    }

    /** The open-position label on the LEFT of the price line: "SIDE VOL,  ±P&L" — the
     *  side + volume in the primary text colour, the live P&L in its sign tint, on a strong
     *  backdrop + P&L-tinted hairline so it reads clearly over candles (the way MT5 mobile
     *  shows it, on the line). Drawn CENTRED on `cy` — the caller passes a dodged band-y so
     *  multiple positions at nearby prices don't overprint. */
    function openLabel(ctx: CanvasRenderingContext2D, cy: number, head: string, pnl: string, headColor: string, pnlColor: string, panelColor: string) {
      ctx.save();
      ctx.font = LABEL_FONT;
      ctx.textBaseline = 'middle';
      const lx = 8;
      const headW = ctx.measureText(head).width;
      const sp = ctx.measureText('  ').width;       // gap between "SIDE VOL," and the P&L
      const pnlW = ctx.measureText(pnl).width;
      const totalW = headW + sp + pnlW;
      const top = Math.round(cy) - LABEL_H / 2;
      // Strong backdrop so the bold text reads over any candle, plus a P&L-tinted hairline.
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = panelColor;
      roundRect(ctx, lx - 6, top, totalW + 12, LABEL_H, 4);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1;
      ctx.strokeStyle = pnlColor;
      roundRect(ctx, lx - 6, top, totalW + 12, LABEL_H, 4);
      ctx.stroke();
      ctx.fillStyle = headColor;
      ctx.fillText(head, lx, cy);
      ctx.fillStyle = pnlColor;
      ctx.fillText(pnl, lx + headW + sp, cy);
      ctx.restore();
    }

    /** The TIME of the candle whose period CONTAINS `t` — the last bar with `time <= t`.
     *  A trade fills at an exact instant inside a candle's period, so it belongs ON that
     *  candle (MT5 places its arrow there). Crucially, `timeToCoordinate(barTime)` is
     *  reliable for a real bar, whereas the exact fill second is usually OFF the bar grid
     *  (e.g. 40s into the forming bar) and sits past the last time-scale point → projects to
     *  null → no arrow. Returns null when `t` precedes the loaded window (entry off-screen
     *  left) or there are no bars. */
    function barTimeFor(bars: { time: number }[], t: number): number | null {
      const n = bars.length;
      if (n === 0 || t < bars[0]!.time) return null; // before the loaded window → off-screen left
      // A trade whose time is GROSSLY past the live/forming bar (more than ~2 bar intervals)
      // doesn't sit on any real candle — a stale/phantom record or a time mis-stamped into the
      // near future. Do NOT pin it to the current bar (that's the "stray arrow stuck above the
      // current candle" bug). A trade in the forming bar is < one interval past the last bar,
      // so legit recent trades still map correctly.
      const lastT = bars[n - 1]!.time;
      if (n >= 2) {
        const interval = lastT - bars[n - 2]!.time;
        if (interval > 0 && t >= lastT + 2 * interval) return null;
      }
      let lo = 0, hi = n - 1, idx = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (bars[mid]!.time <= t) { idx = mid; lo = mid + 1; } else hi = mid - 1;
      }
      return bars[idx]!.time;
    }

    function paint() {
      const c = chartRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const W = canvas.clientWidth, H = canvas.clientHeight;
      ctx.clearRect(0, 0, W, H);
      const list = tradesRef.current ?? [];
      const tokens = getActiveTokens();

      // No trades reached this overlay for the charted symbol. The symbol-mismatch case
      // (account holds positions on OTHER symbols than the charted one) is logged to the
      // journal by the shell — we keep the CHART clean and no longer annotate it here
      // (per user request).
      if (list.length === 0) return; // nothing to draw
      if (!c) return; // no projection yet → nothing to place; reappears once the chart is ready

      const up = tokens.up;          // P&L ≥ 0
      const down = tokens.down;      // P&L < 0 / SELL direction
      const accent = tokens.accent;  // BUY direction
      const fg = tokens.fg;          // primary label text
      const panel = tokens.panel;    // label backdrop
      const onAccent = tokens.onAccent; // price-tag text (on the coloured fill)
      const halo = tokens.chartBg;   // arrow halo — the chart canvas colour, so arrows cut out from candles
      const sideColor = (side: 'BUY' | 'SELL') => (side === 'BUY' ? accent : down);
      const pnlColor = (p: number) => (p >= 0 ? up : down);
      const bars = c.getBarsSnapshot(); // oldest→newest; used to snap each trade to its candle

      // Draw a trade's markers from tradeMarkerOps — the SINGLE source the open + closed branches
      // share, so an entry can never again be drawn unlabelled (like a close). Entry ops → arrow +
      // side TAG at (entryX,entryY); the exit op → an opposite-direction UNLABELLED arrow at
      // (exitX,exitY). Each is drawn only when its coordinate projects (off-screen → skipped).
      const drawTradeMarkers = (t: ChartTrade, entryX: number | null, entryY: number | null, exitX: number | null, exitY: number | null) => {
        for (const op of tradeMarkerOps(t)) {
          if (op.role === 'entry') {
            if (entryX !== null && entryY !== null) {
              arrow(ctx, entryX, entryY, op.arrow === 'up', sideColor(t.side), halo);
              sideTag(ctx, entryX, entryY, op.arrow === 'up', op.tag, sideColor(t.side), panel);
            }
          } else if (exitX !== null && exitY !== null) {
            arrow(ctx, exitX, exitY, op.arrow === 'up', sideColor(t.side === 'BUY' ? 'SELL' : 'BUY'), halo);
          }
        }
      };

      // ── CLOSED trades first, so open-position lines/labels paint on top. Entry arrow →
      //    dotted connector → exit arrow (the closing deal, opposite direction). Each arrow
      //    is placed on the CANDLE its deal time falls in; off-screen candles just hide that
      //    marker (MT5 behaviour) — entry/exit are drawn independently so a half-visible
      //    trade still shows what it can. ───────────────────────────────────────────────
      for (const t of list) {
        if (t.open) continue;
        if (t.openTime == null || t.closeTime == null || t.closePrice == null) continue;
        const bt0 = barTimeFor(bars, t.openTime);
        let bt1 = barTimeFor(bars, t.closeTime);
        // A CLOSED trade's exit is a REAL past event. barTimeFor drops any time >2 bar
        // intervals past the last loaded bar (a guard against phantom OPEN arrows stuck to
        // the current candle) — but for a closed trade whose close is newer than the chart's
        // last bar (live bars slightly behind on low TFs / just after a stream catch-up),
        // that drops the exit arrow and the trade renders entry-only → looks OPEN. Clamp such
        // an exit to the last bar so a closed trade ALWAYS shows its close. Only clamps when
        // the close is at/after the last bar (never a pre-window close, which is genuinely
        // off-screen left and whose entry is off-screen too).
        if (bt1 == null && bars.length > 0 && t.closeTime >= bars[bars.length - 1]!.time) {
          bt1 = bars[bars.length - 1]!.time;
        }
        const x0 = bt0 != null ? c.timeToCoordinate(bt0) : null;
        const y0 = c.priceToCoordinate(t.openPrice);
        const x1 = bt1 != null ? c.timeToCoordinate(bt1) : null;
        const y1 = c.priceToCoordinate(t.closePrice);

        // Dotted connector (entry → exit), coloured by realized P&L — only when BOTH ends place.
        if (x0 !== null && y0 !== null && x1 !== null && y1 !== null) {
          ctx.save();
          ctx.strokeStyle = pnlColor(t.profit);
          ctx.lineWidth = 2;
          ctx.globalAlpha = 0.85;
          ctx.setLineDash(LINE_DASH);
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();
        }

        // Entry arrow (LABELLED) → exit arrow (opposite direction, UNLABELLED). Both derived from
        // tradeMarkerOps so the closed + open branches can't diverge on what an entry looks like.
        // Big + haloed; each drawn only when its candle is on-screen.
        drawTradeMarkers(t, x0, y0, x1, y1);
      }

      // ── OPEN positions: full-width DASHED level at the open price + LEFT label (live P&L) +
      //    right-axis PRICE TAG + a direction ARROW at the candle where it was opened. The
      //    line + label + tag always show (the live position); the arrow only when its entry
      //    time is on-screen. ─────────────────────────────────────────────────────────────
      // Gather drawable open positions (price must project), then DODGE the left label +
      //   right tag vertically so positions at nearby prices don't overprint: greedy from
      //   the top, push each colliding band down by LABEL_H, clamped inside the canvas. The
      //   dashed level + entry arrow stay at the TRUE price; only the text band is nudged.
      const opens: { t: ChartTrade; y0: number; band: number }[] = [];
      for (const t of list) {
        if (!t.open) continue;
        const y0 = c.priceToCoordinate(t.openPrice);
        if (y0 === null) continue; // open price off the visible price scale → nothing to draw
        opens.push({ t, y0, band: y0 });
      }
      opens.sort((a, b) => a.y0 - b.y0);
      let prevBand = -Infinity;
      for (const o of opens) {
        const band = Math.max(LABEL_H / 2, Math.min(H - LABEL_H / 2, Math.max(o.y0, prevBand + LABEL_H)));
        o.band = band;
        prevBand = band;
      }

      for (const o of opens) {
        const t = o.t, y0 = o.y0, col = sideColor(t.side);
        const yr = Math.round(y0) + 0.5;

        // Thick dashed open-price level, full width.
        ctx.save();
        ctx.strokeStyle = col;
        ctx.lineWidth = LEVEL_W;
        ctx.globalAlpha = 0.95;
        ctx.setLineDash(LINE_DASH);
        ctx.beginPath();
        ctx.moveTo(0, yr);
        ctx.lineTo(W, yr);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();

        // Big haloed direction arrow + BUY/SELL tag ON the candle the position was opened in
        // (snapped to that bar; only while that candle is on-screen). An open position's arrow IS an
        // ENTRY, so it's LABELLED — same as a closed trade's entry (via the shared drawTradeMarkers,
        // which draws no exit for an open trade). Previously the tag was missing → looked like a close.
        const bt = t.openTime != null ? barTimeFor(bars, t.openTime) : null;
        const x0 = bt != null ? c.timeToCoordinate(bt) : null;
        drawTradeMarkers(t, x0, y0, null, null);

        // Left label "SIDE VOL,  ±P&L" (live P&L) + right-axis price tag, at the dodged band.
        const head = t.volume != null ? `${t.side} ${fmtVol(t.volume)},` : `${t.side},`;
        openLabel(ctx, o.band, head, fmtPnl(t.profit), fg, pnlColor(t.profit), panel);
        priceTag(ctx, o.band, fmtPx(t.openPrice), col, onAccent, W, H);
      }
    }

    return () => {
      running = false;
      ro.disconnect();
      offView();
      offView = () => {};
      unregister();
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneRef, chart]);

  // The canvas is transparent to pointer events (never blocks chart interaction) and
  // sits ABOVE the session breaks (zIndex 1) but BELOW the drawing overlay (zIndex 3).
  return (
    <canvas
      ref={canvasRef}
      className="trade-layer"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2 }}
    />
  );
}
