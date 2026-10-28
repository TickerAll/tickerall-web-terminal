/**
 * Fibonacci retracement — two data anchors define the price swing (anchor 0 = the
 * 0.0 level, anchor 1 = the 1.0 level). The standard ratios 0/0.236/0.382/0.5/
 * 0.618/0.786/1 are drawn as horizontal lines across the plot at the interpolated
 * prices, each labelled with its ratio + price. The level y's are linearly
 * interpolated between the two anchor y's (so the lines stay glued through pan/zoom
 * exactly as the anchors do).
 *
 * Two square handles on the anchors (drag either to re-scale the swing); body-drag
 * (anywhere near a level line, picked up by the overlay) moves the whole tool.
 */

import {
  type DrawingTool, type HitResult, registerTool,
  drawHandle, applyStroke, dist2, HANDLE_GRAB, BODY_GRAB,
} from './registry';
import type { PixelPoint } from '../CoordinateProjector';

/** Standard retracement ratios (0 → 1). */
export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;

/** The y of each fib level, interpolated between the two anchor y's. */
function levelYs(a: PixelPoint, b: PixelPoint): number[] {
  return FIB_LEVELS.map((r) => a.y + (b.y - a.y) * r);
}

export const fibRetracementTool: DrawingTool = {
  kind: 'fib-retracement',
  pointCount: 2,

  render(ctx, pixels, style, selected, env) {
    if (pixels.length < 2) return;
    const [a, b] = pixels as [PixelPoint, PixelPoint];
    const w = env?.width ?? 1e4;
    const ys = levelYs(a, b);
    ctx.save();
    ctx.globalAlpha = style.opacity ?? 1;
    // The two vertical guide rails at the anchors' x's, faint, so the swing is visible.
    ctx.strokeStyle = style.color;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(a.x, ys[0]!); ctx.lineTo(a.x, ys[ys.length - 1]!);
    ctx.moveTo(b.x, ys[0]!); ctx.lineTo(b.x, ys[ys.length - 1]!);
    ctx.stroke();
    ctx.setLineDash([]);
    // Each level line + label.
    ctx.font = '10px system-ui, sans-serif';
    ctx.textBaseline = 'bottom';
    for (let i = 0; i < FIB_LEVELS.length; i++) {
      const y = ys[i]!;
      ctx.beginPath();
      ctx.lineWidth = style.width;
      ctx.strokeStyle = style.color;
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      ctx.fillStyle = style.color;
      ctx.fillText(FIB_LEVELS[i]!.toFixed(3), 2, y - 1.5);
    }
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
    // body = near any level line (full-width), within tol vertically.
    for (const y of levelYs(a, b)) if (Math.abs(mouse.y - y) <= BODY_GRAB + tol) return { kind: 'body' };
    return null;
  },
};

registerTool(fibRetracementTool);
