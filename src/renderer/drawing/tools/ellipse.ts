/**
 * Ellipse — inscribed in the bounding box of two diagonal-corner data anchors
 * (the same model as rect). Rendered with `ctx.ellipse`; optional fill + stroked
 * boundary. Handles are the two corner anchors; body-drag moves the whole ellipse.
 *
 * Hit-test: a corner handle, else the body when the mouse is near the ellipse
 * boundary (|r−1| small in normalized space) or — when filled — inside it (r≤1).
 */

import {
  type DrawingTool, type HitResult, registerTool,
  drawHandle, applyStroke, dist2, HANDLE_GRAB, BODY_GRAB,
} from './registry';
import type { PixelPoint } from '../CoordinateProjector';

function geom(a: PixelPoint, b: PixelPoint) {
  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2;
  const rx = Math.abs(a.x - b.x) / 2;
  const ry = Math.abs(a.y - b.y) / 2;
  return { cx, cy, rx, ry };
}

export const ellipseTool: DrawingTool = {
  kind: 'ellipse',
  pointCount: 2,

  render(ctx, pixels, style, selected) {
    if (pixels.length < 2) return;
    const [a, b] = pixels as [PixelPoint, PixelPoint];
    const { cx, cy, rx, ry } = geom(a, b);
    ctx.save();
    ctx.globalAlpha = style.opacity ?? 1;
    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2);
    if (style.fill) { ctx.fillStyle = style.fill; ctx.fill(); }
    applyStroke(ctx, style);
    ctx.stroke();
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
    const { cx, cy, rx, ry } = geom(a, b);
    if (rx < 0.5 || ry < 0.5) return null;
    // normalized radius of the mouse; ~1 on the boundary. hitTest carries no style,
    // so (like rect) we grab on the boundary band rather than the whole interior —
    // enough to select + drag; the body-drag still moves the whole shape.
    const nx = (mouse.x - cx) / rx;
    const ny = (mouse.y - cy) / ry;
    const r = Math.hypot(nx, ny);
    const band = (BODY_GRAB + tol) / Math.min(rx, ry); // px band → normalized units
    if (Math.abs(r - 1) <= band) return { kind: 'body' };
    return null;
  },
};

registerTool(ellipseTool);
