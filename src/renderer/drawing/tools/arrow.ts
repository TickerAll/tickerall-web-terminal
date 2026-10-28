/**
 * Arrow — a line from anchor 0 (tail) to anchor 1 (tip), with a filled arrowhead at
 * the tip. Two data anchors like a trendline; the head scales with the stroke width
 * but is capped to a fraction of the shaft so a SMALL arrow still reads as an arrow
 * (not a head-only blob). Both handles sit on the anchors; body-drag moves it whole.
 *
 * Small arrows: the placement FSM creates the drawing on any 2-point completion (no
 * min-drag gate kills it — see CanvasOverlay), so a short drag/click-click produces a
 * tiny arrow; `drawArrowHead` keeps it proportional.
 */

import {
  type DrawingTool, type HitResult, registerTool,
  drawHandle, applyStroke, distToSegment, dist2, drawArrowHead, HANDLE_GRAB, BODY_GRAB,
} from './registry';
import type { PixelPoint } from '../CoordinateProjector';
import type { ResolvedStyle } from './registry';

/** Arrowhead length scales with stroke width (so a thick arrow gets a bigger head). */
function headSize(style: ResolvedStyle): number {
  return Math.max(7, style.width * 4 + 4);
}

export const arrowTool: DrawingTool = {
  kind: 'arrow',
  pointCount: 2,

  render(ctx, pixels, style: ResolvedStyle, selected) {
    if (pixels.length < 2) return;
    const [a, b] = pixels as [PixelPoint, PixelPoint];
    ctx.save();
    applyStroke(ctx, style);
    // Shorten the shaft so it tucks under the head instead of poking through it.
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const head = Math.max(4, Math.min(headSize(style), len / 3));
    const back = Math.max(0, len - head * 0.85);
    const sx = a.x + (dx / len) * back;
    const sy = a.y + (dy / len) * back;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(sx, sy);
    ctx.stroke();
    ctx.setLineDash([]);
    drawArrowHead(ctx, a, b, style.color, headSize(style));
    ctx.restore();
    if (selected) { drawHandle(ctx, a, style.color); drawHandle(ctx, b, style.color); }
  },

  handles(pixels) {
    return pixels.slice(0, 2);
  },

  hitTest(pixels, mouse, tol): HitResult {
    if (pixels.length < 2) return null;
    const grab2 = (HANDLE_GRAB + tol) * (HANDLE_GRAB + tol);
    for (let i = 0; i < 2; i++) if (dist2(mouse, pixels[i]!) <= grab2) return { kind: 'handle', index: i };
    if (distToSegment(mouse, pixels[0]!, pixels[1]!) <= BODY_GRAB + tol) return { kind: 'body' };
    return null;
  },
};

registerTool(arrowTool);
