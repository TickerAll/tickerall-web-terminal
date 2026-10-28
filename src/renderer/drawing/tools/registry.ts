/**
 * The tool contract + geometry helpers the whole drawing tool-family plugs into.
 *
 * A `DrawingTool` knows three things about ONE `DrawingKind`:
 *   - `render(ctx, pixels, style, selected)` — paint it from already-projected
 *     pixel points (the overlay does data→pixel projection; the tool never touches
 *     the chart);
 *   - `hitTest(pixels, mouse)` — what the mouse is over (a handle index, the body,
 *     or nothing) for selection + drag;
 *   - `handles(pixels)` — the draggable handle positions (for painting + hit).
 *
 * Keeping projection OUT of the tool (it receives pixels) is what makes a tool a
 * pure, testable function and lets every tool share the same overlay/projector/FSM.
 * The slice registers `trendline`; new tools register here without touching the
 * overlay.
 */

import type { DrawingKind, DrawingStyle } from '../types';
import type { PixelPoint } from '../CoordinateProjector';

/** What the pointer is over within a drawing. */
export type HitResult =
  | { kind: 'handle'; index: number }  // a draggable endpoint (point index)
  | { kind: 'body' }                   // the line/shape body (move-whole)
  | null;                              // nothing

/**
 * Paint-time environment passed to a tool's `render`/`hitTest`. The overlay
 * projects anchors → pixels (so a tool never touches the chart); the few tools that
 * draw to the PLOT EDGE — horizontal/vertical/ray/extended lines, fib level lines —
 * also need the plot rectangle to extend + clip against. Trendline ignores it, so
 * the param is optional and back-compatible with the slice's tool.
 */
export interface RenderEnv {
  /** Plot width/height in CSS px (the canvas client size). */
  width: number;
  height: number;
  /** Y-pixel → price (LWC `coordinateToPrice`, calibrated). Position/pattern tools
   *  read the price at a handle to label entry/SL/TP + size a trade. Optional so the
   *  line/shape tools and unit tests (which render from bare pixels) ignore it. */
  priceAt?: (y: number) => number | null;
  /** Trade context for the position tools' risk/reward sizing. Everything optional;
   *  a tool degrades to ratio-only labels when a field is absent. */
  trade?: TradeContext;
}

/** Per-symbol trade context the position tools size against. All optional — the
 *  tool shows the R:R + price distances without it, and adds the money/lots labels
 *  when present. Sourced from outside the engine (ChartPane → DrawingLayer prop). */
export interface TradeContext {
  /** Symbol point size (e.g. 0.0001 for a 4-digit FX pair). */
  point?: number;
  /** Account-currency value of one point per 1.0 lot (a.k.a. tick value scaled). */
  tickValue?: number;
  /** Contract size (units per lot, e.g. 100000). Reserved for unit display. */
  contractSize?: number;
  /** Account balance (for a risk-% readout). */
  balance?: number;
  /** Live bid/ask (reserved; the tools size from the drawing's own handles). */
  bid?: number;
  ask?: number;
}

export interface DrawingTool {
  kind: DrawingKind;
  /** Anchors required before the drawing is complete (e.g. trendline = 2). */
  pointCount: number;
  /** Paint from projected pixels. `selected` draws the handles. `env` carries the
   *  plot rect for edge-spanning tools (optional; older tools ignore it). */
  render(
    ctx: CanvasRenderingContext2D,
    pixels: PixelPoint[],
    style: ResolvedStyle,
    selected: boolean,
    env?: RenderEnv,
  ): void;
  /** Hit-test the pointer against this drawing's pixels. `tol` = pixel slop. `env`
   *  carries the plot rect (edge-spanning tools hit-test against the drawn line);
   *  `style` is the resolved style (the text tool sizes its hit-box from it). */
  hitTest(pixels: PixelPoint[], mouse: PixelPoint, tol: number, env?: RenderEnv, style?: ResolvedStyle): HitResult;
  /** The draggable handle positions (usually == the anchor pixels). */
  handles(pixels: PixelPoint[]): PixelPoint[];
}

