/**
 * Emoji / sticker — a 1-point tool that stamps an emoji glyph on the chart. The glyph is
 * carried in `style.emoji` (set by the toolbar's emoji picker before placing; falls back to
 * 😀); the size scales with `style.fontSize`. It is NOT a text-bearing kind (no inline text
 * editor) — to change the glyph, pick another in the toolbar and place again, or restyle via
 * the picker. Body-drag moves it; the single anchor is its position.
 */

import { type DrawingTool, type HitResult, type ResolvedStyle, registerTool, drawHandle } from './registry';

/** The default glyph when none was picked. */
export const DEFAULT_EMOJI = '😀';
/** A platform emoji font stack (colour glyphs) with a sane fallback. */
const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",system-ui,sans-serif';

/** The rendered glyph size in CSS px (scales with the style's fontSize; default 28). */
function glyphSize(style: ResolvedStyle): number {
  return Math.max(12, style.fontSize ?? 28);
}

export const emojiTool: DrawingTool = {
  kind: 'emoji',
  pointCount: 1,

  render(ctx, pixels, style, selected) {
    if (pixels.length < 1) return;
    const p = pixels[0]!;
    const size = glyphSize(style);
    ctx.save();
    ctx.globalAlpha = style.opacity ?? 1;
    ctx.font = `${size}px ${EMOJI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(style.emoji || DEFAULT_EMOJI, p.x, p.y);
    ctx.restore();
    if (selected) {
      const half = size * 0.6;
      ctx.save();
      ctx.strokeStyle = style.color;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(p.x - half, p.y - half, half * 2, half * 2);
      ctx.restore();
      drawHandle(ctx, p, style.color);
    }
  },

  handles(pixels) {
    return pixels.slice(0, 1);
  },

  hitTest(pixels, mouse, tol, _env, style): HitResult {
    if (pixels.length < 1) return null;
    const p = pixels[0]!;
    const half = (style ? glyphSize(style) : 28) * 0.6 + tol;
    if (Math.abs(mouse.x - p.x) <= half && Math.abs(mouse.y - p.y) <= half) return { kind: 'body' };
    return null;
  },
};

registerTool(emojiTool);
