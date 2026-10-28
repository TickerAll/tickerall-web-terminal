/**
 * A tiny registry that lets the ThemeProvider re-theme every live chart without
 * prop-drilling a chart ref through the component tree.
 *
 * Each chart instance registers a
 * `re-theme` callback on mount and unregisters on unmount. When the active theme
 * changes, the ThemeProvider calls `applyThemeToCharts(tokens)`, which invokes every
 * registered callback. A chart that mounts AFTER a theme change seeds its initial
 * colours from the live tokens directly (see `getActiveTokens` on the ThemeProvider),
 * so there is no flash and no ordering dependency.
 *
 * This is intentionally framework-free (a module-level Set) so it works for the main
 * chart, the equity chart, and any future multi-chart panes uniformly.
 */

import { BUILTIN_THEMES, DEFAULT_THEME_ID, type ThemeTokens } from './tokens';

/** A chart's re-theme hook: apply the given tokens to its LWC instance. */
export type ChartThemeApplier = (tokens: ThemeTokens) => void;

const appliers = new Set<ChartThemeApplier>();

/** The currently-active token palette. Seeded to dark so a chart mounting before the
 *  ThemeProvider's first effect runs still gets the correct (byte-identical) colours;
 *  the ThemeProvider keeps this in sync via `setActiveTokens`. */
let activeTokens: ThemeTokens = BUILTIN_THEMES[DEFAULT_THEME_ID]!.tokens;

/** The live token palette — a chart reads this at mount to seed its initial colours
 *  (no flash, no dependence on provider/chart mount order). */
export function getActiveTokens(): ThemeTokens { return activeTokens; }

/** The ThemeProvider calls this when the theme changes (before re-theming charts). */
export function setActiveTokens(tokens: ThemeTokens): void { activeTokens = tokens; }

/** Register a chart's re-theme callback. Returns an unregister function. */
export function registerChart(applier: ChartThemeApplier): () => void {
  appliers.add(applier);
  return () => { appliers.delete(applier); };
}

/** Re-theme every registered chart with the given tokens. */
export function applyThemeToCharts(tokens: ThemeTokens): void {
  for (const a of appliers) {
    try { a(tokens); } catch { /* a chart torn down mid-apply — ignore */ }
  }
}
