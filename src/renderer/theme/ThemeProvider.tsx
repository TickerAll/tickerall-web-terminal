/**
 * ThemeProvider — Foundation 2 (area B). The single place that turns the persisted
 * `appearance.theme` setting into live UI:
 *
 *   1. writes every `ThemeTokens` value onto `document.documentElement` as a CSS
 *      custom property (`--bg`, `--row-line`, …), so the whole `<style>` block in
 *      index.html re-colours instantly with no flash — then lets a partner host's
 *      `data-brand-accent` override `--accent`/`--on-accent` (see `branding.ts`);
 *   2. sets a `theme-<id>` (and the skin's extra `body`) class on `<body>` so the
 *      pixel/CRT chrome rules apply;
 *   3. lazily injects the bundled pixel @font-face when a pixel skin is active;
 *   4. mounts/positions the `.crt-overlay` scanline element for CRT skins;
 *   5. re-themes every registered chart (`applyThemeToCharts`) on every change.
 *
 * It re-applies reactively whenever the setting changes (via `useSetting`). It also
 * keeps the chart-registry's "active tokens" in sync so a chart mounting at any time
 * seeds the right colours.
 *
 * Frozen public contract (consumed by all clusters):
 *   useTheme() → { id, name, tokens, def }
 *   useActiveThemeTokens() → ThemeTokens
 *   useChartTheme(chartRef) → wires a ChartHandle's applyTheme to the active theme
 */

import {
  createContext, useContext, useEffect, useMemo, type ReactNode,
} from 'react';
import { useSetting } from '../settings/hooks';
import {
  BUILTIN_THEMES, DEFAULT_THEME_ID, TOKEN_KEYS, resolveTheme, tokenToCssVar,
  type ThemeDef, type ThemeTokens,
} from './tokens';
import { applyThemeToCharts, getActiveTokens, registerChart, setActiveTokens } from './chartRegistry';
import { chartTheme } from './chartTheme';
import { PIXEL_FONT_FACE } from './pixelFont';
import type { ChartHandle } from '../components/Chart';
import { api } from '../api';
import { getBrandAccent, onAccentFor } from '../branding';
import { subscribe } from '../settings/store';
import { startMatrixRain } from './matrixRain';

interface ThemeContextValue {
  id: string;
  name: string;
  tokens: ThemeTokens;
  def: ThemeDef;
}

const ThemeContext = createContext<ThemeContextValue>({
  id: DEFAULT_THEME_ID,
  name: BUILTIN_THEMES[DEFAULT_THEME_ID]!.name,
  tokens: BUILTIN_THEMES[DEFAULT_THEME_ID]!.tokens,
  def: BUILTIN_THEMES[DEFAULT_THEME_ID]!,
});

const PIXEL_FONT_STYLE_ID = 'pixel-font-face';
const CRT_OVERLAY_ID = 'crt-overlay';
/** Body classes the provider manages (so it can clear stale ones on switch). */
const SKIN_BODY_CLASSES = Object.values(BUILTIN_THEMES)
  .map((t) => t.body)
  .filter((c): c is string => !!c);

/** Theme-aware "chrome" CSS, injected once. It reads the `--vars` the provider sets
 *  on :root, so it recolours with the palette automatically (inject-once is enough) —
 *  covers the scrollbars and the Market-Watch account picker so both match every
 *  theme without touching index.html. */
