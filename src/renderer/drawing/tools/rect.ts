/**
 * Rectangle — two diagonal-corner data anchors. Rendered as the axis-aligned box
 * between the projected corners (optional fill + stroked border). The two stored
 * anchors are the draggable corners (handle 0, handle 1); body-drag moves the box.
 *
 * Hit-test: a handle on either corner, else the body when the mouse is near the
 * border (within tol) or — when filled — anywhere inside.
 */

import {
  type DrawingTool, type HitResult, registerTool,
  drawHandle, applyStroke, dist2, distToSegment, HANDLE_GRAB, BODY_GRAB,
} from './registry';
import type { PixelPoint } from '../CoordinateProjector';

/** Min/max corners of the box from the two anchors. */
function box(a: PixelPoint, b: PixelPoint) {
  return { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) };
}

export const rectTool: DrawingTool = {
  kind: 'rect',
  pointCount: 2,

  render(ctx, pixels, style, selected) {
    if (pixels.length < 2) return;
    const [a, b] = pixels as [PixelPoint, PixelPoint];
    const { x0, y0, x1, y1 } = box(a, b);
    ctx.save();
    ctx.globalAlpha = style.opacity ?? 1;
    if (style.fill) { ctx.fillStyle = style.fill; ctx.fillRect(x0, y0, x1 - x0, y1 - y0); }
    applyStroke(ctx, style);
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    ctx.restore();
    if (selected) { drawHandle(ctx, a, style.color); drawHandle(ctx, b, style.color); }
  },

  handles(pixels) {
    return pixels.slice(0, 2);
  },

  hitTest(pixels, mouse, tol): HitResult {
    if (pixels.length < 2) return null;
    const [a, b] = pixels as [PixelPoint, PixelPoint];
    const grab2 = (HANDLE_GRAB + tol) * (HANDLE_GRAB + tol);
    for (let i = 0; i < 2; i++) if (dist2(mouse, pixels[i]!) <= grab2) return { kind: 'handle', index: i };
    const { x0, y0, x1, y1 } = box(a, b);
    // near any of the four edges?
    const corners: PixelPoint[] = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
    for (let i = 0; i < 4; i++) {
      if (distToSegment(mouse, corners[i]!, corners[(i + 1) % 4]!) <= BODY_GRAB + tol) return { kind: 'body' };
    }
    return null;
  },
};

registerTool(rectTool);
