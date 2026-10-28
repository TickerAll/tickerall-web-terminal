/**
 * ThemeSwatch — a tiny, self-contained LIVE PREVIEW of a theme, rendered purely from
 * the theme's own `ThemeTokens` (no lightweight-charts instance, no global side
 * effects — it just paints inline styles from `def.tokens`). The Appearance section's
 * theme picker shows one per built-in theme so you can see a palette before applying.
 *
 * The preview is a miniature of the terminal chrome: a toolbar strip, a chart area
 * with grid + two candles (one up, one down) + an overlay line, and an accent chip.
 * Because every colour comes from the passed theme (not the active CSS vars), an
 * INACTIVE theme's swatch still shows ITS colours — that's the whole point.
 */

import type { ThemeDef } from '../../theme/tokens';

export function ThemeSwatch({
  def, active, onPick,
}: {
  def: ThemeDef;
  active: boolean;
  onPick: () => void;
}) {
  const t = def.tokens;
  // Pixel skins get square corners + a chunkier border, mirroring the real skin chrome.
  const pixel = !!def.body;
  const radius = pixel ? 0 : 7;

  return (
    <button
      type="button"
      className={`sp-swatch ${active ? 'on' : ''}`}
      onClick={onPick}
      aria-pressed={active}
      title={def.name}
      style={{ borderColor: active ? t.accent : t.line2, borderRadius: radius + 2 }}
    >
      {/* Mini chrome preview, painted from this theme's tokens. */}
      <div className="sp-swatch-prev" style={{ background: t.bg, borderRadius: radius }}>
        {/* toolbar */}
        <div className="sp-swatch-bar" style={{ background: t.panel, borderBottom: `1px solid ${t.line}` }}>
          <span className="sp-swatch-dot" style={{ background: t.accent }} />
          <span className="sp-swatch-dot" style={{ background: t.up }} />
          <span className="sp-swatch-dot" style={{ background: t.down }} />
        </div>
        {/* chart area: grid + 2 candles + overlay line */}
        <div className="sp-swatch-chart" style={{ background: t.chartBg }}>
          <div className="sp-swatch-grid" style={{
            backgroundImage:
              `linear-gradient(${t.grid} 1px, transparent 1px),` +
              `linear-gradient(90deg, ${t.grid} 1px, transparent 1px)`,
          }} />
          <div className="sp-swatch-candle up" style={{
            background: t.upBody, borderColor: pixel ? t.wick : t.upBody, left: '22%', height: '52%', top: '20%',
          }} />
          <div className="sp-swatch-wick" style={{ background: t.wick, left: 'calc(22% + 5px)', height: '74%', top: '10%' }} />
          <div className="sp-swatch-candle down" style={{
            background: t.downBody, borderColor: pixel ? t.wick : t.downBody, left: '52%', height: '40%', top: '34%',
          }} />
          <div className="sp-swatch-wick" style={{ background: t.wick, left: 'calc(52% + 5px)', height: '64%', top: '22%' }} />
          <div className="sp-swatch-line" style={{ background: t.gold }} />
        </div>
      </div>
      <div className="sp-swatch-meta">
        <span className="sp-swatch-name" style={{ color: active ? t.accent : t.fg }}>{def.name}</span>
        {active && <span className="sp-swatch-active" style={{ color: t.accent }}>active</span>}
      </div>
    </button>
  );
}
