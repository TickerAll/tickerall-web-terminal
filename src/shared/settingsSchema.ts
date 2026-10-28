/**
 * The single typed, versioned settings schema — the source of persisted truth for
 * EVERY configurable feature in the terminal (Foundation 1 of the build roadmap).
 *
 * Persistence lives in a plain `settings.json` under userData (NOT the secrets vault).
 * The store loads it, runs ordered migrations, and deep-merges over DEFAULT_SETTINGS,
 * so adding a new field is always backward-compatible.
 *
 * EXTENDING (per the roadmap's conflict matrix): each feature cluster appends its own
 * section interface + DEFAULT_SETTINGS section + SETTINGS_DESCRIPTORS rows under its
 * own banner — additive only, never editing another cluster's banner. Clusters NEVER
 * edit the SettingsPage; the descriptor registry drives the generic form.
 */

export const SETTINGS_SCHEMA_VERSION = 1;

/** Recursive partial — used for sparse per-chart overrides. */
export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

// ─────────────────────────────────────────────────────────────────────────────
// Section interfaces. Clusters extend these (or add new sections) under a banner.
// ─────────────────────────────────────────────────────────────────────────────

// ── General ──
export interface GeneralSettings {
  /** Confirm before placing/closing trades. */
  confirmTrades: boolean;
  /** Show the broker's server time in the footer. */
  serverTimeInFooter: boolean;
  /** One-click trading: place SELL/BUY from the mobile chart band INSTANTLY (no
   *  confirmation sheet). Off by default — opt-in, the real-money power-user mode. */
  oneClickTrading: boolean;
}

// ── Appearance / Theme ──  (Theme cluster extends)
export interface AppearanceSettings {
  /** Active theme id: 'dark' | 'light' | 'tertiary' | '8bit' | '16bit' | a custom id. */
  theme: string;
}

// ── Chart ──  (Chart-types cluster extends)
export interface ChartTypeSettings {
  /** Default series type: 'candles' | 'hollow' | 'bars' | 'line' | 'area' | 'baseline' | 'heikinashi' | … */
  defaultType: string;
  /** Show the candle-countdown timer (time to close of the forming bar). */
  showCountdown: boolean;
  /** Large faded symbol+timeframe watermark behind the chart. */
  watermark: { enabled: boolean; fontSize: number };
  /** Optional chart-colour overrides on top of the active theme (Item 6). A field
   *  left UNSET (absent / null / empty string) keeps the theme token — only fields
   *  the user explicitly set override. Dark with NO overrides is byte-identical. */
  colors: ChartColorOverrides;
  /** MT5 period separators + session shading (Item 13). `enabled:true` is the
   *  unchanged default behaviour. `color`/`style` left UNSET (absent / null / '')
   *  fall back to the active theme token + a solid hairline. `showSessions` toggles
   *  the faint alternating session-band tint independently of the separator lines. */
  sessionBreaks: SessionBreaksSettings;
}

// ── Session breaks (Item 13) ──  (Chart-types cluster owns)
/** Style for the MT5-style period separators + session shading drawn by SessionBreaks.
 *  `enabled` gates the whole overlay (off → it draws nothing). `color` left UNSET
 *  (absent / null / '') uses the active theme's separator-line token; a non-empty CSS
 *  colour overrides it. `style` is the separator line style. `showSessions` toggles the
 *  faint alternating session-band tint on its own (the lines can show without the tint). */
export interface SessionBreaksSettings {
  enabled: boolean;
  /** Separator-line colour override; UNSET (absent / null / '') → the theme token. */
  color?: string | null;
  /** Separator line style. */
  style?: 'solid' | 'dashed' | 'dotted';
  /** Show the faint alternating session-band shading (independent of the lines). */
  showSessions?: boolean;
}

// ── Chart colours (Item 6) ──  (Chart-colours cluster owns)
/**
 * Per-key chart colour overrides. Every key is OPTIONAL and "unset" (the key is
 * absent, `null`, or `''`) means "fall back to the active theme token". Only a key
 * holding a non-empty colour string overrides. The keys map to lightweight-charts
 * options in `chartTheme.ts` (see CHART_COLOR_OVERRIDE_FIELDS for the catalogue).
 */
