/**
 * StyleRow — a compact colour / width / line-style (and optional fill) editor shown
 * in the drawing toolbar. Writing here updates the active default style AND, via the
 * toolbar, every selected drawing's DrawingStyle. Theme-aware (the swatch palette is
 * CSS-var driven; the native colour input handles arbitrary colours).
 */

import type { DrawingStyle, LineStyle } from '../types';

interface Props {
  style: DrawingStyle;
  onChange: (s: DrawingStyle) => void;
  /** Show a fill control (closed shapes / fib bands). */
  showFill?: boolean;
}

/** A small palette of quick-pick stroke colours (literal hexes so the swatch shows
 *  the real colour; `var(--accent)` is offered first as the theme default). */
const SWATCHES = ['var(--accent)', '#e5484d', '#30a46c', '#f5a623', '#a259ff', '#e8e8ea', '#888c94'];
const WIDTHS = [1, 2, 3, 4];
const LINE_STYLES: { v: LineStyle; label: string; dash: string }[] = [
  { v: 'solid', label: 'Solid', dash: '———' },
  { v: 'dashed', label: 'Dashed', dash: '- - -' },
  { v: 'dotted', label: 'Dotted', dash: '·····' },
];

/** Resolve `var(--token)` to a literal colour for the native <input type=color>
 *  (which can't take a CSS var). Falls back to the accent blue. */
function colorValue(c: string): string {
  const m = /^var\((--[a-z0-9-]+)\)$/i.exec(c.trim());
  if (!m) return c;
  if (typeof document !== 'undefined') {
    const v = getComputedStyle(document.documentElement).getPropertyValue(m[1]!).trim();
    if (v) return toHex(v);
  }
  return '#2f81f7';
}

/** Best-effort rgb()/named → #rrggbb (the colour input needs a hex). */
function toHex(c: string): string {
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  const m = /^rgba?\(([^)]+)\)$/i.exec(c);
  if (m) {
    const [r, g, b] = m[1]!.split(',').map((s) => parseInt(s.trim(), 10));
    const h = (n: number) => Math.max(0, Math.min(255, n | 0)).toString(16).padStart(2, '0');
    return `#${h(r!)}${h(g!)}${h(b!)}`;
  }
  return '#2f81f7';
}

export function StyleRow({ style, onChange, showFill }: Props) {
  const set = (patch: Partial<DrawingStyle>) => onChange({ ...style, ...patch });
  const lineStyle = style.lineStyle ?? 'solid';

  return (
    <div className="dtb-style">
      <div className="dtb-swatches">
        {SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            className={`dtb-swatch ${style.color === c ? 'on' : ''}`}
            style={{ background: c }}
            title={c.startsWith('var(') ? 'Theme accent' : c}
            onClick={() => set({ color: c })}
          />
        ))}
        {/* arbitrary colour */}
        <label className="dtb-swatch dtb-swatch-custom" title="Custom colour">
          <input
            type="color"
            value={colorValue(style.color)}
            onChange={(e) => set({ color: e.target.value })}
          />
        </label>
      </div>

      <div className="dtb-widths">
        {WIDTHS.map((w) => (
          <button
            key={w}
            type="button"
            className={`dtb-w ${style.width === w ? 'on' : ''}`}
            title={`Width ${w}px`}
            onClick={() => set({ width: w })}
          >
            <span className="dtb-w-bar" style={{ height: `${w}px` }} />
          </button>
        ))}
      </div>

      <div className="dtb-linestyles">
        {LINE_STYLES.map((ls) => (
          <button
            key={ls.v}
            type="button"
            className={`dtb-ls ${lineStyle === ls.v ? 'on' : ''}`}
            title={ls.label}
            onClick={() => set({ lineStyle: ls.v })}
          >
            {ls.dash}
          </button>
        ))}
      </div>

      {showFill && (
        <label className="dtb-fill" title="Fill (closed shapes)">
          <input
            type="checkbox"
            checked={!!style.fill}
            onChange={(e) => set({ fill: e.target.checked ? 'rgba(47,129,247,0.15)' : undefined })}
          />
          <span>Fill</span>
        </label>
      )}
    </div>
  );
}
