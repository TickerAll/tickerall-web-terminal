/**
 * Drawing-engine data model (TERMINAL-ROADMAP area G). The whole tool family
 * (lines, shapes, fibonacci, channels, gann, text, measure …) reuses this shape:
 * a drawing is a `kind` discriminator + an ordered list of data-space anchor points
 * + a style. Anchors live in DATA space — (time seconds, price) — never pixels, so a
 * drawing stays glued to the bars it was placed on through pan / zoom / live-append;
 * the CanvasOverlay re-projects them to pixels every frame.
 *
 * The vertical slice implements `'trendline'` only. The other kinds are reserved in
 * the union so the store, persistence shape, and tool registry don't need to change
 * when the tool families fan out — a new tool adds a `kind` + a renderer/hit-tester,
 * not a new store.
 */

import type { DataPoint } from './CoordinateProjector';

/** Discriminator for every drawing tool. The core tool set is implemented in
 *  `tools/`; a handful of kinds are still reserved for later fan-out (channels,
 *  pitchfork, fib-extension, measure/position tools, callouts). */
export type DrawingKind =
  | 'trendline'
  // ── core tool set (implemented) ──
  | 'ray' | 'extended' | 'hline' | 'vline'
  | 'rect' | 'ellipse'
  | 'fib-retracement'
  | 'text'
  // ── fan-out tools (implemented) ──
  | 'arrow' | 'triangle'
  | 'brush' | 'marker' | 'highlighter'
  | 'emoji'
  | 'head-shoulders' | 'xabcd'
  | 'long-position' | 'short-position'
  // ── reserved for a later fan-out (not yet implemented) ──
  | 'fib-extension'
  | 'channel' | 'pitchfork'
  | 'callout'
  | 'measure';

/** A named line style; maps to a dash pattern at paint time (`dashFor`). The style
 *  row in the toolbar writes this, which is friendlier than a raw dash array. */
export type LineStyle = 'solid' | 'dashed' | 'dotted';

/** Visual style for a drawing. Colours may be a CSS var reference (e.g.
 *  `var(--accent)`) resolved against the live theme at paint time, or a literal. */
export interface DrawingStyle {
  /** Stroke colour (CSS colour or `var(--token)`). */
  color: string;
  /** Stroke width in CSS px. */
  width: number;
  /** Named line style (solid/dashed/dotted). The renderer turns this into a dash
   *  pattern; an explicit `dash` still wins if present (used for previews). */
  lineStyle?: LineStyle;
  /** Line dash pattern in CSS px (empty = solid). Overrides `lineStyle` if set. */
  dash?: number[];
  /** Fill colour for closed shapes (rect/ellipse) and fib bands. */
  fill?: string;
  /** Fill opacity 0..1 for closed shapes (multiplies into the resolved fill). When
   *  set, the renderer applies it to `fill`; absent → the fill's own alpha is used. */
  fillOpacity?: number;
  /** Opacity 0..1 applied to the whole object. */
  opacity?: number;
  /** Text content for the `text` tool (and future callouts). */
  text?: string;
  /** Emoji/sticker character placed by the `emoji` tool (e.g. "🚀"). */
  emoji?: string;
  /** Font size in CSS px for the `text` tool. */
  fontSize?: number;
  /** Font family for the `text` tool (a CSS font-family string, e.g.
   *  `system-ui, sans-serif`). Absent → the tool's default system font. */
  fontFamily?: string;
  /** Risk as a fraction of balance (e.g. 0.01 = 1%) for the long/short position
   *  planner's lot sizing. Absent → the planner's 1% default. */
  riskPct?: number;
}

/** Resolve a named line style → a canvas dash pattern (scaled to stroke width so a
 *  dotted 3px line still reads as dots). Empty array = solid. */
export function dashFor(style: { lineStyle?: LineStyle; dash?: number[]; width: number }): number[] {
  if (style.dash && style.dash.length) return style.dash;
  const w = Math.max(1, style.width);
  switch (style.lineStyle) {
    case 'dashed': return [Math.max(4, w * 3), Math.max(3, w * 2)];
    case 'dotted': return [Math.max(1, w), Math.max(2, w * 1.6)];
    default: return [];
  }
}

/** A single drawing object. Immutable-by-convention: the store replaces it on edit
 *  (so React/`useSyncExternalStore` sees a new reference). */
export interface Drawing {
  id: string;
  kind: DrawingKind;
  /** Ordered data-space anchors. A trendline has exactly two. */
  points: DataPoint[];
  style: DrawingStyle;
  /** Locked drawings ignore hit-testing/drag (reserved; default false). */
  locked?: boolean;
  /** Hidden drawings are not painted (reserved; default false). */
  hidden?: boolean;
  /** Where the object came from (user drawing). */
  source?: 'user';
}

/** The active interaction mode of the drawing layer. */
export type DrawingMode =
  | { type: 'idle' }
  /** A tool is armed: the next click(s) place a new drawing of `kind`. */
  | { type: 'placing'; kind: DrawingKind; /** anchors collected so far */ pending: DataPoint[] }
  /** A freehand stroke is being collected during a single press-drag (brush tool). */
  | { type: 'freehand'; kind: DrawingKind; /** sampled points so far (data space) */ pending: DataPoint[] }
  /** Dragging an existing drawing's handle or body. */
  | {
      type: 'dragging';
      id: string;
      /** which handle (point index), or 'body' to move the whole object. */
      grab: number | 'body';
      /** pointer offset (data-space) captured at grab, for body drags. */
      anchor: DataPoint;
      /** the points at grab-time, so a drag is computed as a delta (no drift). */
      origin: DataPoint[];
    };

/** Kinds whose renderer actually reads `style.fill` (true closed shapes). Fib bands
 *  + pattern polylines stroke with the line colour, so they're NOT fillable. The
 *  toolbar's StyleRow + the ObjectProperties panel both gate the fill control on this. */
export const FILLABLE_KINDS: ReadonlySet<DrawingKind> = new Set<DrawingKind>([
  'rect', 'ellipse', 'triangle', 'text',
]);

/** A text-bearing kind (has editable content / font). */
export function isTextKind(k: DrawingKind): boolean {
  return k === 'text' || k === 'callout';
}

/** A freehand-stroke kind — its points are collected during a single press-drag (the
 *  overlay's 'freehand' placing mode), not click-placed. Brush/marker/highlighter share
 *  the same collection + smoothing; only the stroke "feel" (width/opacity/cap) differs. */
export function isFreehandKind(k: DrawingKind): boolean {
  return k === 'brush' || k === 'marker' || k === 'highlighter';
}

/** A position-planner kind (entry/SL/TP + risk%). */
export function isPositionKind(k: DrawingKind): boolean {
  return k === 'long-position' || k === 'short-position';
}

/** The number of anchor points a kind needs before it's complete. */
export const POINT_COUNT: Partial<Record<DrawingKind, number>> = {
  trendline: 2,
  ray: 2,
  extended: 2,
  hline: 1,
  vline: 1,
  text: 1,
  arrow: 2,
  rect: 2,
  ellipse: 2,
  triangle: 3,
  channel: 3,
  'fib-retracement': 2,
  'fib-extension': 3,
  measure: 2,
  'long-position': 2,
  'short-position': 2,
  // freehand collects its points during the press-drag (see CanvasOverlay's
  // 'freehand' placing mode); the count below is just the minimum to be valid.
  brush: 2,
  marker: 2,
  highlighter: 2,
  emoji: 1,
  // multi-click pattern tools (the generic placement FSM collects N clicks).
  'head-shoulders': 5,
  xabcd: 5,
};
