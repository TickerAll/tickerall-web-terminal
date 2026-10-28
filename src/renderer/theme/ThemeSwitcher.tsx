/**
 * A minimal theme switcher (Foundation 2). A compact native `<select>` bound to the
 * `appearance.theme` setting — changing it persists via the settings store and the
 * ThemeProvider re-applies the theme live (CSS vars + body skin class + chart re-theme)
 * with no reload. Two render styles:
 *   - `variant="toolbar"` (default): a small inline control for the toolbar.
 *   - `variant="row"`: a labelled row for the settings modal.
 * The option list comes from `BUILTIN_THEMES` so it always matches the real themes.
 */

import { useSetting } from '../settings/hooks';
import { BUILTIN_THEMES, THEME_ORDER } from './tokens';

export function ThemeSwitcher({ variant = 'toolbar' }: { variant?: 'toolbar' | 'row' }) {
  const [theme, setTheme] = useSetting<string>('appearance.theme');

  const select = (
    <select
      className="theme-select"
      value={theme}
      onChange={(e) => setTheme(e.target.value)}
      title="Theme"
      aria-label="Theme"
    >
      {THEME_ORDER.map((id) => (
        <option key={id} value={id}>{BUILTIN_THEMES[id]?.name ?? id}</option>
      ))}
    </select>
  );

  if (variant === 'row') {
    return (
      <div className="settings-row">
        <div>
          <div className="settings-label">Theme</div>
          <div className="muted tiny">Colour theme + retro pixel skins. Applies live.</div>
        </div>
        {select}
      </div>
    );
  }
  return select;
}