export interface ChartColorOverrides {
  /** Bullish candle body. */
  upBody?: string | null;
  /** Bearish candle body. */
  downBody?: string | null;
  /** Bullish candle wick. */
  wickUp?: string | null;
  /** Bearish candle wick. */
  wickDown?: string | null;
  /** Chart background. */
  background?: string | null;
  /** Grid lines (both axes). */
  grid?: string | null;
  /** Crosshair lines. */
  crosshair?: string | null;
  /** Price/time scale text + crosshair labels. */
  text?: string | null;
}

/** The catalogue of chart-colour overrides — drives the Chart Colors settings panel
 *  (label + help per field), in display order. Adding a field here + to
 *  `ChartColorOverrides` + mapping it in `chartTheme.ts` is all a new override needs. */
export const CHART_COLOR_OVERRIDE_FIELDS: { key: keyof ChartColorOverrides; label: string; help?: string }[] = [
  { key: 'upBody', label: 'Candle up', help: 'Bullish candle body colour.' },
  { key: 'downBody', label: 'Candle down', help: 'Bearish candle body colour.' },
  { key: 'wickUp', label: 'Wick up', help: 'Bullish candle wick colour.' },
  { key: 'wickDown', label: 'Wick down', help: 'Bearish candle wick colour.' },
  { key: 'background', label: 'Background', help: 'Chart background colour.' },
  { key: 'grid', label: 'Grid lines', help: 'Chart grid line colour.' },
  { key: 'crosshair', label: 'Crosshair', help: 'Crosshair line colour.' },
  { key: 'text', label: 'Text / scale', help: 'Price + time scale label text colour.' },
];

/** True when a colour-override value is actually SET (a non-empty string). Absent,
 *  `null`, and `''` all mean "use the theme token" — §29: presence, not truthiness of
 *  the colour itself, but for an OPTIONAL override an empty value IS "no override". */
export function isColorOverrideSet(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

// ── Sounds ──  (Alerts cluster extends)
export interface SoundSettings {
  enabled: boolean;
  /** Master volume, 0..1. */
  volume: number;
  /** Per-event toggles (all default on). A cue fires only when both `enabled`
   *  AND its event toggle are true. */
  tradeOpen: boolean;
  tradeClose: boolean;
  alert: boolean;
}

// ── Alerts ──  (Alerts cluster owns)
/** One persisted price alert: when `symbol`'s bid crosses `price` from the correct
 *  side, fire ONCE. `op:'above'` fires when bid rises to/over `price`; `op:'below'`
 *  fires when bid falls to/under it. `triggeredAt` (epoch ms) is set on fire and
 *  blocks re-firing until the alert is re-armed (the field cleared). */
export interface PriceAlert {
  id: string;
  accountId: string;
  symbol: string;
  op: 'above' | 'below';
  price: number;
  enabled: boolean;
  triggeredAt?: number;
}
export interface AlertSettings {
  /** Fire an OS notification (in addition to the in-app toast) when an alert triggers. */
  osNotifications: boolean;
  /** The user's persisted alerts. */
  items: PriceAlert[];
}

// ── Drawing (drawing-engine area G) ──
/** A persisted drawing: the same wire shape as the renderer's `Drawing` (kept loose
 *  here — `points`/`style` are plain JSON — so the schema doesn't import renderer
 *  types). `kind` is the tool discriminator; `points` are (time, price) anchors. */
export interface PersistedDrawing {
  id: string;
  kind: string;
  points: { time: number; price: number }[];
  style: { color: string; width: number; lineStyle?: string; dash?: number[]; fill?: string; opacity?: number; text?: string; fontSize?: number };
  locked?: boolean;
  hidden?: boolean;
}
export interface DrawingSettings {
  /** Default style new drawings take (the toolbar's style row persists here). */
  defaultStyle: { color: string; width: number; lineStyle?: string; fill?: string };
  /** Magnet (snap-to-OHLC) preference. */
  magnet: boolean;
  /** Per-(account:symbol:tf) drawing lists. The key is `${accountId}:${symbol}:${tf}`.
   *  Stored as one map so a single write replaces it atomically (no dot-path into a
   *  key that may itself contain dots). */
  byContext: Record<string, PersistedDrawing[]>;
}

/**
 * The whole app settings object. `perChart` holds sparse overrides keyed by
 * `${accountId}:${symbol}:${tf}` — only the fields the user changed for that chart.
 * Clusters add new top-level sections under their banner below.
 */
export interface AppSettings {
  schemaVersion: number;
  general: GeneralSettings;
  appearance: AppearanceSettings;
  chart: ChartTypeSettings;
  sounds: SoundSettings;
  alerts: AlertSettings;
  drawing: DrawingSettings;
  /** Per-chart sparse overrides of any of the above sections. */
  perChart: Record<string, DeepPartial<Omit<AppSettings, 'schemaVersion' | 'perChart'>>>;
  // ── (clusters append new sections here: layout, indicators, drawing, alerts, hotkeys, …) ──
}

export const DEFAULT_SETTINGS: AppSettings = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  general: { confirmTrades: true, serverTimeInFooter: true, oneClickTrading: false },
  appearance: { theme: 'dark' },
  chart: { defaultType: 'candles', showCountdown: true, watermark: { enabled: true, fontSize: 60 }, colors: {}, sessionBreaks: { enabled: true, color: '', style: 'solid', showSessions: true } },
  sounds: { enabled: true, volume: 0.6, tradeOpen: true, tradeClose: true, alert: true },
  alerts: { osNotifications: true, items: [] },
  drawing: { defaultStyle: { color: 'var(--accent)', width: 2, lineStyle: 'solid' }, magnet: true, byContext: {} },
  perChart: {},
};

