/**
 * Vertical line — a single time anchor drawn as a full-height line across the plot
 * at that bar's x. The anchor's PRICE is irrelevant (it spans the whole height) but
 * is kept so the handle has a stable y. One data anchor; projection-free render/
 * hit-test; one square handle near the vertical centre of the plot.
 */

import {
  type DrawingTool, type HitResult, registerTool,
  drawHandle, applyStroke, HANDLE_GRAB, BODY_GRAB, dist2,
} from './registry';
import type { PixelPoint } from '../CoordinateProjector';

export const vlineTool: DrawingTool = {
  kind: 'vline',
  pointCount: 1,

  render(ctx, pixels, style, selected, env) {
    if (pixels.length < 1) return;
    const x = pixels[0]!.x;
    const h = env?.height ?? 1e4;
    ctx.save();
    applyStroke(ctx, style);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
    ctx.restore();
    if (selected) drawHandle(ctx, { x, y: pixels[0]!.y }, style.color);
  },

  handles(pixels) {
    return pixels.slice(0, 1);
  },

  hitTest(pixels, mouse, tol): HitResult {
    if (pixels.length < 1) return null;
    const x = pixels[0]!.x;
    const grab2 = (HANDLE_GRAB + tol) * (HANDLE_GRAB + tol);
    if (dist2(mouse, pixels[0]!) <= grab2) return { kind: 'handle', index: 0 };
    if (Math.abs(mouse.x - x) <= BODY_GRAB + tol) return { kind: 'body' };
    return null;
  },
};

registerTool(vlineTool);
