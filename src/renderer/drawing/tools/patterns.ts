/**
 * Multi-point chart patterns — Head & Shoulders (5 pts) and an XABCD harmonic
 * (5 pts). Both are the same shape: N data anchors connected by a polyline, each
 * vertex carrying a fixed label (LS / H / RS … or X / A / B / C / D) drawn as a
 * small chip. The generic placement FSM collects the N clicks; this module builds
 * one DrawingTool per pattern from a shared factory.
 *
 * Every vertex is a draggable handle; body-drag (near any segment) moves the whole
 * pattern. The labels are positioned just outside the polyline so they don't sit
 * under the line.
 */

import {
  type DrawingTool, type HitResult, registerTool,
  drawHandle, applyStroke, dist2, distToPolyline, drawChip, HANDLE_GRAB, BODY_GRAB,
} from './registry';
import type { PixelPoint } from '../CoordinateProjector';
import type { DrawingKind } from '../types';

/** Build a polyline-pattern tool: `labels[i]` annotates anchor i. */
function makePatternTool(kind: DrawingKind, labels: string[]): DrawingTool {
  const n = labels.length;
  return {
    kind,
    pointCount: n,

    render(ctx, pixels, style, selected) {
      if (pixels.length < n) return;
      ctx.save();
      applyStroke(ctx, style);
      ctx.beginPath();
      ctx.moveTo(pixels[0]!.x, pixels[0]!.y);
      for (let i = 1; i < n; i++) ctx.lineTo(pixels[i]!.x, pixels[i]!.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      // Vertex labels — chip placed above a "peak" vertex (lower y than both
      // neighbours) else below, so a label clears the line.
      for (let i = 0; i < n; i++) {
        const p = pixels[i]!;
        const prev = pixels[i - 1];
        const next = pixels[i + 1];
        const neighbourY = Math.min(prev?.y ?? p.y, next?.y ?? p.y);
        const above = p.y <= neighbourY; // a local high (smaller y) → label above
        drawChip(ctx, p.x, above ? p.y - 6 : p.y + 6, labels[i]!, {
          bg: style.color, fg: '#ffffff', align: 'center', vAlign: above ? 'bottom' : 'top', font: 10,
        });
      }
      if (selected) for (const p of pixels) drawHandle(ctx, p, style.color);
    },

    handles(pixels) {
      return pixels.slice(0, n);
    },

    hitTest(pixels, mouse, tol): HitResult {
      if (pixels.length < n) return null;
      const grab2 = (HANDLE_GRAB + tol) * (HANDLE_GRAB + tol);
      for (let i = 0; i < n; i++) if (dist2(mouse, pixels[i]!) <= grab2) return { kind: 'handle', index: i };
      if (distToPolyline(mouse, pixels.slice(0, n)) <= BODY_GRAB + tol) return { kind: 'body' };
      return null;
    },
  };
}

/** Head & Shoulders: left shoulder, head's left trough, head, right trough, right
 *  shoulder. (The neckline is read off the two troughs visually.) */
export const headShouldersTool = makePatternTool('head-shoulders', ['LS', 'L', 'H', 'R', 'RS']);

/** XABCD harmonic pattern: the five turning points. */
export const xabcdTool = makePatternTool('xabcd', ['X', 'A', 'B', 'C', 'D']);

registerTool(headShouldersTool);
registerTool(xabcdTool);
