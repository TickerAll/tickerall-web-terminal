/**
 * Extended line — an infinite line through two data anchors, clipped to the plot in
 * both directions (−∞→+∞). Identical to a trendline except the body spans the whole
 * plot rather than ending at the anchors. Two handles on the anchors.
 */

import {
  type DrawingTool, type HitResult, registerTool,
  drawHandle, applyStroke, distToSegment, dist2, HANDLE_GRAB, BODY_GRAB, extendThroughPlot,
} from './registry';
import type { PixelPoint } from '../CoordinateProjector';

export const extendedTool: DrawingTool = {
  kind: 'extended',
  pointCount: 2,

  render(ctx, pixels, style, selected, env) {
    if (pixels.length < 2) return;
    const [a, b] = pixels as [PixelPoint, PixelPoint];
    const w = env?.width ?? 1e4;
    const h = env?.height ?? 1e4;
    const seg = extendThroughPlot(a, b, w, h, 'both');
    ctx.save();
    applyStroke(ctx, style);
    if (seg) { ctx.beginPath(); ctx.moveTo(seg[0].x, seg[0].y); ctx.lineTo(seg[1].x, seg[1].y); ctx.stroke(); }
    ctx.restore();
    if (selected) { drawHandle(ctx, a, style.color); drawHandle(ctx, b, style.color); }
  },

  handles(pixels) {
    return pixels.slice(0, 2);
  },

  hitTest(pixels, mouse, tol, env): HitResult {
    if (pixels.length < 2) return null;
    const [a, b] = pixels as [PixelPoint, PixelPoint];
    const grab2 = (HANDLE_GRAB + tol) * (HANDLE_GRAB + tol);
    for (let i = 0; i < 2; i++) if (dist2(mouse, pixels[i]!) <= grab2) return { kind: 'handle', index: i };
    const w = env?.width ?? 1e4;
    const h = env?.height ?? 1e4;
    const seg = extendThroughPlot(a, b, w, h, 'both');
    if (seg && distToSegment(mouse, seg[0], seg[1]) <= BODY_GRAB + tol) return { kind: 'body' };
    return null;
  },
};

registerTool(extendedTool);
