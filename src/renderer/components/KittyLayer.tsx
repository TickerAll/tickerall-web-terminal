/**
 * KittyLayer — the "cute theme" candle decoration: when a kitty theme is active (Cotton
 * Candy / Macaron — any theme with `kitty: true`), this overlay draws little cat EARS on
 * top of every candle body, and a tiny FACE (eyes + nose + whiskers) once you're zoomed
 * in enough for it to read. The candles keep their real OHLC meaning — this is purely
 * decorative paint on top, so prices, the forming bar, markers and drawings are untouched.
 *
 * It is a READ-ONLY, transparent canvas overlay inside `.chart-main` — modelled exactly on
 * `SessionBreaks`/`TradeLayer`: it depends on NOTHING from the data pipeline and only
 * consumes the additive chart accessors (`getBarsSnapshot()` for OHLC + the forming bar,
 * `timeToCoordinate()` / `priceToCoordinate()` to project, `onViewChange()` to repaint on
 * pan/zoom) plus a ResizeObserver. `pointer-events:none`. It sits ABOVE the chart canvas
 * but BELOW the trade overlay (z2) and drawings (z3), at z-index 1.
 *
 * Activation is theme-driven: it checks whether the active `theme-<id>` body class is one
 * of `KITTY_THEME_IDS`. When the theme isn't a kitty theme it clears and no-ops (cheap), so
 * it can be mounted unconditionally; `registerChart` repaints it when the theme changes, so
 * the kitties appear/disappear as you switch themes. Ear/face colours come from the active
 * candle tokens (`upBody`/`downBody`) so each cat matches its candle's direction.
 */

import { useEffect, useRef } from 'react';
import type { ChartBar } from '../../shared/types';
import { getActiveTokens, registerChart } from '../theme/chartRegistry';
import { KITTY_THEME_IDS } from '../theme/tokens';

/** The minimal chart access this overlay needs (ChartPane's `chartAccess` provides all of
 *  these; its `getBarsSnapshot` returns full OHLC bars). */
export interface KittyChartAccess {
  priceToCoordinate(price: number): number | null;
  timeToCoordinate(time: number): number | null;   // epoch seconds → x px (null if off-range)
  getBarsSnapshot(): ChartBar[];                    // oldest→newest; last = the live/forming bar
  onViewChange(cb: () => void): () => void;
}

interface Props {
  /** The pane element the overlay sizes itself to (`.chart-main`, position:relative). */
  paneRef: React.RefObject<HTMLDivElement | null>;
  /** Live chart accessors (a subset of ChartHandle) the integrator wires from ChartPane. */
  chart: KittyChartAccess;
}

// ── Geometry (CSS px; the ctx is pre-scaled to dpr) ──────────────────────────────
const MIN_SPACING_EARS = 5;   // below this bar spacing the cats would be mush → skip (plain candles)
const MIN_SPACING_FACE = 16;  // draw eyes/nose/whiskers only when bars are this wide
const MIN_BODY_FACE = 9;      // …and the body is at least this tall (room for a face)

/** True when the active theme is a kitty theme (its `theme-<id>` body class is in the set). */
function kittyActive(): boolean {
  if (typeof document === 'undefined') return false;
  const cl = document.body.classList;
  return KITTY_THEME_IDS.some((id) => cl.contains(`theme-${id}`));
}

