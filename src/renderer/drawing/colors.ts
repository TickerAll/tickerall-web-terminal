/**
 * Colour helpers for the drawing engine (pure — no DOM). Kept in a `.ts` module so
 * they're unit-testable without pulling in the React/canvas overlay.
 */

/**
 * Multiply an alpha factor into a (resolved, literal) colour. Handles
 * `#rgb` / `#rgba` / `#rrggbb` / `#rrggbbaa` / `rgb()` / `rgba()`; leaves anything
 * exotic (named colours, gradients, CSS vars) untouched. Used to bake
 * `style.fillOpacity` into the fill so every shape tool honours it without per-tool
 * code (the renderers just read `style.fill`).
 *
 * `factor` is clamped to [0,1] and MULTIPLIES any existing alpha, so a 50% fill
 * opacity over an already-40%-alpha colour yields 20%.
 */
export function applyAlpha(color: string, factor: number): string {
  const f = Math.max(0, Math.min(1, factor));
  const c = color.trim();
  // #rgb / #rgba / #rrggbb / #rrggbbaa
  const hex = /^#([0-9a-f]{3,8})$/i.exec(c);
  if (hex) {
    let h = hex[1]!;
    if (h.length === 3 || h.length === 4) h = h.split('').map((ch) => ch + ch).join('');
    if (h.length < 6) return color; // malformed (e.g. 5 nibbles) — leave it
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const a0 = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return `rgba(${r},${g},${b},${round3(a0 * f)})`;
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(c);
  if (rgb) {
    const parts = rgb[1]!.split(',').map((s) => s.trim());
    if (parts.length < 3) return color;
    const [r, g, b] = parts;
    const a0 = parts.length >= 4 ? parseFloat(parts[3]!) : 1;
    return `rgba(${r},${g},${b},${round3((Number.isFinite(a0) ? a0 : 1) * f)})`;
  }
  return color;
}

/** Round to 3 decimals without trailing-zero noise (so `1` not `1.000`). */
function round3(n: number): number {
  return Number(n.toFixed(3));
}
