/**
 * SessionBreaks — MT5 "period separators": thin vertical lines drawn over the chart at
 * period boundaries (a new trading DAY on intraday timeframes; a new WEEK on daily; a
 * new MONTH on weekly+), with a very subtle shading alternation between sessions.
 *
 * It is a READ-ONLY, transparent canvas overlay inside `.chart-pane` — it depends on
 * NOTHING from the drawing engine. It consumes only the additive ChartHandle accessors
 * (`getBarsSnapshot()` for bar times, `timeToCoordinate()` for x, `onViewChange()` to
 * repaint on pan/zoom) and a ResizeObserver on the pane. It NEVER touches the data
 * pipeline. `pointer-events:none`, so it never blocks scroll/zoom/crosshair, and it
 * sits BEHIND the drawing overlay + countdown (low z-index).
 *
 * Colours come from the active theme tokens (`getActiveTokens()`) by default, so the
 * separators recolour with the palette — unless an explicit `chart.sessionBreaks.color`
 * override is set.
 *
 * Configured via the app settings (`chart.sessionBreaks`, Item 13): `enabled` gates the
 * whole overlay; `color`/`style` style the separator lines; `showSessions` toggles the
 * faint alternating session-band tint. (Replaces the old localStorage `tat.sessionBreaks`
 * toggle.) The mount surface in ChartPane passes no chart scope key, so the GLOBAL value
 * is read here via `useSetting`; per-chart overrides + the "Apply to all charts" action
 * are managed from the Settings page (and fold into the global value via that action).
 */

import { useEffect, useRef } from 'react';
import type { ChartBar } from '../../shared/types';
import { getActiveTokens, registerChart } from '../theme/chartRegistry';
import { useSetting } from '../settings/hooks';
import { isColorOverrideSet, type SessionBreaksSettings } from '../../shared/settingsSchema';

/** The minimal chart surface the overlay reads — a subset of ChartHandle the parent
 *  wires from its internal chartRef (additive; no pipeline change). */
export interface BreaksChart {
  getBarsSnapshot(): ChartBar[];
  timeToCoordinate(time: number): number | null;
  onViewChange(cb: () => void): () => void;
}

interface Props {
  /** The pane element the overlay sizes itself to (`.chart-pane`, position:relative). */
  paneRef: React.RefObject<HTMLDivElement | null>;
  /** Live chart accessors (a subset of ChartHandle) — null until the chart mounts. */
  chart: BreaksChart | null;
  /** Seconds per bar for the active timeframe (TF_SECONDS[tf]) — selects the boundary
   *  granularity (day / week / month). */
  tfSec: number;
}

/** Map the configured line style to a canvas dash pattern (in CSS px, scaled to the
 *  line width so dashes look right at any width). Solid → no dash. */
function dashFor(style: SessionBreaksSettings['style'], lineWidth: number): number[] {
  if (style === 'dashed') return [Math.max(3, lineWidth * 4), Math.max(3, lineWidth * 3)];
  if (style === 'dotted') return [lineWidth, Math.max(2, lineWidth * 2)];
  return []; // solid
}

const DAY = 86400;
const WEEK = 604800;

/** UTC day number (days since the epoch) of an epoch second. */
const dayOf = (t: number) => Math.floor(t / DAY);
/** ISO-week bucket (increments on Mondays). Epoch day 0 is a Thursday (getUTCDay()=4);
 *  `(dayNum + 3) / 7` floors to a bucket that rolls over on each Monday. */
const weekOf = (t: number) => Math.floor((dayOf(t) + 3) / 7);
/** Calendar-month bucket (year*12 + month) in UTC. */
const monthOf = (t: number) => { const d = new Date(t * 1000); return d.getUTCFullYear() * 12 + d.getUTCMonth(); };

/** The period bucket for the active granularity. Intraday → day; daily → week;
 *  weekly+ → month. A boundary is a bar whose bucket differs from the previous bar's. */
function bucketFn(tfSec: number): (t: number) => number {
  if (tfSec < DAY) return dayOf;     // intraday → new trading DAY (UTC midnight)
  if (tfSec < WEEK) return weekOf;   // daily   → new WEEK (Monday)
  return monthOf;                    // weekly+ → new MONTH
}

