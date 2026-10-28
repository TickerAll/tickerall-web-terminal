/**
 * The Matrix digital-rain backdrop — a fixed, full-window <canvas> of falling green
 * glyphs drawn BEHIND the app (z-index 0; the app's #root sits above at z-index 1 with
 * a transparent background — see the `body.theme-matrix` rule in index.html — so the
 * rain glows through the theme's translucent panels while the chart stays opaque/clear).
 *
 * The ThemeProvider starts it when the Matrix theme activates and stops/removes it on
 * any switch away. Throttled (~18fps) + column-capped so it's cheap; honours
 * prefers-reduced-motion by painting one static field instead of animating.
 */

// Katakana + digits + a few symbols — the canonical Matrix glyph soup.
const GLYPHS =
  'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎ0123456789=+*<>:."|'.split('');

export function startMatrixRain(): () => void {
  const canvas = document.createElement('canvas');
  canvas.id = 'matrix-rain';
  canvas.style.cssText =
    'position:fixed;inset:0;width:100%;height:100%;z-index:0;pointer-events:none;opacity:0.6;';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) { canvas.remove(); return () => {}; }

  const FONT = 16;
  let w = 0, h = 0, cols = 0, drops: number[] = [];
  const resize = () => {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
    cols = Math.ceil(w / FONT);
    drops = Array.from({ length: cols }, () => ((Math.random() * -h) / FONT) | 0);
  };
  resize();
  window.addEventListener('resize', resize);

  const glyph = () => GLYPHS[(Math.random() * GLYPHS.length) | 0]!;
  const reduced = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  let raf = 0, last = 0;
  const draw = (t: number) => {
    raf = requestAnimationFrame(draw);
    if (t - last < 55) return; // ~18fps — the right drip cadence + cheap
    last = t;
    ctx.fillStyle = 'rgba(0,0,0,0.07)'; // fade the trail
    ctx.fillRect(0, 0, w, h);
    ctx.font = `${FONT}px monospace`;
    for (let i = 0; i < cols; i++) {
      const y = drops[i]! * FONT;
      ctx.fillStyle = Math.random() < 0.015 ? '#d9ffd9' : '#00ff41'; // occasional bright head
      ctx.fillText(glyph(), i * FONT, y);
      if (y > h && Math.random() > 0.975) drops[i] = 0;
      drops[i]!++;
    }
  };

  if (reduced) {
    // Static dim field — no animation for reduced-motion users.
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
    ctx.font = `${FONT}px monospace`; ctx.fillStyle = '#0c5a20';
    const rows = (h / FONT) | 0;
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j += 2) ctx.fillText(glyph(), i * FONT, j * FONT);
  } else {
    raf = requestAnimationFrame(draw);
  }

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
    canvas.remove();
  };
}
