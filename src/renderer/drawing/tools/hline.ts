/**
 * Horizontal line — a single price anchor drawn as a full-width line across the
 * plot at that price. The anchor's TIME is irrelevant to the line (it spans the
 * whole chart), but it's kept so the one handle has a stable x to grab and the
 * object survives a pan unchanged. Mirrors the trendline tool's shape: one data
 * anchor, projection-free render/hit-test, one square handle.
 */

import {
  type DrawingTool, type HitResult, registerTool,
  drawHandle, applyStroke, HANDLE_GRAB, BODY_GRAB, dist2,
} from './registry';
import type { PixelPoint } from '../CoordinateProjector';

export const hlineTool: DrawingTool = {
  kind: 'hline',
  pointCount: 1,

  render(ctx, pixels, style, selected, env) {
    if (pixels.length < 1) return;
    const y = pixels[0]!.y;
    const w = env?.width ?? 1e4;
    ctx.save();
    applyStroke(ctx, style);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
    ctx.restore();
    if (selected) drawHandle(ctx, { x: pixels[0]!.x, y }, style.color);
  },

  handles(pixels) {
    return pixels.slice(0, 1);
  },

  hitTest(pixels, mouse, tol): HitResult {
    if (pixels.length < 1) return null;
    const y = pixels[0]!.y;
    const grab2 = (HANDLE_GRAB + tol) * (HANDLE_GRAB + tol);
    if (dist2(mouse, pixels[0]!) <= grab2) return { kind: 'handle', index: 0 };
    if (Math.abs(mouse.y - y) <= BODY_GRAB + tol) return { kind: 'body' };
    return null;
  },
};

registerTool(hlineTool);