// ─────────────────────────────────────────────────────────────────────────────
// Migrations: MIGRATIONS[n] migrates a vN object to vN+1. Append, never rewrite.
// ─────────────────────────────────────────────────────────────────────────────
export type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;
export const MIGRATIONS: Migration[] = [
  // (none yet — future schema-shape changes append a migration here)
];

// ─────────────────────────────────────────────────────────────────────────────
// Descriptor registry — drives the generic, searchable Settings PAGE (Wave 1).
// Each cluster appends descriptors for its own keys; the page renders them.
// ─────────────────────────────────────────────────────────────────────────────
export type SettingControl = 'toggle' | 'number' | 'select' | 'color' | 'text';
export interface SettingDescriptor {
  /** Dot path into AppSettings, e.g. 'sounds.volume'. */
  path: string;
  /** Section heading on the settings page. */
  section: string;
  label: string;
  help?: string;
  control: SettingControl;
  options?: { value: string; label: string }[]; // select
  min?: number; max?: number; step?: number;     // number
  /** This setting can be overridden per-chart (a "this chart only" toggle appears). */
  perChart?: boolean;
}

export const SETTINGS_DESCRIPTORS: SettingDescriptor[] = [
  { path: 'general.confirmTrades', section: 'General', label: 'Confirm before trading', help: 'Ask for confirmation before placing or closing a trade.', control: 'toggle' },
  { path: 'general.oneClickTrading', section: 'General', label: 'One-click trading', help: 'Place SELL/BUY from the chart band INSTANTLY, with no confirmation. Orders execute on the first tap — use with care on a live account.', control: 'toggle' },
  { path: 'general.serverTimeInFooter', section: 'General', label: 'Broker server time in footer', control: 'toggle' },
  { path: 'appearance.theme', section: 'Appearance', label: 'Theme', help: 'Colour theme + retro pixel skins. Re-applies live (chart included).', control: 'select', options: [
    { value: 'dark', label: 'Dark' },
    { value: 'light', label: 'Light' },
    { value: 'tertiary', label: 'Tokyo Night' },
    { value: 'dracula', label: 'Dracula' },
    { value: 'nord', label: 'Nord' },
    { value: 'solarized', label: 'Solarized Light' },
    { value: 'matrix', label: 'Matrix' },
    { value: 'bloomberg', label: 'Bloomberg Amber' },
    { value: 'synthwave', label: 'Synthwave' },
    { value: 'cyberpunk', label: 'Cyberpunk' },
    { value: 'gruvbox', label: 'Gruvbox Dark' },
    { value: 'monokai', label: 'Monokai' },
    { value: '8bit', label: '8-bit (NES)' },
    { value: '16bit', label: '16-bit (SNES)' },
  ] },
  { path: 'chart.defaultType', section: 'Chart', label: 'Default chart type', help: 'The series type new charts open with.', control: 'select', perChart: true, options: [
    { value: 'candles', label: 'Candles' },
    { value: 'hollow', label: 'Hollow candles' },
    { value: 'heikinashi', label: 'Heikin Ashi' },
    { value: 'bars', label: 'OHLC bars' },
    { value: 'line', label: 'Line' },
    { value: 'area', label: 'Area' },
    { value: 'baseline', label: 'Baseline' },
  ] },
  { path: 'chart.showCountdown', section: 'Chart', label: 'Candle-countdown timer', help: 'Show time remaining on the forming bar.', control: 'toggle', perChart: true },
  { path: 'chart.watermark.enabled', section: 'Chart', label: 'Symbol watermark', help: 'Show a large faded symbol + timeframe behind the chart.', control: 'toggle' },
  { path: 'chart.watermark.fontSize', section: 'Chart', label: 'Watermark size', help: 'Font size (px) of the background symbol watermark.', control: 'number', min: 16, max: 200, step: 2 },
  // ── Session breaks (Item 13): MT5 period separators + session shading ──
  { path: 'chart.sessionBreaks.enabled', section: 'Chart', label: 'Session breaks', help: 'Draw MT5 period separators (new day / week / month) over the chart.', control: 'toggle', perChart: true },
  { path: 'chart.sessionBreaks.style', section: 'Chart', label: 'Session-break line style', help: 'Line style of the period separators.', control: 'select', perChart: true, options: [
    { value: 'solid', label: 'Solid' },
    { value: 'dashed', label: 'Dashed' },
    { value: 'dotted', label: 'Dotted' },
  ] },
  { path: 'chart.sessionBreaks.color', section: 'Chart', label: 'Session-break colour', help: 'Separator-line colour. Leave empty to follow the active theme.', control: 'color', perChart: true },
  { path: 'chart.sessionBreaks.showSessions', section: 'Chart', label: 'Session shading', help: 'Faintly tint alternating sessions between separators.', control: 'toggle', perChart: true },
  { path: 'sounds.enabled', section: 'Sounds', label: 'Enable sounds', help: 'Master switch for all synthesized cues (trades + alerts).', control: 'toggle' },
  { path: 'sounds.volume', section: 'Sounds', label: 'Master volume', control: 'number', min: 0, max: 1, step: 0.05 },
  { path: 'sounds.tradeOpen', section: 'Sounds', label: 'Trade-open sound', help: 'A rising chime when a position opens.', control: 'toggle' },
  { path: 'sounds.tradeClose', section: 'Sounds', label: 'Trade-close sound', help: 'A falling chime when a position closes.', control: 'toggle' },
  { path: 'sounds.alert', section: 'Sounds', label: 'Alert sound', help: 'A ping when a price alert triggers.', control: 'toggle' },
  { path: 'alerts.osNotifications', section: 'Alerts', label: 'OS notifications', help: 'Show a desktop notification (plus the in-app toast) when a price alert fires.', control: 'toggle' },
  { path: 'drawing.magnet', section: 'Drawing', label: 'Magnet (snap to O/H/L/C)', help: 'Snap new drawing points and dragged handles to the nearest candle open/high/low/close.', control: 'toggle' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Path + merge helpers (shared by main store and renderer store).
// ─────────────────────────────────────────────────────────────────────────────

/** Read a dot-path value (undefined if any segment is missing). */
export function getByPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), obj);
}

