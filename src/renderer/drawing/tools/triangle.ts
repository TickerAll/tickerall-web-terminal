/**
 * Triangle — three data anchors forming a closed triangle (optional fill + stroked
 * border). A chart-pattern primitive (the generic placement FSM collects 3 clicks).
 * Each anchor is a draggable handle; body-drag moves the whole shape.
 *
 * Hit-test: a handle on any vertex, else the body when near any of the three edges
 * (within tol), or — when filled — anywhere inside.
 */

import {
  type DrawingTool, type HitResult, registerTool,
  drawHandle, applyStroke, dist2, distToSegment, HANDLE_GRAB, BODY_GRAB,
} from './registry';
import type { PixelPoint } from '../CoordinateProjector';

/** Even-odd point-in-polygon (for fill hit-testing). */
function inside(p: PixelPoint, poly: PixelPoint[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

export const triangleTool: DrawingTool = {
  kind: 'triangle',
  pointCount: 3,

  render(ctx, pixels, style, selected) {
    if (pixels.length < 3) return;
    const [a, b, c] = pixels as [PixelPoint, PixelPoint, PixelPoint];
    ctx.save();
    ctx.globalAlpha = style.opacity ?? 1;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.closePath();
    if (style.fill) { ctx.fillStyle = style.fill; ctx.fill(); }
    applyStroke(ctx, style);
    ctx.stroke();
    ctx.restore();
    if (selected) for (const p of pixels) drawHandle(ctx, p, style.color);
  },

  handles(pixels) {
    return pixels.slice(0, 3);
  },

  hitTest(pixels, mouse, tol, _env, style): HitResult {
    if (pixels.length < 3) return null;
    const grab2 = (HANDLE_GRAB + tol) * (HANDLE_GRAB + tol);
    for (let i = 0; i < 3; i++) if (dist2(mouse, pixels[i]!) <= grab2) return { kind: 'handle', index: i };
    const poly = pixels.slice(0, 3);
    for (let i = 0; i < 3; i++) {
      if (distToSegment(mouse, poly[i]!, poly[(i + 1) % 3]!) <= BODY_GRAB + tol) return { kind: 'body' };
    }
    // A filled triangle is grabbable anywhere inside; a hollow one only on its edges.
    if (style?.fill && inside(mouse, poly)) return { kind: 'body' };
    return null;
  },
};

registerTool(triangleTool);
