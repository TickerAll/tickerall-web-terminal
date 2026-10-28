/**
 * ChartColorsPanel — the custom "Chart Colors" settings section (Item 6).
 *
 * Unlike the generic descriptor-driven `SettingRow`, chart colours have UNSET-vs-SET
 * semantics: a field left unset (absent / `''`) falls back to the active theme token,
 * and only an explicitly-picked colour overrides it. The generic form can't express
 * "clear this back to the theme", so this small panel owns the UI:
 *
 *   • one row per overridable colour (candle up/down, wick up/down, background, grid,
 *     crosshair, text) with a native colour swatch + a text box (so rgba()/named CSS
 *     colours work too) + a per-row "Reset" that clears just that override;
 *   • the swatch/box show the EFFECTIVE colour — the user's override if set, else the
 *     live theme token, so an unset row previews exactly what the chart is using;
 *   • a "Reset all to theme" button that clears the whole `chart.colors` object.
 *
 * Every edit live-applies: writing `chart.colors.<key>` broadcasts through the store,
 * the ThemeProvider's `chart.colors` subscription re-themes every chart. Dark with no
 * overrides stays byte-identical (an unset row writes nothing).
 */

import { useSyncExternalStore } from 'react';
import {
  CHART_COLOR_OVERRIDE_FIELDS, isColorOverrideSet,
  type ChartColorOverrides,
} from '../../../shared/settingsSchema';
import { getByPath } from '../../../shared/settingsSchema';
import { getSnapshot, subscribeStore, setSetting } from '../../settings/store';
import { useTheme } from '../../theme/ThemeProvider';
import type { ThemeTokens } from '../../theme/tokens';
import { ensureSettingsPanelStyles } from './settingsPanelStyles';

ensureSettingsPanelStyles();

/** Which theme token each override key falls back to (for the "use theme" preview). */
const TOKEN_FOR: Record<keyof ChartColorOverrides, keyof ThemeTokens> = {
  upBody: 'upBody',
  downBody: 'downBody',
  wickUp: 'upBody',     // the token default uses the body colour for the wick
  wickDown: 'downBody',
  background: 'chartBg',
  grid: 'grid',
  crosshair: 'scaleBorder', // LWC default crosshair tracks the scale border tone
  text: 'scaleText',
};

/** Is a hex string the native <input type=color> can edit? (#rgb / #rrggbb). */
function isHex(v: unknown): v is string {
  return typeof v === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v);
}

/** Read one override value from the store (re-renders when it changes). */
function useOverride(key: keyof ChartColorOverrides): string | null | undefined {
  return useSyncExternalStore(subscribeStore, () =>
    getByPath(getSnapshot(), `chart.colors.${key}`) as string | null | undefined,
  );
}

export function ChartColorsPanel() {
  const { tokens } = useTheme();
  // The whole overrides object — to know whether "Reset all" should be enabled.
  const overrides = useSyncExternalStore(
    subscribeStore,
    () => getByPath(getSnapshot(), 'chart.colors') as ChartColorOverrides | undefined,
  );
  const anySet = !!overrides && CHART_COLOR_OVERRIDE_FIELDS.some((f) => isColorOverrideSet(overrides[f.key]));

  const resetAll = () => setSetting('chart.colors', {});

  return (
    <div className="sp-chart-colors">
      <p className="muted sp-cc-intro">
        Override the active theme’s chart colours. A field left on <b>Theme</b> uses the
        current theme’s colour and changes with it. Switching themes keeps your overrides.
      </p>

      {CHART_COLOR_OVERRIDE_FIELDS.map((f) => (
        <ColorOverrideRow key={f.key} field={f} tokenValue={tokens[TOKEN_FOR[f.key]]} />
      ))}

      <div className="sp-cc-actions">
        <button className="sp-btn ghost" onClick={resetAll} disabled={!anySet}>
          Reset all to theme
        </button>
      </div>
    </div>
  );
}

/** A single overridable colour: swatch + text box + per-row reset. */
function ColorOverrideRow({
  field, tokenValue,
}: {
  field: { key: keyof ChartColorOverrides; label: string; help?: string };
  tokenValue: string;
}) {
  const value = useOverride(field.key);
  const isSet = isColorOverrideSet(value);
  // The effective colour shown in the swatch/box: the override if set, else the theme.
  const effective = isSet ? (value as string) : tokenValue;
  const path = `chart.colors.${field.key}`;

  // Writing a non-empty string sets the override; clearing back to theme writes ''
  // (which `isColorOverrideSet` treats as "unset" → the token wins, dark stays byte-
  // identical). We persist '' rather than deleting the key so the shape is stable.
  const set = (v: string) => setSetting(path, v);
  const clear = () => setSetting(path, '');

  return (
    <div className={`sp-row sp-cc-row ${isSet ? 'scoped' : ''}`}>
      <div className="sp-row-label">
        <div className="sp-row-title">
          {field.label}
          {isSet
            ? <span className="sp-badge">custom</span>
            : <span className="sp-badge sp-badge-muted">theme</span>}
        </div>
        {field.help && <div className="sp-row-help">{field.help}</div>}
        <div className="sp-row-path">{path}</div>
      </div>

      <div className="sp-row-control">
        <div className="sp-color">
          <input
            type="color"
            className="sp-color-swatch"
            value={isHex(effective) ? effective : '#000000'}
            onChange={(e) => set(e.target.value)}
            title={effective}
          />
          {/* Text box too, so non-hex CSS colours (rgba(), transparent) are editable.
              Shows the override text when set, else empty with the theme colour as a
              placeholder hint. */}
          <input
            type="text"
            className="sp-color-text"
            value={isSet ? (value as string) : ''}
            placeholder={tokenValue}
            onChange={(e) => set(e.target.value)}
            spellCheck={false}
          />
        </div>
        <button
          className="sp-cc-reset"
          onClick={clear}
          disabled={!isSet}
          title="Reset this colour to the theme"
          aria-label={`Reset ${field.label} to theme`}
        >
          Reset
        </button>
      </div>
    </div>
  );
}
