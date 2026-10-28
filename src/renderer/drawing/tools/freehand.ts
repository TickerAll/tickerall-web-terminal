/**
 * Marker + Highlighter — freehand-stroke siblings of the brush (the "pencil"). They share
 * the brush's point-collection (the overlay's 'freehand' placing mode samples the press-
 * drag) and the same midpoint-quadratic smoothing; only the stroke "feel" differs:
 *   - marker      — a bold felt-tip: thicker, opaque, round caps.
 *   - highlighter — a wide translucent band: blends where strokes overlap, flat caps.
 * The user still picks the COLOUR (+ a width that scales the feel); the tool imposes its
 * character so each reads distinctly. Only the two endpoints are draggable (like the brush).
 */

import {
  type DrawingTool, type HitResult, type ResolvedStyle, registerTool,
  drawHandle, dist2, distToPolyline, HANDLE_GRAB, BODY_GRAB,
} from './registry';
import type { PixelPoint } from '../CoordinateProjector';
import type { DrawingKind } from '../types';
import { smoothPath } from './brush';

/** Build a freehand tool with a characteristic stroke: `widthMul`×the style width (floored
 *  at `minWidth`), `alpha` multiplied into the style opacity, and a line `cap`. */
function makeFreehand(kind: DrawingKind, widthMul: number, minWidth: number, alpha: number, cap: CanvasLineCap): DrawingTool {
  const strokeWidth = (s: ResolvedStyle): number => Math.max(s.width * widthMul, minWidth);
  return {
    kind,
    pointCount: 2,
    render(ctx, pixels, style, selected) {
      if (pixels.length < 2) return;
      ctx.save();
      ctx.globalAlpha = (style.opacity ?? 1) * alpha;
      ctx.strokeStyle = style.color;
      ctx.lineWidth = strokeWidth(style);
      ctx.lineCap = cap;
      ctx.lineJoin = 'round';
      ctx.setLineDash([]); // freehand strokes are always solid regardless of lineStyle
      smoothPath(ctx, pixels);
      ctx.stroke();
      ctx.restore();
      if (selected) { // only the endpoints are draggable handles
        drawHandle(ctx, pixels[0]!, style.color);
        drawHandle(ctx, pixels[pixels.length - 1]!, style.color);
      }
    },
    handles(pixels) {
      if (pixels.length < 2) return pixels.slice();
      return [pixels[0]!, pixels[pixels.length - 1]!];
    },
    hitTest(pixels, mouse, tol, _env, style): HitResult {
      if (pixels.length < 2) return null;
      const grab2 = (HANDLE_GRAB + tol) * (HANDLE_GRAB + tol);
      if (dist2(mouse, pixels[0]!) <= grab2) return { kind: 'handle', index: 0 };
      if (dist2(mouse, pixels[pixels.length - 1]!) <= grab2) return { kind: 'handle', index: pixels.length - 1 };
      // The body grab scales with the (thick) stroke so a wide highlighter is easy to hit.
      const half = style ? strokeWidth(style) / 2 : minWidth / 2;
      if (distToPolyline(mouse, pixels) <= Math.max(BODY_GRAB, half) + tol) return { kind: 'body' };
      return null;
    },
  };
}

/** A bold felt-tip marker — 2.5× the style width (≥5px), opaque, round caps. */
export const markerTool = makeFreehand('marker', 2.5, 5, 1, 'round');
/** A wide translucent highlighter — 6× the style width (≥14px), 32% alpha, flat caps. */
export const highlighterTool = makeFreehand('highlighter', 6, 14, 0.32, 'butt');

registerTool(markerTool);
registerTool(highlighterTool);