const CHROME_STYLE_ID = 'theme-chrome';
const THEME_CHROME_CSS = `
html { scrollbar-width: thin; scrollbar-color: var(--line2) transparent; }
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--line2); border-radius: 5px; }
::-webkit-scrollbar-thumb:hover { background: var(--muted); }
::-webkit-scrollbar-corner { background: transparent; }

.mw-acct { padding: 6px 8px; }
.mw-acct-select {
  width: 100%; -webkit-appearance: none; appearance: none;
  background-color: var(--panel2); color: var(--fg);
  border: 1px solid var(--line2); border-radius: 6px;
  padding: 5px 26px 5px 9px; font: inherit; font-size: 12px; line-height: 1.4;
  cursor: pointer; outline: none;
  background-image:
    linear-gradient(45deg, transparent 50%, var(--muted) 50%),
    linear-gradient(135deg, var(--muted) 50%, transparent 50%);
  background-position: calc(100% - 15px) center, calc(100% - 10px) center;
  background-size: 5px 5px, 5px 5px; background-repeat: no-repeat;
}
.mw-acct-select:hover { border-color: var(--line-hover); }
.mw-acct-select:focus { border-color: var(--accent); }
.mw-acct-select option { background: var(--panel); color: var(--fg); }

/* Themed titlebar: the toolbar IS the drag region; interactive bits stay clickable.
   tb-left/right clear the native window-controls overlay via the titlebar-area env
   vars (controls right on Win/Linux, traffic lights left on macOS; 0 with no overlay). */
.toolbar { -webkit-app-region: drag; }
.toolbar button, .toolbar input, .toolbar select, .toolbar a,
.toolbar .tf, .toolbar [role="button"] { -webkit-app-region: no-drag; }
.tb-left { margin-left: env(titlebar-area-x, 0px); }
.tb-right { margin-right: calc(100vw - env(titlebar-area-width, 100vw) - env(titlebar-area-x, 0px)); }
`;
function ensureChromeStyle(): void {
  if (document.getElementById(CHROME_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = CHROME_STYLE_ID;
  style.textContent = THEME_CHROME_CSS;
  document.head.appendChild(style);
}

/** Inject the pixel @font-face once (idempotent). Lazy — only when a skin needs it. */
function ensurePixelFont(): void {
  if (document.getElementById(PIXEL_FONT_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = PIXEL_FONT_STYLE_ID;
  style.textContent = PIXEL_FONT_FACE;
  document.head.appendChild(style);
}

/** Ensure the CRT scanline overlay element exists (created once, toggled by class). */
function ensureCrtOverlay(): HTMLElement {
  let el = document.getElementById(CRT_OVERLAY_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = CRT_OVERLAY_ID;
    el.className = 'crt-overlay';
    // Belt-and-braces: even if the CSS class were missing, never capture pointers.
    el.style.pointerEvents = 'none';
    document.body.appendChild(el);
  }
  return el;
}

/** Strip alpha so a translucent token (e.g. the Matrix panel) still yields a valid
 *  OPAQUE colour for the native titlebar overlay (which can't be semi-transparent). */
function opaque(c: string): string {
  const m = c.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  return m ? `rgb(${m[1]}, ${m[2]}, ${m[3]})` : c;
}

/** The Matrix digital-rain backdrop — started when the Matrix theme is active, stopped
 *  (and removed) on any switch away. */
let stopMatrixRain: (() => void) | null = null;
function applyMatrixRain(active: boolean): void {
  if (active && !stopMatrixRain) stopMatrixRain = startMatrixRain();
  else if (!active && stopMatrixRain) { stopMatrixRain(); stopMatrixRain = null; }
}

/** Apply a theme definition to the DOM + charts. Pure side-effects; no React. */
function applyTheme(def: ThemeDef): void {
  const root = document.documentElement;
  // 1. CSS variables.
  for (const key of TOKEN_KEYS) {
    root.style.setProperty(tokenToCssVar(key), def.tokens[key]);
  }
  // 1b. A partner host's `data-brand-accent` REPLACES the theme's accent (and its ink), so the
  //     embedded terminal's interactive chrome matches the host's own — one bar, one colour.
  //     Applied INSIDE this loop's wake (not once at boot) because the loop above rewrites every
  //     token on each theme switch and would otherwise stomp it. Absent → nothing runs here and
  //     the theme's accent stands, so every un-stamped host is byte-unchanged. Deliberately
  //     CSS-vars-only: `chartTheme` doesn't read `accent`, so the canvas palette is untouched.
  const brandAccent = getBrandAccent(!!def.light);
  if (brandAccent) {
    root.style.setProperty('--accent', brandAccent);
    const ink = onAccentFor(brandAccent);
    if (ink) root.style.setProperty('--on-accent', ink);
  }
  // Native controls (default scrollbars, the <select> popup) follow the theme base.
  root.style.setProperty('color-scheme', def.light ? 'light' : 'dark');
  // Match the native window-controls overlay (titlebar) to the theme (Win/Linux).
  try { void api.setTitlebarOverlay(opaque(def.tokens.panel), opaque(def.tokens.fg)).catch(() => {}); } catch { /* not in electron */ }
  // Themed chrome (scrollbars, account picker) — injected once; recolours via the vars.
  ensureChromeStyle();
  // 2. Body classes: theme-<id> + the skin's extra class; clear stale skin classes.
  const body = document.body;
  for (const cls of SKIN_BODY_CLASSES) body.classList.remove(cls);
  // Remove any previous theme-<id> classes.
  for (const cls of Array.from(body.classList)) {
    if (cls.startsWith('theme-')) body.classList.remove(cls);
  }
  body.classList.add(`theme-${def.id}`);
  if (def.body) body.classList.add(def.body);
  // 3. Pixel font (lazy) when a skin opts in (it sets a `body` chrome class).
  if (def.body) ensurePixelFont();
  // 4. CRT overlay visibility.
  const crt = ensureCrtOverlay();
  crt.style.display = def.crt ? 'block' : 'none';
  // 4b. Matrix digital-rain backdrop (only for the Matrix theme).
  applyMatrixRain(def.id === 'matrix');
  // 5. Charts + registry active tokens.
  setActiveTokens(def.tokens);
  applyThemeToCharts(def.tokens);
}

/** Wraps the app: reads the theme setting and applies it live. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeId] = useSetting<string>('appearance.theme');
  const def = resolveTheme(themeId);

  useEffect(() => {
    applyTheme(def);
    // Re-run whenever the resolved theme id changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def.id]);

  // Live-apply chart-colour overrides (Item 6): when `chart.colors` changes (a colour
  // edited, or a profile load that replaces the whole settings object), re-theme every
  // chart. chartTheme() re-reads the overrides from the store, so re-applying the
  // CURRENT tokens is enough — no token change needed.
  useEffect(() => {
    return subscribe('chart.colors', () => applyThemeToCharts(getActiveTokens()));
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ id: def.id, name: def.name, tokens: def.tokens, def }),
    [def],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** The active theme (id, name, tokens, def). */
export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

/** Just the active token palette. */
export function useActiveThemeTokens(): ThemeTokens {
  return useContext(ThemeContext).tokens;
}

/**
 * Wire a chart's imperative `applyTheme` to the active theme: applies the current
 * theme on mount/theme-change. (The chart itself ALSO self-registers via the chart
 * registry, so it re-themes even without this hook; this hook is the explicit,
 * ref-targeted path for callers that hold a chart ref directly.)
 */
export function useChartTheme(chartRef: React.RefObject<ChartHandle>): void {
  const { tokens } = useTheme();
  useEffect(() => {
    chartRef.current?.applyTheme(chartTheme(tokens));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokens, chartRef]);
}