/** Set a dot-path value in place, creating intermediate objects as needed. */
export function setByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]!;
    if (o[k] == null || typeof o[k] !== 'object') o[k] = {};
    o = o[k] as Record<string, unknown>;
  }
  o[keys[keys.length - 1]!] = value;
}

/** Deep-merge `over` onto `base` (objects merge; arrays/primitives overwrite). */
export function deepMerge<T>(base: T, over: unknown): T {
  if (over == null || typeof over !== 'object' || Array.isArray(over)) return (over === undefined ? base : (over as T));
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const k of Object.keys(over as Record<string, unknown>)) {
    const b = (base as Record<string, unknown> | undefined)?.[k];
    const o = (over as Record<string, unknown>)[k];
    out[k] = b && typeof b === 'object' && !Array.isArray(b) ? deepMerge(b, o) : o;
  }
  return out as T;
}

// ─────────────────────────────────────────────────────────────────────────────
// "Apply to all charts" (Item 12) — promote the active chart's effective per-chart
// settings to the GLOBAL base, then clear every per-chart override for those keys so
// every chart inherits the same value.
// ─────────────────────────────────────────────────────────────────────────────

/** The dot-paths a chart can override per-chart (descriptors flagged `perChart`). The
 *  single source of truth for which keys "Apply to all charts" operates on. */
