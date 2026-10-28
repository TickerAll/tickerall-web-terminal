/**
 * Brush (free draw) — an N-point freehand stroke. Unlike the click-placed tools, the
 * overlay's 'freehand' placing mode collects the points during a single press-drag
 * (sampled every few px) and finishes on release; this tool just renders the
 * resulting polyline (smoothed with quadratic midpoints) and hit-tests along it.
 *
 * Handles: only the two ENDPOINTS are draggable (dragging every one of dozens of
 * sampled points would be unusable); body-drag moves the whole stroke.
 */

import {
  type DrawingTool, type HitResult, registerTool,
  drawHandle, applyStroke, dist2, distToPolyline, HANDLE_GRAB, BODY_GRAB,
} from './registry';
import type { PixelPoint } from '../CoordinateProjector';

/** Trace a smooth path through the points using quadratic curves between segment
 *  midpoints (Catmull-Rom-ish without overshoot). For 2 points it's a straight line.
 *  Exported so the marker/highlighter freehand variants share the identical smoothing. */
export function smoothPath(ctx: CanvasRenderingContext2D, pts: PixelPoint[]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  if (pts.length === 2) { ctx.lineTo(pts[1]!.x, pts[1]!.y); return; }
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i]!.x + pts[i + 1]!.x) / 2;
    const my = (pts[i]!.y + pts[i + 1]!.y) / 2;
    ctx.quadraticCurveTo(pts[i]!.x, pts[i]!.y, mx, my);
  }
  const last = pts[pts.length - 1]!;
  ctx.lineTo(last.x, last.y);
}

export const brushTool: DrawingTool = {
  kind: 'brush',
  pointCount: 2,

  render(ctx, pixels, style, selected) {
    if (pixels.length < 2) return;
    ctx.save();
    applyStroke(ctx, style);
    ctx.setLineDash([]); // freehand strokes are always solid regardless of lineStyle
    smoothPath(ctx, pixels);
    ctx.stroke();
    ctx.restore();
    if (selected) {
      // only the endpoints are draggable handles.
      drawHandle(ctx, pixels[0]!, style.color);
      drawHandle(ctx, pixels[pixels.length - 1]!, style.color);
    }
  },

  /** Only the two endpoints (indices 0 and N-1) are draggable. */
  handles(pixels) {
    if (pixels.length < 2) return pixels.slice();
    return [pixels[0]!, pixels[pixels.length - 1]!];
  },

  hitTest(pixels, mouse, tol): HitResult {
    if (pixels.length < 2) return null;
    const grab2 = (HANDLE_GRAB + tol) * (HANDLE_GRAB + tol);
    // endpoints map back to their real indices (0 and N-1) so the overlay drags them.
    if (dist2(mouse, pixels[0]!) <= grab2) return { kind: 'handle', index: 0 };
    if (dist2(mouse, pixels[pixels.length - 1]!) <= grab2) return { kind: 'handle', index: pixels.length - 1 };
    if (distToPolyline(mouse, pixels) <= BODY_GRAB + tol) return { kind: 'body' };
    return null;
  },
};

registerTool(brushTool);
