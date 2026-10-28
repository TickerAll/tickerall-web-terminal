/**
 * Text label — a single data anchor + `style.text`. Rendered as left-aligned text
 * whose top-left sits at the projected anchor (so it stays glued to its bar/price).
 * `style.fontSize` (default 13) sets the size; `style.color` the fill.
 *
 * Hit-test: the anchor handle (when selected) plus a body box measured from the
 * actual glyphs. `hitTest` receives the resolved `style`, so it measures the text
 * on a shared offscreen canvas — the body box is exactly the rendered text box.
 * (Falls back to a small default box when no canvas / no style is available, e.g.
 * in a unit test with a stubbed environment.)
 */

import {
  type DrawingTool, type HitResult, registerTool,
  drawHandle, dist2, HANDLE_GRAB,
} from './registry';
import type { PixelPoint } from '../CoordinateProjector';
import type { ResolvedStyle } from './registry';

/** Default font size when the style doesn't set one. */
export const DEFAULT_FONT = 13;
/** Placeholder shown while a label has no text yet. */
export const PLACEHOLDER = 'Text';

/** The default font family for a text label (matches the chip font used elsewhere). */
export const DEFAULT_FONT_FAMILY = 'system-ui, sans-serif';

function fontPx(style: { fontSize?: number }): number {
  return Math.max(6, style.fontSize ?? DEFAULT_FONT);
}

function fontFamilyOf(style: { fontFamily?: string }): string {
  return style.fontFamily && style.fontFamily.trim() ? style.fontFamily : DEFAULT_FONT_FAMILY;
}

function fontStr(fp: number, family: string = DEFAULT_FONT_FAMILY): string {
  return `${fp}px ${family}`;
}

/** A lazily-created offscreen 2D context purely for measuring text in hit-testing
 *  (so hitTest doesn't depend on the live overlay canvas). null in non-DOM envs. */
let measureCtx: CanvasRenderingContext2D | null | undefined;
function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (measureCtx !== undefined) return measureCtx;
  try {
    const c = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    measureCtx = c ? c.getContext('2d') : null;
  } catch {
    measureCtx = null;
  }
  return measureCtx;
}

/** Width of `text` at font size `fp` (+ family), or a length-based estimate when
 *  measuring isn't available. */
function textWidth(text: string, fp: number, family: string = DEFAULT_FONT_FAMILY): number {
  const ctx = getMeasureCtx();
  if (ctx) { ctx.font = fontStr(fp, family); return ctx.measureText(text).width; }
  return text.length * fp * 0.55; // rough average glyph advance
}

export const textTool: DrawingTool = {
  kind: 'text',
  pointCount: 1,

  render(ctx, pixels, style: ResolvedStyle, selected) {
    if (pixels.length < 1) return;
    const p = pixels[0]!;
    const hasText = !!(style.text && style.text.length);
    const text = hasText ? style.text! : PLACEHOLDER;
    const fp = fontPx(style);
    const family = fontFamilyOf(style);
    ctx.save();
    ctx.globalAlpha = style.opacity ?? 1;
    ctx.font = fontStr(fp, family);
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    if (style.fill) {
      // fillOpacity is already baked into the resolved fill's alpha (resolveStyle).
      const w = ctx.measureText(text).width;
      ctx.fillStyle = style.fill;
      ctx.fillRect(p.x - 2, p.y - 1, w + 4, fp + 3);
    }
    ctx.fillStyle = hasText ? style.color : 'rgba(150,150,160,0.85)';
    ctx.fillText(text, p.x, p.y);
    ctx.restore();
    if (selected) drawHandle(ctx, p, style.color);
  },

  handles(pixels) {
    return pixels.slice(0, 1);
  },

  hitTest(pixels, mouse, tol, _env, style): HitResult {
    if (pixels.length < 1) return null;
    const p = pixels[0]!;
    const grab2 = (HANDLE_GRAB + tol) * (HANDLE_GRAB + tol);
    if (dist2(mouse, p) <= grab2) return { kind: 'handle', index: 0 };
    // Body box = the actual rendered text box (measured from the style's text/size).
    const fp = fontPx(style ?? {});
    const text = (style?.text && style.text.length) ? style.text : PLACEHOLDER;
    const w = textWidth(text, fp, fontFamilyOf(style ?? {}));
    const within =
      mouse.x >= p.x - 2 - tol && mouse.x <= p.x + w + 2 + tol &&
      mouse.y >= p.y - 1 - tol && mouse.y <= p.y + fp + 3 + tol;
    return within ? { kind: 'body' } : null;
  },
};

registerTool(textTool);