/** A style with all CSS-var references already resolved to literal colours. */
export interface ResolvedStyle extends DrawingStyle {
  color: string;
  width: number;
}

// ── geometry helpers (pure) ────────────────────────────────────────────────────

/** Squared distance — avoids a sqrt in hot hit-test loops. */
export function dist2(a: PixelPoint, b: PixelPoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/**
 * Shortest distance from point `p` to the segment `a→b`, in pixels. Used for
 * body hit-testing (is the mouse within `tol` px of the line?). Handles the
 * degenerate zero-length segment (a==b) gracefully.
 */
export function distToSegment(p: PixelPoint, a: PixelPoint, b: PixelPoint): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  if (len2 < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
  // projection parameter t of p onto the segment, clamped to [0,1]
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = a.x + t * vx;
  const cy = a.y + t * vy;
  return Math.hypot(p.x - cx, p.y - cy);
}

/** Half-size of a square selection handle, in CSS px. Shared by every tool so
 *  handles look + grab identically across the tool family. */
export const HANDLE_HALF = 4;
/** Hit slop for grabbing a handle (a touch larger than the visual, for easy grab). */
export const HANDLE_GRAB = HANDLE_HALF + 3;
/** Hit slop for grabbing a line/shape body. */
export const BODY_GRAB = 5;

/** Draw a white-filled, coloured-outline square selection handle at `p`. */
export function drawHandle(ctx: CanvasRenderingContext2D, p: PixelPoint, color: string): void {
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.rect(p.x - HANDLE_HALF, p.y - HANDLE_HALF, HANDLE_HALF * 2, HANDLE_HALF * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** Apply the common stroke style (colour, width, dash, opacity, round caps). The
 *  caller still issues the path; this just configures `ctx`. Pair with ctx.save/restore. */
export function applyStroke(ctx: CanvasRenderingContext2D, style: ResolvedStyle): void {
  ctx.globalAlpha = style.opacity ?? 1;
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const dash = dashOf(style);
  ctx.setLineDash(dash);
}

/**
 * Draw a filled arrowhead at `tip`, pointing along the direction from `from`→`tip`.
 * `size` is the head length in CSS px; the head scales sensibly for small arrows
 * (it never exceeds ~⅓ of the shaft so a tiny arrow still reads as an arrow, not a
 * blob). Used by the arrow tool. Configures its own fill; pair with save/restore.
 */
export function drawArrowHead(
  ctx: CanvasRenderingContext2D, from: PixelPoint, tip: PixelPoint, color: string, size: number,
): void {
  const dx = tip.x - from.x;
  const dy = tip.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return;
  // Cap the head at a third of the shaft so short arrows don't become all-head.
  const head = Math.max(4, Math.min(size, len / 3));
  const ux = dx / len;
  const uy = dy / len;
  // Two barbs at ±28° from the shaft.
  const wing = head * 0.55;
  const bx = tip.x - ux * head;
  const by = tip.y - uy * head;
  // perpendicular
  const px = -uy;
  const py = ux;
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(bx + px * wing, by + py * wing);
  ctx.lineTo(bx - px * wing, by - py * wing);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** A small text chip (rounded background + label) anchored at `(x, y)` by `align`
 *  ('left'|'center'|'right') and `vAlign` ('top'|'middle'|'bottom'). Theme-agnostic
 *  — the caller passes resolved colours. Used for fib/position/pattern labels so the
 *  text stays legible over candles. */
export function drawChip(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, text: string,
  opts: { bg: string; fg: string; align?: 'left' | 'center' | 'right'; vAlign?: 'top' | 'middle' | 'bottom'; font?: number; alpha?: number } = { bg: '#000', fg: '#fff' },
): void {
  const font = opts.font ?? 10;
  ctx.save();
  ctx.font = `${font}px system-ui, sans-serif`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  const padX = 4;
  const padY = 2;
  const w = ctx.measureText(text).width + padX * 2;
  const h = font + padY * 2;
  let bx = x;
  if (opts.align === 'center') bx = x - w / 2;
  else if (opts.align === 'right') bx = x - w;
  let by = y;
  if (opts.vAlign === 'middle') by = y - h / 2;
  else if (opts.vAlign === 'bottom') by = y - h;
  ctx.globalAlpha = opts.alpha ?? 0.92;
  ctx.fillStyle = opts.bg;
  roundRectPath(ctx, bx, by, w, h, 3);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = opts.fg;
  ctx.fillText(text, bx + padX, by + padY);
  ctx.restore();
}

/** Trace a rounded-rectangle path (no fill/stroke — the caller issues those). A
 *  local helper so tools don't depend on the (non-universally-supported) ctx.roundRect. */
export function roundRectPath(
  ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number,
): void {
  const rr = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

/** Shortest distance from `p` to a polyline (a sequence of connected segments), in
 *  CSS px. Used by the multi-point pattern + freehand tools for body hit-testing.
 *  Returns Infinity for a <2-point path. */
export function distToPolyline(p: PixelPoint, pts: PixelPoint[]): number {
  if (pts.length < 2) return pts.length === 1 ? Math.hypot(p.x - pts[0]!.x, p.y - pts[0]!.y) : Infinity;
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const d = distToSegment(p, pts[i - 1]!, pts[i]!);
    if (d < best) best = d;
  }
  return best;
}

/** The dash pattern for a resolved style (named lineStyle → pattern, explicit dash wins). */
export function dashOf(style: ResolvedStyle): number[] {
  if (style.dash && style.dash.length) return style.dash;
  const w = Math.max(1, style.width);
  switch (style.lineStyle) {
    case 'dashed': return [Math.max(4, w * 3), Math.max(3, w * 2)];
    case 'dotted': return [Math.max(1, w), Math.max(2, w * 1.6)];
    default: return [];
  }
}

/**
 * Extend the segment a→b in BOTH directions far past the plot, then return the
 * portion inside [0,width]×[0,height] (for an "extended" line through two anchors).
 * `dir`: 'both' = infinite line, 'forward' = ray from a through b (a→∞), 'back' =
 * ray from b through a. Returns null if it misses the plot.
 */
export function extendThroughPlot(
  a: PixelPoint, b: PixelPoint, width: number, height: number,
  dir: 'both' | 'forward' | 'back',
): [PixelPoint, PixelPoint] | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return null;
  // A length that always over-shoots the plot diagonal.
  const big = (Math.abs(width) + Math.abs(height)) * 4 + 1e4;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  // start/end of the un-clipped line per direction.
  const p0 = dir === 'forward' ? a : { x: a.x - ux * big, y: a.y - uy * big };
  const p1 = dir === 'back' ? a : { x: b.x + ux * big, y: b.y + uy * big };
  return clipLB(p0, p1, width, height);
}

/** Liang–Barsky clip of a segment to [0,width]×[0,height] (local copy so tools
 *  don't import the projector). Returns the clipped endpoints or null. */
function clipLB(a: PixelPoint, b: PixelPoint, width: number, height: number): [PixelPoint, PixelPoint] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const p = [-dx, dx, -dy, dy];
  const q = [a.x - 0, width - a.x, a.y - 0, height - a.y];
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]!) < 1e-9) { if (q[i]! < 0) return null; }
    else {
      const r = q[i]! / p[i]!;
      if (p[i]! < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
      else { if (r < t0) return null; if (r < t1) t1 = r; }
    }
  }
  return [
    { x: a.x + t0 * dx, y: a.y + t0 * dy },
    { x: a.x + t1 * dx, y: a.y + t1 * dy },
  ];
}

/** Registry of tools by kind. The overlay looks tools up here. */
const TOOLS = new Map<DrawingKind, DrawingTool>();

export function registerTool(tool: DrawingTool): void {
  TOOLS.set(tool.kind, tool);
}

export function getTool(kind: DrawingKind): DrawingTool | undefined {
  return TOOLS.get(kind);
}

/** Every registered tool (for the toolbar to enumerate). */
export function allTools(): DrawingTool[] {
  return [...TOOLS.values()];
}