export const PER_CHART_PATHS: string[] = SETTINGS_DESCRIPTORS.filter((d) => d.perChart).map((d) => d.path);

/**
 * Return a NEW settings object where, for every per-chartable key, the GLOBAL/base value
 * is set to the value the chart `chartKey` is currently EFFECTIVELY showing (its
 * `perChart` override if present, else the existing base), and EVERY chart's `perChart`
 * override for those keys is removed — so all charts now inherit the same settings.
 *
 * Pure (no mutation of the input; deep-cloned) and unit-testable. A null/absent
 * `chartKey`, or a key the active chart doesn't override, simply keeps the base value
 * (the operation then only clears the OTHER charts' overrides of those keys). Per-chart
 * overrides of keys that are NOT per-chartable are left untouched.
 */
export function applyChartToAll(settings: AppSettings, chartKey: string | null): AppSettings {
  // Deep clone so the input is never mutated (settings is plain JSON-shaped).
  const next = JSON.parse(JSON.stringify(settings)) as AppSettings;
  const perChart = (next.perChart ?? {}) as Record<string, Record<string, unknown>>;
  const activeOverride = chartKey ? perChart[chartKey] : undefined;

  for (const path of PER_CHART_PATHS) {
    // The active chart's EFFECTIVE value = its override if present, else the base.
    const scoped = activeOverride ? getByPath(activeOverride, path) : undefined;
    const effective = scoped !== undefined ? scoped : getByPath(next, path);
    if (effective !== undefined) setByPath(next as unknown as Record<string, unknown>, path, effective);
    // Drop this key's override on EVERY chart (the active one included).
    for (const key of Object.keys(perChart)) deleteByPath(perChart[key]!, path);
  }
  // Prune any per-chart entry that became an empty object after clearing.
  for (const key of Object.keys(perChart)) {
    if (isEmptyDeep(perChart[key]!)) delete perChart[key];
  }
  return next;
}

/** Delete a dot-path leaf in place (and don't create intermediates). No-op if absent. */
function deleteByPath(obj: Record<string, unknown>, path: string): void {
  const keys = path.split('.');
  let o: Record<string, unknown> | undefined = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const v = o?.[keys[i]!];
    if (v == null || typeof v !== 'object') return; // path doesn't exist → nothing to delete
    o = v as Record<string, unknown>;
  }
  if (o) delete o[keys[keys.length - 1]!];
}

/** True when an object has no own enumerable keys, recursively (so a `perChart` entry
 *  left holding only now-empty sub-objects like `{chart:{}}` counts as empty + is pruned). */
function isEmptyDeep(v: unknown): boolean {
  if (v == null || typeof v !== 'object' || Array.isArray(v)) return false;
  const keys = Object.keys(v as Record<string, unknown>);
  if (keys.length === 0) return true;
  return keys.every((k) => isEmptyDeep((v as Record<string, unknown>)[k]));
}
