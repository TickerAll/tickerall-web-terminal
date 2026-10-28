/**
 * Trendline — the reference drawing tool for the slice. Two data-space anchors;
 * rendered as a straight segment between their projected pixels with two square
 * selection handles. Body-drag moves the whole line; handle-drag moves one endpoint.
 *
 * It is intentionally tiny and projection-free: it receives already-projected pixel
 * points from the overlay and draws/hit-tests them. Every other line/shape tool in
 * the fan-out follows this exact shape (see registry.ts).
 */

import {
  type DrawingTool, type HitResult, distToSegment, dist2, registerTool,
  drawHandle, applyStroke, HANDLE_GRAB, BODY_GRAB,
} from './registry';
import type { PixelPoint } from '../CoordinateProjector';
import type { ResolvedStyle } from './registry';

/** Half-size of a square selection handle, in CSS px. Re-exported from the registry
 *  (the shared source of truth) so the overlay/tests keep importing it from here. */
export { HANDLE_HALF } from './registry';

export const trendlineTool: DrawingTool = {
  kind: 'trendline',
  pointCount: 2,

  render(ctx, pixels, style: ResolvedStyle, selected) {
    if (pixels.length < 2) return;
    const [a, b] = pixels as [PixelPoint, PixelPoint];
    ctx.save();
    applyStroke(ctx, style);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
    if (selected) {
      drawHandle(ctx, a, style.color);
      drawHandle(ctx, b, style.color);
    }
  },

  handles(pixels) {
    return pixels.slice(0, 2);
  },

  hitTest(pixels, mouse, tol): HitResult {
    if (pixels.length < 2) return null;
    // Handles first (they sit on top of the body and win ties).
    const grab2 = (HANDLE_GRAB + tol) * (HANDLE_GRAB + tol);
    for (let i = 0; i < 2; i++) {
      if (dist2(mouse, pixels[i]!) <= grab2) return { kind: 'handle', index: i };
    }
    if (distToSegment(mouse, pixels[0]!, pixels[1]!) <= BODY_GRAB + tol) return { kind: 'body' };
    return null;
  },
};

registerTool(trendlineTool);