export function SessionBreaks({ paneRef, chart, tfSec }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<BreaksChart | null>(chart);
  chartRef.current = chart;
  const tfRef = useRef(tfSec);
  tfRef.current = tfSec;

  // The live session-breaks config (GLOBAL value — the mount surface has no chart scope
  // key). Kept in a ref so the rAF `paint()` closure always reads the latest without
  // re-running the heavy effect; a settings change re-renders and re-schedules a paint.
  const [cfg] = useSetting<SessionBreaksSettings | undefined>('chart.sessionBreaks');
  const cfgRef = useRef<SessionBreaksSettings | undefined>(cfg);
  cfgRef.current = cfg;
  // Re-render on cfg change → this effect's scheduleRef repaints with the new style.
  const scheduleRef = useRef<() => void>(() => {});
  useEffect(() => { scheduleRef.current(); }, [cfg]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const pane = paneRef.current;
    if (!pane) return;

    // rAF coalescer — many triggers (pan/zoom, live-append poll, resize, theme, settings)
    // → one paint.
    let rafId = 0;
    const schedule = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => { rafId = 0; paint(); });
    };
    // Expose to the component-level effect so a settings change repaints (without
    // re-running this heavy effect / re-binding observers).
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

    // Live-append / scroll-load detector. LWC exposes no "data changed" event, so we
    // poll once per frame: when the bar count or the first/last bar's time changes (a
    // new forming bar, a scroll-load prepend) the separators must re-place. Cheap — a
    // length + endpoints compare (no per-frame projection).
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
        if (n !== lastLen || ft !== lastFirst || lt !== lastLast) {
          lastLen = n; lastFirst = ft; lastLast = lt;
          schedule();
        }
      }
      requestAnimationFrame(pollFrame);
    };
    requestAnimationFrame(pollFrame);

    function paint() {
      const c = chartRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const W = canvas.clientWidth, H = canvas.clientHeight;
      ctx.clearRect(0, 0, W, H);
      // `enabled` defaults ON when the config hasn't hydrated yet (undefined) — keeps the
      // unchanged default behaviour before the store first loads. Only an explicit
      // `enabled:false` hides the overlay.
      const cfg = cfgRef.current;
      if (!c || cfg?.enabled === false) return;

      const bars = c.getBarsSnapshot();
      if (bars.length < 2) return;
      const bucket = bucketFn(tfRef.current);

      const tokens = getActiveTokens();
      // Separator colour: an explicit override (non-empty string) wins; else the theme
      // token (a hairline a touch stronger than grid). Session tint always tracks fg.
      const line = isColorOverrideSet(cfg?.color) ? cfg!.color! : tokens.line2;
      const shade = tokens.fg;     // subtle session-alternation tint (very low alpha)
      const showSessions = cfg?.showSessions !== false; // default ON unless turned off
      const dash = dashFor(cfg?.style, 1);

      // Walk bars left→right; a boundary bar is one whose bucket differs from the prev.
      // Draw a vertical separator at the boundary bar's x, and shade alternate sessions
      // (between consecutive boundaries) with a faint tint. Only bars currently on
      // screen (a valid x) contribute, so this stays cheap and view-local.
      let prevBucketVal = bucket(bars[0]!.time);
      let sessionParity = (prevBucketVal & 1) === 0; // alternate shading by bucket parity
      let bandStartX: number | null = 0; // left edge of the current session band

      ctx.save();
      for (let i = 1; i < bars.length; i++) {
        const b = bars[i]!;
        const bv = bucket(b.time);
        if (bv === prevBucketVal) continue;
        // A boundary between bar i-1 and bar i → the separator sits at bar i's x.
        const x = c.timeToCoordinate(b.time);
        prevBucketVal = bv;
        if (x === null) continue; // off-screen boundary → skip (still advances the bucket)

        // Shade the session band that just ENDED (from its start x to this boundary x).
        if (showSessions && sessionParity && bandStartX !== null) {
          const x0 = Math.max(0, Math.min(bandStartX, x));
          const x1 = Math.min(W, Math.max(bandStartX, x));
          if (x1 > x0) {
            ctx.globalAlpha = 0.035;
            ctx.fillStyle = shade;
            ctx.fillRect(x0, 0, x1 - x0, H);
          }
        }
        sessionParity = !sessionParity;
        bandStartX = x;

        // The separator line (honouring the configured line style via a dash pattern).
        const px = Math.round(x) + 0.5; // crisp 1px line
        ctx.globalAlpha = 0.55;
        ctx.strokeStyle = line;
        ctx.lineWidth = 1;
        ctx.setLineDash(dash);
        ctx.beginPath();
        ctx.moveTo(px, 0);
        ctx.lineTo(px, H);
        ctx.stroke();
      }
      ctx.setLineDash([]); // restore solid for any later draws
      // Shade the trailing band (from the last boundary to the right edge) if it's a
      // shaded parity, so the alternation continues to the live edge.
      if (showSessions && sessionParity && bandStartX !== null) {
        const x0 = Math.max(0, bandStartX);
        if (W > x0) { ctx.globalAlpha = 0.035; ctx.fillStyle = shade; ctx.fillRect(x0, 0, W - x0, H); }
      }
      ctx.restore();
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
  // sits BEHIND the drawing overlay (zIndex 3) + countdown — a low z-index.
  return (
    <canvas
      ref={canvasRef}
      className="session-breaks"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1 }}
    />
  );
}