export function KittyLayer({ paneRef, chart }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<KittyChartAccess>(chart);
  chartRef.current = chart;

  useEffect(() => {
    const canvas = canvasRef.current!;
    const pane = paneRef.current;
    if (!pane) return;

    let rafId = 0;
    const schedule = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => { rafId = 0; paint(); });
    };

    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = pane.clientWidth, h = pane.clientHeight;
      const pw = Math.max(1, Math.round(w * dpr)), ph = Math.max(1, Math.round(h * dpr));
      if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      schedule();
    };
    fit();

    const ro = new ResizeObserver(fit);
    ro.observe(pane);

    let offView = chartRef.current?.onViewChange(schedule) ?? (() => {});
    const unregister = registerChart(() => schedule()); // theme change → appear/disappear + recolour

    // Live-update poll: repaint when the bar set changes (new/forming bar, scroll-load) or
    // the forming bar's close moves (so the live cat's ears track the growing candle). Cheap
    // length + endpoints + last-close compare — and only while a kitty theme is active.
    let lastLen = -1, lastFirst = -1, lastLast = -1, lastClose = NaN;
    let running = true;
    const pollFrame = () => {
      if (!running) return;
      if (kittyActive()) {
        const c = chartRef.current;
        if (c) {
          const bars = c.getBarsSnapshot();
          const n = bars.length;
          const ft = n ? bars[0]!.time : -1;
          const lt = n ? bars[n - 1]!.time : -1;
          const lc = n ? bars[n - 1]!.close : NaN;
          if (n !== lastLen || ft !== lastFirst || lt !== lastLast || lc !== lastClose) {
            lastLen = n; lastFirst = ft; lastLast = lt; lastClose = lc;
            schedule();
          }
        }
      }
      requestAnimationFrame(pollFrame);
    };
    requestAnimationFrame(pollFrame);

    /** The typical bar spacing in px (uniform on LWC) — median of consecutive x-gaps. */
    function spacingOf(xs: (number | null)[]): number {
      const diffs: number[] = [];
      for (let i = 1; i < xs.length; i++) {
        const a = xs[i - 1], b = xs[i];
        if (a != null && b != null) { const d = b - a; if (d > 0.5) diffs.push(d); }
      }
      if (!diffs.length) return 0;
      diffs.sort((p, q) => p - q);
      return diffs[Math.floor(diffs.length / 2)]!;
    }

    /** One cat: ears on the body top, and (when wide+tall enough) a wee face. The body is
     *  the candle body the user already sees; we only paint the cute bits over it. */
    function kitty(ctx: CanvasRenderingContext2D, x: number, yTop: number, yBot: number, spacing: number, color: string, halo: string, eye: string) {
      const bodyHalfW = Math.max(2, Math.min(spacing * 0.34, 22));
      const earH = Math.max(3, Math.min(spacing * 0.36, 18));
      const earBaseInner = bodyHalfW * 0.18;
      const earApexInset = bodyHalfW * 0.55;

      // ── Ears: two triangles standing on the body's top edge, color-matched to the
      //    candle, with a thin halo so they separate from the wick + each other. ──────
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.lineWidth = 1;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(x + s * bodyHalfW, yTop);              // outer base (body corner)
        ctx.lineTo(x + s * earBaseInner, yTop);           // inner base
        ctx.lineTo(x + s * earApexInset, yTop - earH);    // apex (up)
        ctx.closePath();
        ctx.strokeStyle = halo;
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.fill();
      }
      ctx.restore();

      // ── Face: only when there is room to read it (zoomed in + a tall-enough body). ──
      const bodyH = yBot - yTop;
      if (spacing >= MIN_SPACING_FACE && bodyH >= MIN_BODY_FACE) {
        const cy = yTop + bodyH * 0.42;                   // eye row
        const eyeDx = bodyHalfW * 0.42;
        const r = Math.max(1, Math.min(spacing * 0.05, 2.4));
        ctx.save();
        ctx.fillStyle = eye;
        for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(x + s * eyeDx, cy, r, 0, Math.PI * 2); ctx.fill(); }
        // Nose — a tiny downward triangle just below the eyes.
        const ny = cy + bodyH * 0.16;
        ctx.beginPath();
        ctx.moveTo(x - r, ny); ctx.lineTo(x + r, ny); ctx.lineTo(x, ny + r); ctx.closePath();
        ctx.fill();
        // Whiskers — two thin strokes each side from near the nose.
        ctx.strokeStyle = eye;
        ctx.globalAlpha = 0.65;
        ctx.lineWidth = 1;
        const wl = bodyHalfW * 1.05;
        for (const s of [-1, 1]) {
          ctx.beginPath(); ctx.moveTo(x + s * r * 1.4, ny); ctx.lineTo(x + s * wl, ny - r); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(x + s * r * 1.4, ny + r * 0.6); ctx.lineTo(x + s * wl, ny + r * 1.6); ctx.stroke();
        }
        ctx.restore();
      }
    }

    function paint() {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const W = canvas.clientWidth, H = canvas.clientHeight;
      ctx.clearRect(0, 0, W, H);
      if (!kittyActive()) return;          // not a kitty theme → no-op (cheap)
      const c = chartRef.current;
      if (!c) return;

      const bars = c.getBarsSnapshot();
      if (bars.length < 2) return;
      const tokens = getActiveTokens();
      const upC = tokens.upBody, downC = tokens.downBody;
      const halo = tokens.chartBg;          // ear outline — the canvas colour, to cut out from the wick
      const eye = tokens.bg;                // eyes/nose/whiskers — the darkest surface, reads on pastel bodies

      // Project all bar x's once (uniform spacing → derive bar width from the gaps).
      const xs: (number | null)[] = bars.map((b) => c.timeToCoordinate(b.time));
      const spacing = spacingOf(xs);
      if (spacing < MIN_SPACING_EARS) return; // too dense → leave plain candles (no mush)

      for (let i = 0; i < bars.length; i++) {
        const x = xs[i];
        if (x == null || x < -spacing || x > W + spacing) continue; // off-screen
        const b = bars[i]!;
        const yTop = c.priceToCoordinate(Math.max(b.open, b.close));
        const yBot = c.priceToCoordinate(Math.min(b.open, b.close));
        if (yTop == null || yBot == null) continue;
        const color = b.close >= b.open ? upC : downC;
        kitty(ctx, x, yTop, yBot, spacing, color, halo, eye);
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

  // Transparent to pointer events; above the chart canvas, below the trade overlay (z2)
  // and the drawing overlay (z3).
  return (
    <canvas
      ref={canvasRef}
      className="kitty-layer"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1 }}
    />
  );
}
