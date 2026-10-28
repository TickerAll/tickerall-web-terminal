/**
 * Theme tokens — Foundation 2 of the terminal build roadmap (area B).
 *
 * `ThemeTokens` is the complete set of themable colours: every one maps to a CSS
 * custom property on `:root` (consumed by `index.html`'s `<style>` block) AND to a
 * lightweight-charts option (via `chartTheme.ts`). `BUILTIN_THEMES` ships five
 * palettes; the **dark** theme's values are BYTE-IDENTICAL to the colours that were
 * hardcoded before the variable-ize pass, so the default UI renders pixel-identical.
 *
 * CSS-variable naming: a token `fooBar` becomes `--foo-bar`. The mapping is
 * mechanical (`tokenToCssVar`) so the ThemeProvider can apply the whole palette in a
 * loop, and index.html's `:root` lists the same `--foo-bar` names defaulting to the
 * dark values (so the app still renders before React mounts / if JS is slow).
 *
 * Adding a theme = add a `BUILTIN_THEMES` entry. Adding a token = add it to
 * `ThemeTokens`, give every theme a value, add the matching `--foo-bar` to
 * index.html's `:root`, and (if it is a chart colour) map it in `chartTheme.ts`.
 */

/** Every themable colour in the terminal. Keys are camelCase; the CSS var is the
 *  kebab-cased name (`panel2` → `--panel2`, `rowLine` → `--row-line`). */
export interface ThemeTokens {
  // ── Core surfaces & text (the original 11 :root tokens) ──
  bg: string;        // app background
  panel: string;     // panel / toolbar / card background
  panel2: string;    // recessed surface (inputs, studio, deep panels)
  line: string;      // hairline border
  line2: string;     // stronger border / divider
  fg: string;        // primary text
  muted: string;     // secondary text
  accent: string;    // brand / interactive accent (blue)
  up: string;        // bullish (candles, P&L positive)
  down: string;      // bearish (candles, P&L negative, errors)
  gold: string;      // overlay line / highlight (yellow)

  // ── Extra surfaces introduced by the variable-ize pass ──
  onAccent: string;     // text/icon ON an accent/up/down fill (was #fff)
  hover: string;        // hover background for tf/buttons/tree rows (was #161d27)
  sel: string;          // selected-row / active-file background (was #16202c)
  rowLine: string;      // faint inner row border (was #131a22)
  rowHover: string;     // table-row hover background (was #131a22)
  surface: string;      // panel-header / tab strip surface (was #0f141b)
  acctActive: string;   // active account row background (was #101822)
  inputRo: string;      // read-only input background (was #0c1014)
  lineHover: string;    // border on hover for ebtn (was #2f3b49)
  googleFg: string;     // Google sign-in button text (was #1f1f1f)
  shadow: string;       // dialog drop shadow colour (was #000a)
  backdrop: string;     // modal backdrop scrim (was #0008)
  chartLoadingBg: string; // chart "loading history" pill bg (was rgba(14,17,22,.92))

  // ── "Green" accent family (success / run / new-order, distinct from `up`) ──
  green: string;        // bright green text (was #3fb950)
  greenGlow: string;    // green dot glow (was #3fb95088)
  greenBg: string;      // green button fill (was #12331f)
  greenLine: string;    // green button border (was #1c4a2c)
  greenBgHover: string; // green button hover fill (was #163e25)
  amber: string;        // offline / warning dot (was #d29922)

  // ── "Connecting" pill ──
  pillFg: string;       // pill text (was #9cc4ff)
  pillBg: string;       // pill background (was #11233f)
  pillLine: string;     // pill border (was #1d3a63)

  // ── Chart colours (lightweight-charts; see chartTheme.ts) ──
  chartBg: string;      // main chart background (was #0e1116)
  scaleText: string;    // price/time scale label text (was #9aa4b2)
  grid: string;         // chart grid lines (was #161d27)
  scaleBorder: string;  // price/time scale border (was #222b36)
  upBody: string;       // candle up body+wick (was #26a69a == up)
  downBody: string;     // candle down body+wick (was #ef5350 == down)
  wick: string;         // wick colour (defaults to body colours; single override)
  candleBorder: string; // candle border (transparent by default)
  watermark: string;    // chart watermark colour (symbol/TF or logo)
  // Equity chart
  equityBg: string;     // equity chart background (was #0d1117)
  equityText: string;   // equity chart scale text (was #7d8590)
  equityLine: string;   // equity curve (was #2f81f7 == accent)
  balanceLine: string;  // balance curve (was #7d8590 == muted)
}

/** A named theme: its id, label, token palette, and an optional extra body class
 *  for skin chrome (pixel font, scanlines). */
export interface ThemeDef {
  id: string;
  name: string;
  tokens: ThemeTokens;
  /** Extra `<body>` class for skins, e.g. `'theme-8bit'`. The ThemeProvider always
   *  also sets `theme-<id>` on the body, but `body` lets a skin reuse a shared
   *  chrome class (`theme-8bit` and `theme-16bit` both opt into the pixel chrome). */
  body?: string;
  /** Whether this theme is a "light" base (used only for sensible UA defaults; the
   *  tokens are authoritative). */
  light?: boolean;
  /** Turn on the CRT/scanline overlay for this skin. */
  crt?: boolean;
  /** A "cute" theme whose candles render as kitties (the additive KittyLayer overlay
   *  draws cat ears + a face on each candle when the active theme has this flag). NOT a
   *  skin `body` class — that would force the pixel font (see ThemeProvider). */
  kitty?: boolean;
}

/** Map a token key to its CSS custom-property name: `rowLine` → `--row-line`. */
export function tokenToCssVar(key: string): string {
  return '--' + key.replace(/([A-Z])/g, '-$1').toLowerCase();
}

/** The ordered list of token keys (stable; drives the apply loop + the var list). */
export const TOKEN_KEYS = [
  'bg', 'panel', 'panel2', 'line', 'line2', 'fg', 'muted', 'accent', 'up', 'down', 'gold',
  'onAccent', 'hover', 'sel', 'rowLine', 'rowHover', 'surface', 'acctActive', 'inputRo',
  'lineHover', 'googleFg', 'shadow', 'backdrop', 'chartLoadingBg',
  'green', 'greenGlow', 'greenBg', 'greenLine', 'greenBgHover', 'amber',
  'pillFg', 'pillBg', 'pillLine',
  'chartBg', 'scaleText', 'grid', 'scaleBorder', 'upBody', 'downBody', 'wick',
  'candleBorder', 'watermark',
  'equityBg', 'equityText', 'equityLine', 'balanceLine',
] as const satisfies readonly (keyof ThemeTokens)[];

// ─────────────────────────────────────────────────────────────────────────────
// DARK — the byte-identical default. Every value here is exactly the literal that
// was hardcoded in index.html / Chart.tsx / EquityChart.tsx before this change.
// DO NOT change any value without re-proving the pixel-identical guarantee.
// ─────────────────────────────────────────────────────────────────────────────
const DARK: ThemeTokens = {
  bg: '#0e1116', panel: '#11161d', panel2: '#0d1117', line: '#1d2530', line2: '#28323f',
  fg: '#c9d1d9', muted: '#7d8590', accent: '#2f81f7', up: '#26a69a', down: '#ef5350', gold: '#f0b90b',
  onAccent: '#fff', hover: '#161d27', sel: '#16202c', rowLine: '#131a22', rowHover: '#131a22',
  surface: '#0f141b', acctActive: '#101822', inputRo: '#0c1014', lineHover: '#2f3b49',
  googleFg: '#1f1f1f', shadow: '#000a', backdrop: '#0008', chartLoadingBg: 'rgba(14,17,22,0.92)',
  green: '#3fb950', greenGlow: '#3fb95088', greenBg: '#12331f', greenLine: '#1c4a2c', greenBgHover: '#163e25',
  amber: '#d29922', pillFg: '#9cc4ff', pillBg: '#11233f', pillLine: '#1d3a63',
  chartBg: '#0e1116', scaleText: '#9aa4b2', grid: '#161d27', scaleBorder: '#222b36',
  upBody: '#26a69a', downBody: '#ef5350', wick: '#26a69a', candleBorder: 'transparent',
  watermark: 'rgba(124,133,144,0.10)',
  equityBg: '#0d1117', equityText: '#7d8590', equityLine: '#2f81f7', balanceLine: '#7d8590',
};

// ─────────────────────────────────────────────────────────────────────────────
// LIGHT — a clean daytime palette (TradingView-light-ish). Greens/reds kept legible
// on white; the green accent family re-tinted for light surfaces.
// ─────────────────────────────────────────────────────────────────────────────
const LIGHT: ThemeTokens = {
  bg: '#ffffff', panel: '#f4f6f9', panel2: '#eef1f5', line: '#dfe3eb', line2: '#cbd2dd',
  fg: '#1f2733', muted: '#697586', accent: '#2962ff', up: '#089981', down: '#e02f44', gold: '#c08a00',
  onAccent: '#ffffff', hover: '#e6ebf2', sel: '#dce6f7', rowLine: '#eaedf2', rowHover: '#eef2f8',
  surface: '#eef1f5', acctActive: '#e3ecfb', inputRo: '#e9edf3', lineHover: '#b6c0cf',
  googleFg: '#1f1f1f', shadow: '#0003', backdrop: '#0006', chartLoadingBg: 'rgba(255,255,255,0.92)',
  green: '#0a8a3a', greenGlow: '#0a8a3a55', greenBg: '#e3f5ea', greenLine: '#9bd9b3', greenBgHover: '#d4efdd',
  amber: '#b6791f', pillFg: '#2456c9', pillBg: '#e4ecfb', pillLine: '#bcd0f5',
  chartBg: '#ffffff', scaleText: '#697586', grid: '#eaedf2', scaleBorder: '#cbd2dd',
  upBody: '#089981', downBody: '#e02f44', wick: '#089981', candleBorder: 'transparent',
  watermark: 'rgba(31,39,51,0.07)',
  equityBg: '#f4f6f9', equityText: '#697586', equityLine: '#2962ff', balanceLine: '#9aa6b6',
};

// ─────────────────────────────────────────────────────────────────────────────
// TERTIARY — a distinct third palette: a warm "Solarized/amber-on-charcoal" terminal
// look. Teal accent, amber gold, warm greys — clearly different from dark & light.
// ─────────────────────────────────────────────────────────────────────────────
const TERTIARY: ThemeTokens = {
  bg: '#1a1b26', panel: '#1f2130', panel2: '#181a24', line: '#2b2e42', line2: '#3b3f5c',
  fg: '#c0caf5', muted: '#8089b3', accent: '#7aa2f7', up: '#9ece6a', down: '#f7768e', gold: '#e0af68',
  onAccent: '#11121a', hover: '#262a40', sel: '#2c324b', rowLine: '#22253a', rowHover: '#22253a',
  surface: '#191b28', acctActive: '#222740', inputRo: '#141620', lineHover: '#414768',
  googleFg: '#1f1f1f', shadow: '#0009', backdrop: '#0008', chartLoadingBg: 'rgba(26,27,38,0.92)',
  green: '#9ece6a', greenGlow: '#9ece6a55', greenBg: '#1f3326', greenLine: '#2f5238', greenBgHover: '#274430',
  amber: '#e0af68', pillFg: '#bb9af7', pillBg: '#241f3a', pillLine: '#3b3163',
  chartBg: '#1a1b26', scaleText: '#8089b3', grid: '#23263a', scaleBorder: '#2f3350',
  upBody: '#9ece6a', downBody: '#f7768e', wick: '#9ece6a', candleBorder: 'transparent',
  watermark: 'rgba(192,202,245,0.08)',
  equityBg: '#181a24', equityText: '#8089b3', equityLine: '#7aa2f7', balanceLine: '#565f89',
};

// ─────────────────────────────────────────────────────────────────────────────
// 8-BIT — a NES/SNES startup-screen palette: deep midnight-blue chrome, hot-magenta
// accent, NES green/red, chunky borders + pixel font + scanlines (set via body/crt).
// Bold, saturated, low-shade-count — reads as 8-bit.
// ─────────────────────────────────────────────────────────────────────────────
const EIGHT_BIT: ThemeTokens = {
  bg: '#0b0c2a', panel: '#161a4a', panel2: '#10123a', line: '#3b3fa0', line2: '#5860d8',
  fg: '#e8ecff', muted: '#9aa0e0', accent: '#ff3cac', up: '#00e436', down: '#ff004d', gold: '#ffd800',
  onAccent: '#0b0c2a', hover: '#222a78', sel: '#2d36a0', rowLine: '#272c70', rowHover: '#272c70',
  surface: '#10123a', acctActive: '#283095', inputRo: '#0a0b28', lineHover: '#7780ff',
  googleFg: '#1f1f1f', shadow: '#000c', backdrop: '#000a', chartLoadingBg: 'rgba(11,12,42,0.95)',
  green: '#00e436', greenGlow: '#00e43688', greenBg: '#0a3a18', greenLine: '#149c34', greenBgHover: '#0e5220',
  amber: '#ffa300', pillFg: '#41ead4', pillBg: '#12244a', pillLine: '#2e63b8',
  chartBg: '#0b0c2a', scaleText: '#9aa0e0', grid: '#1f2470', scaleBorder: '#5860d8',
  upBody: '#00e436', downBody: '#ff004d', wick: '#ffd800', candleBorder: '#ffd800',
  watermark: 'rgba(255,60,172,0.12)',
  equityBg: '#10123a', equityText: '#9aa0e0', equityLine: '#41ead4', balanceLine: '#ffd800',
};

// ─────────────────────────────────────────────────────────────────────────────
// 16-BIT — a SNES-era palette: softer purples + a richer spread of shades than 8-bit,
// teal/coral candles, royal-purple accent. Same pixel chrome (body/crt) but a more
// "Mode 7" pastel-saturated look than the harsh NES 8-bit.
// ─────────────────────────────────────────────────────────────────────────────
const SIXTEEN_BIT: ThemeTokens = {
  bg: '#2b1b46', panel: '#3a2560', panel2: '#311e52', line: '#5a3f8c', line2: '#7e5cc0',
  fg: '#f3e9ff', muted: '#b89ce0', accent: '#c084fc', up: '#3ddc97', down: '#ff5c8a', gold: '#ffd23f',
  onAccent: '#241038', hover: '#4a3175', sel: '#583a8c', rowLine: '#46306f', rowHover: '#46306f',
  surface: '#311e52', acctActive: '#523a86', inputRo: '#271640', lineHover: '#9b73e0',
  googleFg: '#1f1f1f', shadow: '#000b', backdrop: '#0009', chartLoadingBg: 'rgba(43,27,70,0.95)',
  green: '#3ddc97', greenGlow: '#3ddc9788', greenBg: '#173a2c', greenLine: '#268a5e', greenBgHover: '#1d5240',
  amber: '#ffb454', pillFg: '#7de2ff', pillBg: '#2a2456', pillLine: '#5249b8',
  chartBg: '#2b1b46', scaleText: '#b89ce0', grid: '#46306f', scaleBorder: '#7e5cc0',
  upBody: '#3ddc97', downBody: '#ff5c8a', wick: '#ffd23f', candleBorder: '#ffd23f',
  watermark: 'rgba(192,132,252,0.12)',
  equityBg: '#311e52', equityText: '#b89ce0', equityLine: '#7de2ff', balanceLine: '#ffd23f',
};

// ─────────────────────────────────────────────────────────────────────────────
// MATRIX — "like the movie": phosphor-green glyphs on a black void, with a digital-rain
// backdrop (mounted by the ThemeProvider) + CRT scanlines. Panels are slightly
// translucent so the rain glows faintly behind the UI; the chart stays opaque/clear.
// ─────────────────────────────────────────────────────────────────────────────
const MATRIX: ThemeTokens = {
  bg: '#000000', panel: 'rgba(4,17,9,0.86)', panel2: 'rgba(2,11,5,0.9)', line: '#0d3d1a', line2: '#16933a',
  fg: '#27ff63', muted: '#1f9d3a', accent: '#39ff14', up: '#00ff41', down: '#0a7d28', gold: '#aaff5a',
  onAccent: '#000000', hover: 'rgba(13,61,26,0.5)', sel: 'rgba(18,85,34,0.55)', rowLine: '#0c2a14', rowHover: 'rgba(12,46,20,0.5)',
  surface: 'rgba(2,13,6,0.88)', acctActive: 'rgba(15,61,28,0.6)', inputRo: '#020a04', lineHover: '#1f9d3a',
  googleFg: '#1f1f1f', shadow: '#000d', backdrop: 'rgba(0,12,2,0.78)', chartLoadingBg: 'rgba(0,0,0,0.92)',
  green: '#00ff41', greenGlow: '#00ff4188', greenBg: '#0a3315', greenLine: '#1c6a2c', greenBgHover: '#0e4a1e',
  amber: '#aaff00', pillFg: '#7dffaa', pillBg: 'rgba(10,46,24,0.8)', pillLine: '#1d6a3a',
  chartBg: '#000000', scaleText: '#1f9d3a', grid: '#0c2e16', scaleBorder: '#16933a',
  upBody: '#00ff41', downBody: '#0a7d28', wick: '#00ff41', candleBorder: 'transparent',
  watermark: 'rgba(0,255,65,0.10)',
  equityBg: 'rgba(2,13,6,0.9)', equityText: '#1f9d3a', equityLine: '#00ff41', balanceLine: '#1f9d3a',
};

// ─────────────────────────────────────────────────────────────────────────────
// DRACULA — the canonical Dracula palette: a desaturated dark-slate background
// (#282a36) with the signature purple/pink/cyan accents. Purple is the interactive
// accent, green/red for candles & P&L, the famous yellow for the gold/overlay.
// Distinct from Tokyo Night by its warmer slate-grey base and pink-leaning accents.
// ─────────────────────────────────────────────────────────────────────────────
const DRACULA: ThemeTokens = {
  bg: '#282a36', panel: '#2f323e', panel2: '#22242e', line: '#3b3e4d', line2: '#4b4f63',
  fg: '#f8f8f2', muted: '#9ea3bd', accent: '#bd93f9', up: '#50fa7b', down: '#ff5555', gold: '#f1fa8c',
  onAccent: '#21222c', hover: '#383b49', sel: '#44475a', rowLine: '#2c2e3a', rowHover: '#33363f',
  surface: '#21222c', acctActive: '#3c3f51', inputRo: '#1d1e26', lineHover: '#5a5f76',
  googleFg: '#1f1f1f', shadow: '#000a', backdrop: '#0008', chartLoadingBg: 'rgba(40,42,54,0.92)',
  green: '#50fa7b', greenGlow: '#50fa7b88', greenBg: '#143a23', greenLine: '#2a6e42', greenBgHover: '#1b522f',
  amber: '#ffb86c', pillFg: '#8be9fd', pillBg: '#1f3a44', pillLine: '#2f6678',
  chartBg: '#282a36', scaleText: '#9ea3bd', grid: '#34374a', scaleBorder: '#4b4f63',
  upBody: '#50fa7b', downBody: '#ff5555', wick: '#9ea3bd', candleBorder: 'transparent',
  watermark: 'rgba(189,147,249,0.10)',
  equityBg: '#22242e', equityText: '#9ea3bd', equityLine: '#bd93f9', balanceLine: '#6272a4',
};

// ─────────────────────────────────────────────────────────────────────────────
// NORD — the cool "arctic" Nord palette: Polar Night greys (#2e3440 family) with the
// frost-blue accent (#88c0d0) and the muted Aurora green/red for candles. A calm,
// low-contrast blue-grey look — clearly cooler & flatter than Dracula/Tokyo Night.
// ─────────────────────────────────────────────────────────────────────────────
const NORD: ThemeTokens = {
  bg: '#2e3440', panel: '#343b48', panel2: '#2b303b', line: '#3f4757', line2: '#4c566a',
  fg: '#eceff4', muted: '#9aa3b5', accent: '#88c0d0', up: '#a3be8c', down: '#bf616a', gold: '#ebcb8b',
  onAccent: '#2e3440', hover: '#3b4252', sel: '#434c5e', rowLine: '#333a47', rowHover: '#3a4252',
  surface: '#2b303b', acctActive: '#3d4659', inputRo: '#272c36', lineHover: '#5a657c',
  googleFg: '#1f1f1f', shadow: '#000a', backdrop: '#0008', chartLoadingBg: 'rgba(46,52,64,0.92)',
  green: '#a3be8c', greenGlow: '#a3be8c88', greenBg: '#28361f', greenLine: '#4a6238', greenBgHover: '#324628',
  amber: '#d08770', pillFg: '#88c0d0', pillBg: '#28323f', pillLine: '#3b5366',
  chartBg: '#2e3440', scaleText: '#9aa3b5', grid: '#363d4b', scaleBorder: '#4c566a',
  upBody: '#a3be8c', downBody: '#bf616a', wick: '#9aa3b5', candleBorder: 'transparent',
  watermark: 'rgba(136,192,208,0.10)',
  equityBg: '#2b303b', equityText: '#9aa3b5', equityLine: '#81a1c1', balanceLine: '#677591',
};

// ─────────────────────────────────────────────────────────────────────────────
// SOLARIZED LIGHT — Ethan Schoonover's canonical warm-paper light base16. Cream
// background (#fdf6e3), muted base-content text, the signature blue accent with
// solarized green/red for candles. The only warm LIGHT theme — sets `light: true`.
// ─────────────────────────────────────────────────────────────────────────────
const SOLARIZED_LIGHT: ThemeTokens = {
  bg: '#fdf6e3', panel: '#f3ecd5', panel2: '#eee8d5', line: '#e3dcc4', line2: '#d3cbb0',
  fg: '#586e75', muted: '#93a1a1', accent: '#268bd2', up: '#859900', down: '#dc322f', gold: '#b58900',
  onAccent: '#fdf6e3', hover: '#ece5cf', sel: '#dfe6cf', rowLine: '#ece5d0', rowHover: '#f0e9d4',
  surface: '#eee8d5', acctActive: '#e3ead2', inputRo: '#eae3cd', lineHover: '#c4bca0',
  googleFg: '#1f1f1f', shadow: '#5a4a2033', backdrop: '#3a30100a', chartLoadingBg: 'rgba(253,246,227,0.92)',
  green: '#6f8400', greenGlow: '#6f840055', greenBg: '#e6ecc8', greenLine: '#bcca8a', greenBgHover: '#dde6b4',
  amber: '#b58900', pillFg: '#1e6fa8', pillBg: '#e1ecf5', pillLine: '#bcd6ea',
  chartBg: '#fdf6e3', scaleText: '#93a1a1', grid: '#ece5d0', scaleBorder: '#d3cbb0',
  upBody: '#859900', downBody: '#dc322f', wick: '#93a1a1', candleBorder: 'transparent',
  watermark: 'rgba(88,110,117,0.08)',
  equityBg: '#f3ecd5', equityText: '#93a1a1', equityLine: '#268bd2', balanceLine: '#a3b0aa',
};

// ─────────────────────────────────────────────────────────────────────────────
// BLOOMBERG AMBER — the classic trading-terminal look: amber/orange phosphor text
// (#ffb000) + accents on near-black, the way a Bloomberg/old-CRT trading desk reads.
// The amber owns the chrome (text, accent, gold, pill); candles stay a legible
// green/red so bid/ask direction is never lost in the amber. No CRT class — clean.
// ─────────────────────────────────────────────────────────────────────────────
const BLOOMBERG_AMBER: ThemeTokens = {
  bg: '#0a0700', panel: '#140e02', panel2: '#0e0a01', line: '#3a2a07', line2: '#5a4210',
  fg: '#ffb000', muted: '#a8741a', accent: '#ff8c00', up: '#3fd07a', down: '#ff5a52', gold: '#ffd000',
  onAccent: '#0a0700', hover: '#241a04', sel: '#33260a', rowLine: '#1f1603', rowHover: '#241a04',
  surface: '#100b01', acctActive: '#2c2007', inputRo: '#080500', lineHover: '#6e5212',
  googleFg: '#1f1f1f', shadow: '#000c', backdrop: '#000a', chartLoadingBg: 'rgba(10,7,0,0.95)',
  green: '#3fd07a', greenGlow: '#3fd07a88', greenBg: '#0d3a1d', greenLine: '#1f6a38', greenBgHover: '#125128',
  amber: '#ffb000', pillFg: '#ffc24d', pillBg: '#2a1d04', pillLine: '#5a4210',
  chartBg: '#0a0700', scaleText: '#a8741a', grid: '#241a04', scaleBorder: '#3a2a07',
  upBody: '#3fd07a', downBody: '#ff5a52', wick: '#a8741a', candleBorder: 'transparent',
  watermark: 'rgba(255,176,0,0.08)',
  equityBg: '#0e0a01', equityText: '#a8741a', equityLine: '#ff8c00', balanceLine: '#a8741a',
};

// ─────────────────────────────────────────────────────────────────────────────
// SYNTHWAVE — retrowave / outrun: hot-pink + cyan neon on deep indigo-purple, with a
// glowing sunset feel. Magenta is the interactive accent; cyan rides the pill/green
// family; candles are a neon green-up / hot-magenta-down that stay clearly distinct.
// ─────────────────────────────────────────────────────────────────────────────
const SYNTHWAVE: ThemeTokens = {
  bg: '#1a1033', panel: '#241546', panel2: '#1d0f3a', line: '#3a2168', line2: '#52308f',
  fg: '#f6e9ff', muted: '#b48ce0', accent: '#ff2a6d', up: '#05ffa1', down: '#ff2e88', gold: '#ffd319',
  onAccent: '#160a2e', hover: '#311b57', sel: '#3d2168', rowLine: '#291650', rowHover: '#311b57',
  surface: '#1d0f3a', acctActive: '#3a2168', inputRo: '#160a2e', lineHover: '#6a3fb0',
  googleFg: '#1f1f1f', shadow: '#000c', backdrop: '#0c0420cc', chartLoadingBg: 'rgba(26,16,51,0.95)',
  green: '#05ffa1', greenGlow: '#05ffa188', greenBg: '#0a3a2a', greenLine: '#10845c', greenBgHover: '#0e5240',
  amber: '#ffae00', pillFg: '#00e5ff', pillBg: '#13294a', pillLine: '#1f5e8f',
  chartBg: '#1a1033', scaleText: '#b48ce0', grid: '#2c1a55', scaleBorder: '#3a2168',
  upBody: '#05ffa1', downBody: '#ff2e88', wick: '#01cfff', candleBorder: 'transparent',
  watermark: 'rgba(255,42,109,0.10)',
  equityBg: '#1d0f3a', equityText: '#b48ce0', equityLine: '#00e5ff', balanceLine: '#7a5cb0',
};

// ─────────────────────────────────────────────────────────────────────────────
// CYBERPUNK — high-voltage yellow + cyan on near-black, punchy and electric. Yellow
// is the loud accent/gold; cyan is the cool counter-accent (pill); candles use a
// bright cyan-up / hot-red-down so the two charge directions never blur together.
// ─────────────────────────────────────────────────────────────────────────────
const CYBERPUNK: ThemeTokens = {
  bg: '#050608', panel: '#0c1014', panel2: '#070a0d', line: '#1a2a2e', line2: '#2a4248',
  fg: '#fcee0a', muted: '#7fb0a6', accent: '#fcee0a', up: '#00f0ff', down: '#ff003c', gold: '#fcee0a',
  onAccent: '#050608', hover: '#10181c', sel: '#15252a', rowLine: '#0d1518', rowHover: '#10181c',
  surface: '#080c0f', acctActive: '#11232a', inputRo: '#040506', lineHover: '#1f5a60',
  googleFg: '#1f1f1f', shadow: '#000d', backdrop: '#000b', chartLoadingBg: 'rgba(5,6,8,0.95)',
  green: '#00f0ff', greenGlow: '#00f0ff88', greenBg: '#063238', greenLine: '#0c6a76', greenBgHover: '#0a4a52',
  amber: '#ffaa00', pillFg: '#00f0ff', pillBg: '#06262c', pillLine: '#0f5a64',
  chartBg: '#050608', scaleText: '#7fb0a6', grid: '#11201f', scaleBorder: '#1f3236',
  upBody: '#00f0ff', downBody: '#ff003c', wick: '#fcee0a', candleBorder: 'transparent',
  watermark: 'rgba(252,238,10,0.09)',
  equityBg: '#070a0d', equityText: '#7fb0a6', equityLine: '#00f0ff', balanceLine: '#5a8079',
};

// ─────────────────────────────────────────────────────────────────────────────
// GRUVBOX DARK — the warm retro-dev palette: muted brown-grey background (#282828)
// with the signature soft orange/aqua/green earth tones. Aqua is the accent, orange
// the gold; candles use gruvbox green-up / red-down — easy on the eyes, low-glare.
// ─────────────────────────────────────────────────────────────────────────────
const GRUVBOX_DARK: ThemeTokens = {
  bg: '#282828', panel: '#32302f', panel2: '#1d2021', line: '#3c3836', line2: '#504945',
  fg: '#ebdbb2', muted: '#a89984', accent: '#8ec07c', up: '#b8bb26', down: '#fb4934', gold: '#fabd2f',
  onAccent: '#1d2021', hover: '#3c3836', sel: '#45403d', rowLine: '#302e2c', rowHover: '#383432',
  surface: '#242120', acctActive: '#403d3a', inputRo: '#1b1c1d', lineHover: '#665c54',
  googleFg: '#1f1f1f', shadow: '#000a', backdrop: '#0008', chartLoadingBg: 'rgba(40,40,40,0.93)',
  green: '#b8bb26', greenGlow: '#b8bb2688', greenBg: '#33380f', greenLine: '#5a6420', greenBgHover: '#444c17',
  amber: '#fe8019', pillFg: '#83a598', pillBg: '#283636', pillLine: '#3c5755',
  chartBg: '#282828', scaleText: '#a89984', grid: '#36322f', scaleBorder: '#504945',
  upBody: '#b8bb26', downBody: '#fb4934', wick: '#a89984', candleBorder: 'transparent',
  watermark: 'rgba(235,219,178,0.08)',
  equityBg: '#1d2021', equityText: '#a89984', equityLine: '#83a598', balanceLine: '#7c6f64',
};

// ─────────────────────────────────────────────────────────────────────────────
// MONOKAI — the classic editor palette: charcoal background (#272822) with the
// signature lime/orange/magenta/cyan accents. Magenta is the interactive accent,
// cyan the pill, yellow the gold; candles use monokai green-up / red(pink)-down.
// ─────────────────────────────────────────────────────────────────────────────
const MONOKAI: ThemeTokens = {
  bg: '#272822', panel: '#2f302a', panel2: '#1f201b', line: '#3b3c34', line2: '#4d4e44',
  fg: '#f8f8f2', muted: '#9d9d8a', accent: '#f92672', up: '#a6e22e', down: '#f9325a', gold: '#e6db74',
  onAccent: '#1f201b', hover: '#383931', sel: '#44453b', rowLine: '#2d2e27', rowHover: '#34352d',
  surface: '#23241e', acctActive: '#3f4037', inputRo: '#1c1d18', lineHover: '#615f4f',
  googleFg: '#1f1f1f', shadow: '#000a', backdrop: '#0008', chartLoadingBg: 'rgba(39,40,34,0.93)',
  green: '#a6e22e', greenGlow: '#a6e22e88', greenBg: '#2c3a10', greenLine: '#557020', greenBgHover: '#3c5217',
  amber: '#fd971f', pillFg: '#66d9ef', pillBg: '#16323a', pillLine: '#245560',
  chartBg: '#272822', scaleText: '#9d9d8a', grid: '#34352d', scaleBorder: '#4d4e44',
  upBody: '#a6e22e', downBody: '#f9325a', wick: '#9d9d8a', candleBorder: 'transparent',
  watermark: 'rgba(248,248,242,0.07)',
  equityBg: '#1f201b', equityText: '#9d9d8a', equityLine: '#66d9ef', balanceLine: '#75715e',
};

// ─────────────────────────────────────────────────────────────────────────────
// COTTON CANDY — a cute DARK theme: deep-plum chrome with a sky-blue accent, mint "up"
// and bubblegum-pink "down", soft pink-white text. The candles render as kitties
// (kitty: true → KittyLayer). Pastel-on-dark so it's cute without being bright.
// ─────────────────────────────────────────────────────────────────────────────
const COTTON_CANDY: ThemeTokens = {
  bg: '#1a1320', panel: '#241a2c', panel2: '#1f1626', line: '#3a2c44', line2: '#4e3b5c',
  fg: '#ffe1f0', muted: '#c79bb5', accent: '#7ad7ff', up: '#5fe0b0', down: '#ff8fb8', gold: '#ffd97a',
  onAccent: '#1a1320', hover: '#2e2138', sel: '#382846', rowLine: '#281c30', rowHover: '#2c2034',
  surface: '#1f1626', acctActive: '#352544', inputRo: '#181020', lineHover: '#6a5078',
  googleFg: '#1f1f1f', shadow: '#000b', backdrop: 'rgba(20,10,24,0.6)', chartLoadingBg: 'rgba(26,19,32,0.92)',
  green: '#3fd49a', greenGlow: '#3fd49a88', greenBg: '#163a2c', greenLine: '#2a6e50', greenBgHover: '#1f5240',
  amber: '#ffb454', pillFg: '#7ad7ff', pillBg: '#1d3346', pillLine: '#2f5e7a',
  chartBg: '#1a1320', scaleText: '#c79bb5', grid: '#2a1f33', scaleBorder: '#4e3b5c',
  upBody: '#5fe0b0', downBody: '#ff8fb8', wick: '#c79bb5', candleBorder: 'transparent',
  watermark: 'rgba(255,225,240,0.07)',
  equityBg: '#241a2c', equityText: '#c79bb5', equityLine: '#7ad7ff', balanceLine: '#c79bb5',
};

// ─────────────────────────────────────────────────────────────────────────────
// MACARON — the other cute DARK theme: dark-indigo chrome with a periwinkle accent, mint
// "up" and peach-pink "down", soft lavender text. Also renders kitty candles. A calmer
// purple-pastel-on-dark sibling to Cotton Candy.
// ─────────────────────────────────────────────────────────────────────────────
const MACARON: ThemeTokens = {
  bg: '#15131f', panel: '#1f1c2e', panel2: '#1a1726', line: '#332e48', line2: '#463f60',
  fg: '#ece6ff', muted: '#a89fce', accent: '#b3a4ff', up: '#6fe0c0', down: '#ffa0c0', gold: '#ffd98a',
  onAccent: '#15131f', hover: '#2a2640', sel: '#332e4e', rowLine: '#241f36', rowHover: '#28233c',
  surface: '#1a1726', acctActive: '#312b4a', inputRo: '#161320', lineHover: '#6a5fa0',
  googleFg: '#1f1f1f', shadow: '#000b', backdrop: 'rgba(16,12,28,0.6)', chartLoadingBg: 'rgba(21,19,31,0.92)',
  green: '#4fcfa8', greenGlow: '#4fcfa888', greenBg: '#163a30', greenLine: '#2a6e58', greenBgHover: '#1f5246',
  amber: '#ffb866', pillFg: '#b3a4ff', pillBg: '#221f3e', pillLine: '#3a3266',
  chartBg: '#15131f', scaleText: '#a89fce', grid: '#262138', scaleBorder: '#463f60',
  upBody: '#6fe0c0', downBody: '#ffa0c0', wick: '#a89fce', candleBorder: 'transparent',
  watermark: 'rgba(236,230,255,0.07)',
  equityBg: '#1f1c2e', equityText: '#a89fce', equityLine: '#b3a4ff', balanceLine: '#a89fce',
};

// ─────────────────────────────────────────────────────────────────────────────
// BLACK & WHITE — a pure monochrome theme: black void, white text, grayscale chrome.
// Direction is encoded by LUMINANCE, not hue — "up"/BUY is near-white, "down"/SELL is
// mid-gray; candles are a white up-body vs a dark down-body with a gray border so the
// dark down candles stay visible against the black background.
// ─────────────────────────────────────────────────────────────────────────────
const MONO: ThemeTokens = {
  bg: '#000000', panel: '#0c0c0c', panel2: '#070707', line: '#262626', line2: '#3a3a3a',
  fg: '#f5f5f5', muted: '#9a9a9a', accent: '#e6e6e6', up: '#ffffff', down: '#6e6e6e', gold: '#c4c4c4',
  onAccent: '#000000', hover: '#1a1a1a', sel: '#222222', rowLine: '#141414', rowHover: '#161616',
  surface: '#0a0a0a', acctActive: '#1f1f1f', inputRo: '#050505', lineHover: '#4a4a4a',
  googleFg: '#1f1f1f', shadow: '#000c', backdrop: '#000a', chartLoadingBg: 'rgba(0,0,0,0.92)',
  green: '#d0d0d0', greenGlow: '#d0d0d088', greenBg: '#1c1c1c', greenLine: '#3a3a3a', greenBgHover: '#262626',
  amber: '#b0b0b0', pillFg: '#d0d0d0', pillBg: '#1a1a1a', pillLine: '#3a3a3a',
  chartBg: '#000000', scaleText: '#9a9a9a', grid: '#1c1c1c', scaleBorder: '#3a3a3a',
  upBody: '#f0f0f0', downBody: '#555555', wick: '#b0b0b0', candleBorder: '#777777',
  watermark: 'rgba(245,245,245,0.06)',
  equityBg: '#0a0a0a', equityText: '#9a9a9a', equityLine: '#e6e6e6', balanceLine: '#777777',
};

// ─────────────────────────────────────────────────────────────────────────────
// BLUEPRINT — an architect's cyanotype: deep prussian-blue "paper", white/cyan ink, a
// prominent graph-paper grid. Cold + technical. Candles read as ink: mint-cyan "up" vs a
// red-pencil "correction" coral "down"; cyan-outlined bodies reinforce the schematic look.
// ─────────────────────────────────────────────────────────────────────────────
const BLUEPRINT: ThemeTokens = {
  bg: '#0b2a45', panel: '#103655', panel2: '#0c2c48', line: '#1d4a73', line2: '#2e6296',
  fg: '#e8f4ff', muted: '#84b4dc', accent: '#3fd0ff', up: '#5fe0c0', down: '#ff7a59', gold: '#ffd24d',
  onAccent: '#06203a', hover: '#16466e', sel: '#1d5589', rowLine: '#123c60', rowHover: '#15466e',
  surface: '#0c2c48', acctActive: '#1a5082', inputRo: '#082338', lineHover: '#3a78a8',
  googleFg: '#1f1f1f', shadow: '#00101e99', backdrop: 'rgba(4,18,32,0.62)', chartLoadingBg: 'rgba(11,42,69,0.92)',
  green: '#3fc7a0', greenGlow: '#3fc7a088', greenBg: '#0d3a4a', greenLine: '#1f6a70', greenBgHover: '#125260',
  amber: '#ffc24d', pillFg: '#7fe0ff', pillBg: '#0f3a5c', pillLine: '#2e6296',
  chartBg: '#0b2a45', scaleText: '#84b4dc', grid: '#1d4a73', scaleBorder: '#2e6296',
  upBody: '#5fe0c0', downBody: '#ff7a59', wick: '#84b4dc', candleBorder: 'rgba(127,200,240,0.45)',
  watermark: 'rgba(232,244,255,0.08)',
  equityBg: '#103655', equityText: '#84b4dc', equityLine: '#3fd0ff', balanceLine: '#5a8fb8',
};

// ─────────────────────────────────────────────────────────────────────────────
// EMBER — molten lava: a warm-charcoal near-black that glows with fire — orange accent,
// hot gold "up" (rising = hotter) vs lava-red "down" (cooling). Aggressive + warm; the
// "go/run" green family is re-cast as amber so nothing reads cool against the heat.
// ─────────────────────────────────────────────────────────────────────────────
const EMBER: ThemeTokens = {
  bg: '#140d0a', panel: '#1f1411', panel2: '#170e0b', line: '#3a201a', line2: '#5a2f22',
  fg: '#ffe6d0', muted: '#c0896a', accent: '#ff6a1a', up: '#ffb000', down: '#ff3b1f', gold: '#ffcf33',
  onAccent: '#1a0c06', hover: '#2a1812', sel: '#3a201a', rowLine: '#22130e', rowHover: '#281710',
  surface: '#180f0c', acctActive: '#341c14', inputRo: '#100907', lineHover: '#6e3a28',
  googleFg: '#1f1f1f', shadow: '#000c', backdrop: 'rgba(20,8,4,0.66)', chartLoadingBg: 'rgba(20,13,10,0.95)',
  green: '#ff9500', greenGlow: '#ff6a1a88', greenBg: '#3a1c08', greenLine: '#6e3a12', greenBgHover: '#52280c',
  amber: '#ff8c1a', pillFg: '#ffcf33', pillBg: '#2e1608', pillLine: '#5a2f12',
  chartBg: '#140d0a', scaleText: '#c0896a', grid: '#26160f', scaleBorder: '#4a281c',
  upBody: '#ffb000', downBody: '#ff3b1f', wick: '#c0896a', candleBorder: 'transparent',
  watermark: 'rgba(255,106,26,0.10)',
  equityBg: '#1f1411', equityText: '#c0896a', equityLine: '#ff6a1a', balanceLine: '#a05a3a',
};

// ─────────────────────────────────────────────────────────────────────────────
// ROYAL GOLD — gold leaf on EMERALD VELVET: a deep forest/emerald-green base (a colour no
// other theme uses, so it can't be mistaken for the purple Synthwave) with metallic-gold
// accents + GOLD "up" candles, ruby "down", and ivory text. Regal + opulent; green owns the
// surfaces, gold owns the chrome + the rising candles.
// ─────────────────────────────────────────────────────────────────────────────
const ROYAL: ThemeTokens = {
  bg: '#0c241a', panel: '#11311f', panel2: '#0e2a1c', line: '#1f4a33', line2: '#2e6848',
  fg: '#f6edcf', muted: '#a4c6b0', accent: '#e8c45a', up: '#f2c84e', down: '#ff5d7a', gold: '#f4d472',
  onAccent: '#0c241a', hover: '#16432c', sel: '#1c5236', rowLine: '#133825', rowHover: '#17432c',
  surface: '#0e2a1c', acctActive: '#1d5236', inputRo: '#0a2014', lineHover: '#3a7a56',
  googleFg: '#1f1f1f', shadow: '#000a', backdrop: 'rgba(5,22,14,0.62)', chartLoadingBg: 'rgba(12,36,26,0.94)',
  green: '#5fd08a', greenGlow: '#5fd08a88', greenBg: '#16472a', greenLine: '#2a7a4a', greenBgHover: '#1d5c36',
  amber: '#e8c45a', pillFg: '#f4d472', pillBg: '#2c2410', pillLine: '#5a4a20',
  chartBg: '#0c241a', scaleText: '#a4c6b0', grid: '#16402a', scaleBorder: '#2e6848',
  upBody: '#f2c84e', downBody: '#ff5d7a', wick: '#9ac0a8', candleBorder: 'transparent',
  watermark: 'rgba(232,196,90,0.09)',
  equityBg: '#11311f', equityText: '#a4c6b0', equityLine: '#e8c45a', balanceLine: '#7a9a86',
};

// ─────────────────────────────────────────────────────────────────────────────
// ABYSS — a deep ocean-teal dark, a direction nothing else in the set occupies (the
// only other teal lives as an accent on Cyberpunk's black). A near-black abyssal teal
// base (#0a1f24), a bright aqua accent, seafoam-green "up", coral "down" and sandy gold —
// like a trading desk on the sea floor. Cool, saturated, clearly NOT a blue or a purple.
// ─────────────────────────────────────────────────────────────────────────────
const ABYSS: ThemeTokens = {
  bg: '#0a1f24', panel: '#0e2a30', panel2: '#081a1f', line: '#16383f', line2: '#21505a',
  fg: '#c8e6e4', muted: '#6f9a9c', accent: '#25d0c0', up: '#4fd1a8', down: '#ff7a7a', gold: '#f0c987',
  onAccent: '#04181c', hover: '#123238', sel: '#1c4750', rowLine: '#102d33', rowHover: '#143840',
  surface: '#0c2429', acctActive: '#1a4a52', inputRo: '#07191d', lineHover: '#2e6670',
  googleFg: '#1f1f1f', shadow: '#000b', backdrop: 'rgba(4,16,18,0.6)', chartLoadingBg: 'rgba(10,31,36,0.92)',
  green: '#4fd1a8', greenGlow: '#4fd1a888', greenBg: '#0d3330', greenLine: '#2a6e64', greenBgHover: '#134842',
  amber: '#f0c987', pillFg: '#5fe0d0', pillBg: '#0d2f33', pillLine: '#1f5e62',
  chartBg: '#0a1f24', scaleText: '#6f9a9c', grid: '#143036', scaleBorder: '#21505a',
  upBody: '#4fd1a8', downBody: '#ff7a7a', wick: '#6f9a9c', candleBorder: 'transparent',
  watermark: 'rgba(200,230,228,0.07)',
  equityBg: '#081a1f', equityText: '#6f9a9c', equityLine: '#25d0c0', balanceLine: '#4a6e70',
};

// ─────────────────────────────────────────────────────────────────────────────
// ROSÉ PINE — redone to live up to its NAME instead of the cool mauve original (which
// read too close to Dracula / Synthwave / Tokyo Night). A WARM plum-rose base (#241820,
// no blue in it) with a dusty-ROSE accent and a muted PINE-green "up" — literally rosé +
// pine. Sophisticated and warm-toned; clearly apart from every cool blue-purple in the set.
// ─────────────────────────────────────────────────────────────────────────────
const ROSE_PINE: ThemeTokens = {
  bg: '#241820', panel: '#2c1e26', panel2: '#1d141b', line: '#3a2a33', line2: '#503c47',
  fg: '#ecdce2', muted: '#b08a98', accent: '#d98aa3', up: '#8fb98a', down: '#e06b7e', gold: '#e0b07a',
  onAccent: '#241820', hover: '#32232b', sel: '#432f3a', rowLine: '#2a1d24', rowHover: '#2f212a',
  surface: '#271a22', acctActive: '#3f2b36', inputRo: '#1c1319', lineHover: '#66505b',
  googleFg: '#1f1f1f', shadow: '#000b', backdrop: 'rgba(20,12,16,0.6)', chartLoadingBg: 'rgba(36,24,32,0.93)',
  green: '#8fb98a', greenGlow: '#8fb98a88', greenBg: '#2a3324', greenLine: '#4e663f', greenBgHover: '#38462f',
  amber: '#e0b07a', pillFg: '#e7a7bb', pillBg: '#33222a', pillLine: '#6e4150',
  chartBg: '#241820', scaleText: '#b08a98', grid: '#2f2029', scaleBorder: '#503c47',
  upBody: '#8fb98a', downBody: '#e06b7e', wick: '#b08a98', candleBorder: 'transparent',
  watermark: 'rgba(236,220,226,0.07)',
  equityBg: '#2c1e26', equityText: '#b08a98', equityLine: '#d98aa3', balanceLine: '#7a5e68',
};

// ─────────────────────────────────────────────────────────────────────────────
// EVERFOREST — a soft "forest" dev palette: a muted sage-grey-green base (#2d353b) with
// warm wood-toned text, green/aqua accents and an orange amber. Calm, low-glare, earthy —
// a green that's clearly cooler/greyer than Gruvbox's brown and Royal Gold's emerald.
// ─────────────────────────────────────────────────────────────────────────────
const EVERFOREST: ThemeTokens = {
  bg: '#2d353b', panel: '#343f44', panel2: '#272e33', line: '#3d484d', line2: '#4f585e',
  fg: '#d3c6aa', muted: '#9aa79d', accent: '#83c092', up: '#a7c080', down: '#e67e80', gold: '#dbbc7f',
  onAccent: '#2d353b', hover: '#384349', sel: '#414c52', rowLine: '#2f383d', rowHover: '#343f44',
  surface: '#2a3237', acctActive: '#3f4a50', inputRo: '#252c31', lineHover: '#5c666c',
  googleFg: '#1f1f1f', shadow: '#000a', backdrop: '#0008', chartLoadingBg: 'rgba(45,53,59,0.93)',
  green: '#a7c080', greenGlow: '#a7c08088', greenBg: '#2e3a23', greenLine: '#52663c', greenBgHover: '#3c4c2c',
  amber: '#e69875', pillFg: '#7fbbb3', pillBg: '#26383a', pillLine: '#3a5e5c',
  chartBg: '#2d353b', scaleText: '#9aa79d', grid: '#353f44', scaleBorder: '#4f585e',
  upBody: '#a7c080', downBody: '#e67e80', wick: '#9aa79d', candleBorder: 'transparent',
  watermark: 'rgba(211,198,170,0.08)',
  equityBg: '#272e33', equityText: '#9aa79d', equityLine: '#7fbbb3', balanceLine: '#7a8478',
};

// ─────────────────────────────────────────────────────────────────────────────
// PARCHMENT — a warm aged-paper LIGHT theme. The light category was under-served
// (only the cool white "Light" and the pale-yellow "Solarized"); this is the warm
// one: a tan parchment base (#f0e6cc), dark sepia-brown ink, a burnt-sienna accent
// and inky forest-green / brick-red candles. Classy and easy on the eyes in daylight —
// clearly warmer and tanner than either existing light.
// ─────────────────────────────────────────────────────────────────────────────
const PARCHMENT: ThemeTokens = {
  bg: '#f0e6cc', panel: '#e9dcbd', panel2: '#e2d3af', line: '#d6c39c', line2: '#c3ab80',
  fg: '#463a28', muted: '#897654', accent: '#b5642f', up: '#4e7a3c', down: '#b23f30', gold: '#b07d12',
  onAccent: '#fbf4e2', hover: '#e6d8ba', sel: '#dccaa0', rowLine: '#e2d5b7', rowHover: '#ebe0c5',
  surface: '#e9dcbd', acctActive: '#dccaa0', inputRo: '#eee5cd', lineHover: '#bca576',
  googleFg: '#1f1f1f', shadow: 'rgba(70,58,40,0.22)', backdrop: 'rgba(70,58,40,0.28)', chartLoadingBg: 'rgba(240,230,204,0.92)',
  green: '#4e7a3c', greenGlow: '#4e7a3c88', greenBg: '#d3deb9', greenLine: '#a5bb82', greenBgHover: '#c4d3a6',
  amber: '#b07d12', pillFg: '#6e5c3e', pillBg: '#e2d3af', pillLine: '#c3ab80',
  chartBg: '#f0e6cc', scaleText: '#897654', grid: '#e0d3b5', scaleBorder: '#c3ab80',
  upBody: '#4e7a3c', downBody: '#b23f30', wick: '#897654', candleBorder: 'transparent',
  watermark: 'rgba(70,58,40,0.08)',
  equityBg: '#e9dcbd', equityText: '#897654', equityLine: '#b5642f', balanceLine: '#897654',
};

// ─────────────────────────────────────────────────────────────────────────────
// BORDEAUX — a deep wine-and-gold DARK theme, filling a colour the set had none of:
// red. A dark, red-dominant burgundy base (#2c1318 — clearly redder than Rosé Pine's
// plum), a warm gold accent (wine & gold), mint-green "up" and a clear red "down".
// Premium and moody; the gold accent + redder base set it clearly apart from both
// Rosé Pine (dusty-rose) and Royal Gold (emerald base).
// ─────────────────────────────────────────────────────────────────────────────
const BORDEAUX: ThemeTokens = {
  bg: '#2c1318', panel: '#371a20', panel2: '#220e12', line: '#48232b', line2: '#5f3039',
  fg: '#f1dce0', muted: '#b58991', accent: '#e3b24e', up: '#5ac88e', down: '#f4584f', gold: '#e3b24e',
  onAccent: '#2c1318', hover: '#3c1f26', sel: '#4c2a33', rowLine: '#331820', rowHover: '#391d25',
  surface: '#311820', acctActive: '#492832', inputRo: '#1e0d11', lineHover: '#703d47',
  googleFg: '#1f1f1f', shadow: '#000b', backdrop: 'rgba(16,6,9,0.6)', chartLoadingBg: 'rgba(44,19,24,0.93)',
  green: '#5ac88e', greenGlow: '#5ac88e88', greenBg: '#1b3322', greenLine: '#316444', greenBgHover: '#244b31',
  amber: '#e3b24e', pillFg: '#f0b6a2', pillBg: '#3b1f1b', pillLine: '#703f34',
  chartBg: '#2c1318', scaleText: '#b58991', grid: '#381c24', scaleBorder: '#5f3039',
  upBody: '#5ac88e', downBody: '#f4584f', wick: '#b58991', candleBorder: 'transparent',
  watermark: 'rgba(241,220,224,0.07)',
  equityBg: '#371a20', equityText: '#b58991', equityLine: '#e3b24e', balanceLine: '#8c626a',
};

// ─────────────────────────────────────────────────────────────────────────────
// KALI — the HACKER persona (#14). A red-accented "intrusion" terminal — NOT the
// Matrix green-rain and NOT Bloomberg's amber: a green-tinted near-black with a
// phosphor-green "up", a blood-red accent + "down", and CRT scanlines (crt flag).
// Mr-Robot / breach-console energy.
// ─────────────────────────────────────────────────────────────────────────────
const KALI: ThemeTokens = {
  bg: '#0a0f0a', panel: '#0e140e', panel2: '#060a06', line: '#16221a', line2: '#24382c',
  fg: '#c8f0d0', muted: '#5a8a64', accent: '#ff2e44', up: '#39ff14', down: '#ff2e44', gold: '#ffd866',
  onAccent: '#0a0f0a', hover: '#122016', sel: '#1a3322', rowLine: '#101a12', rowHover: '#142414',
  surface: '#0c120c', acctActive: '#163a20', inputRo: '#050805', lineHover: '#2e5e3a',
  googleFg: '#1f1f1f', shadow: '#000c', backdrop: 'rgba(0,4,0,0.65)', chartLoadingBg: 'rgba(10,15,10,0.93)',
  green: '#39ff14', greenGlow: '#39ff1488', greenBg: '#0d2e10', greenLine: '#1f6e24', greenBgHover: '#154818',
  amber: '#ffd866', pillFg: '#39ff14', pillBg: '#0d2210', pillLine: '#1f5e24',
  chartBg: '#0a0f0a', scaleText: '#5a8a64', grid: '#122016', scaleBorder: '#24382c',
  upBody: '#39ff14', downBody: '#ff2e44', wick: '#5a8a64', candleBorder: 'transparent',
  watermark: 'rgba(57,255,20,0.06)',
  equityBg: '#0e140e', equityText: '#5a8a64', equityLine: '#ff2e44', balanceLine: '#4a6a50',
};

// ─────────────────────────────────────────────────────────────────────────────
// CODE — the DEVELOPER persona (#14): VS Code's iconic "Dark+" look — a NEUTRAL
// #1e1e1e editor grey (not the cool blue-slate of the default Dark, nor Dracula's
// purple / Nord's muted / Monokai's olive / Gruvbox's brown), the signature azure
// accent (#0098ff) + the deep selection-blue (#094771), and editor-grey panels.
// ─────────────────────────────────────────────────────────────────────────────
const CODE: ThemeTokens = {
  bg: '#1e1e1e', panel: '#252526', panel2: '#1a1a1a', line: '#2d2d2d', line2: '#3e3e42',
  fg: '#d4d4d4', muted: '#858585', accent: '#0098ff', up: '#89d185', down: '#f14c4c', gold: '#dcdcaa',
  onAccent: '#ffffff', hover: '#2a2d2e', sel: '#094771', rowLine: '#2d2d2d', rowHover: '#2a2d2e',
  surface: '#252526', acctActive: '#094771', inputRo: '#3c3c3c', lineHover: '#007acc',
  googleFg: '#1f1f1f', shadow: '#000a', backdrop: '#0008', chartLoadingBg: 'rgba(30,30,30,0.93)',
  green: '#89d185', greenGlow: '#89d18588', greenBg: '#1a3320', greenLine: '#2e6e3a', greenBgHover: '#244a2e',
  amber: '#dcdcaa', pillFg: '#569cd6', pillBg: '#12283d', pillLine: '#1f4d7a',
  chartBg: '#1e1e1e', scaleText: '#858585', grid: '#2a2a2a', scaleBorder: '#3e3e42',
  upBody: '#89d185', downBody: '#f14c4c', wick: '#858585', candleBorder: 'transparent',
  watermark: 'rgba(212,212,212,0.07)',
  equityBg: '#252526', equityText: '#858585', equityLine: '#0098ff', balanceLine: '#858585',
};

// ─────────────────────────────────────────────────────────────────────────────
// TICKER — the TRADER persona (#14): a crypto-exchange / trading-floor look, NOT
// Bloomberg's amber. A deep cool charcoal with a VIVID bull-green accent (#16c784)
// + bear-red (#ea3943) so the candles and P&L dominate, plus an exchange gold.
// Green-positive, ticker-tape energy.
// ─────────────────────────────────────────────────────────────────────────────
const TICKER: ThemeTokens = {
  bg: '#0a0e12', panel: '#0f141b', panel2: '#070a0e', line: '#1a212b', line2: '#283340',
  fg: '#e6edf3', muted: '#7d8a9a', accent: '#16c784', up: '#16c784', down: '#ea3943', gold: '#f0b90b',
  onAccent: '#04140d', hover: '#141c26', sel: '#1c2b24', rowLine: '#131a22', rowHover: '#16202a',
  surface: '#0f141b', acctActive: '#163020', inputRo: '#060a0e', lineHover: '#2a4a3a',
  googleFg: '#1f1f1f', shadow: '#000b', backdrop: '#0009', chartLoadingBg: 'rgba(10,14,18,0.93)',
  green: '#16c784', greenGlow: '#16c78488', greenBg: '#0c2e20', greenLine: '#1f6e4c', greenBgHover: '#134a34',
  amber: '#f0b90b', pillFg: '#16c784', pillBg: '#0c2820', pillLine: '#1f5e44',
  chartBg: '#0a0e12', scaleText: '#7d8a9a', grid: '#141c26', scaleBorder: '#283340',
  upBody: '#16c784', downBody: '#ea3943', wick: '#7d8a9a', candleBorder: 'transparent',
  watermark: 'rgba(230,237,243,0.06)',
  equityBg: '#0f141b', equityText: '#7d8a9a', equityLine: '#16c784', balanceLine: '#5a6a7a',
};

// ─────────────────────────────────────────────────────────────────────────────
// HIGH CONTRAST — accessibility-leaning maximum legibility: pure-white paper, pure-
// black text, BOLD black borders everywhere (line/line2/scaleBorder/candleBorder all
// #000), and saturated AA+/AAA accent (deep NASA-blue), dark-green "up" / dark-red
// "down" that stay clearly legible on white. The opposite of MONO's black-greyscale —
// this is the white-background HC mode (think Windows "High Contrast White").
// ─────────────────────────────────────────────────────────────────────────────
const HIGH_CONTRAST: ThemeTokens = {
  bg: '#ffffff', panel: '#ffffff', panel2: '#f2f2f2', line: '#000000', line2: '#000000',
  fg: '#000000', muted: '#333333', accent: '#0b3d91', up: '#00661a', down: '#b00000', gold: '#8a6d00',
  onAccent: '#ffffff', hover: '#e6e6e6', sel: '#bcd4ff', rowLine: '#9a9a9a', rowHover: '#ececec',
  surface: '#f2f2f2', acctActive: '#cfe0ff', inputRo: '#e8e8e8', lineHover: '#000000',
  googleFg: '#1f1f1f', shadow: 'rgba(0,0,0,0.4)', backdrop: 'rgba(0,0,0,0.5)', chartLoadingBg: 'rgba(255,255,255,0.95)',
  green: '#00661a', greenGlow: '#00661a88', greenBg: '#d6f0dc', greenLine: '#00661a', greenBgHover: '#c2e8cb',
  amber: '#8a6d00', pillFg: '#0b3d91', pillBg: '#d6e4ff', pillLine: '#0b3d91',
  chartBg: '#ffffff', scaleText: '#000000', grid: '#cccccc', scaleBorder: '#000000',
  upBody: '#00661a', downBody: '#b00000', wick: '#000000', candleBorder: '#000000',
  watermark: 'rgba(0,0,0,0.06)',
  equityBg: '#ffffff', equityText: '#000000', equityLine: '#0b3d91', balanceLine: '#555555',
};

// ─────────────────────────────────────────────────────────────────────────────
// OLD SCHOOL — the classic MetaTrader-4 / Windows-9x trading terminal: silver-beige
// 3D chrome (#d4d0c8 toolbar grey + #ece9d8 panels), navy highlight accent (#000080),
// the classic Windows green/red, and a near-white chart. Reads as "old-school MT4" —
// a light theme unlike anything else in the set (the CRT/retro slots are green/amber).
// ─────────────────────────────────────────────────────────────────────────────
const OLD_SCHOOL: ThemeTokens = {
  bg: '#d4d0c8', panel: '#ece9d8', panel2: '#dcd8cc', line: '#aca899', line2: '#88847a',
  fg: '#1a1a28', muted: '#5a5648', accent: '#000080', up: '#008000', down: '#c00000', gold: '#9a7d00',
  onAccent: '#ffffff', hover: '#e2ded0', sel: '#b9c9e8', rowLine: '#c8c4b6', rowHover: '#e4e0d2',
  surface: '#e4e0d2', acctActive: '#c4cce4', inputRo: '#f4f2ea', lineHover: '#88847a',
  googleFg: '#1f1f1f', shadow: 'rgba(40,38,30,0.3)', backdrop: 'rgba(40,38,30,0.35)', chartLoadingBg: 'rgba(236,233,216,0.93)',
  green: '#008000', greenGlow: '#00800088', greenBg: '#cfe6cf', greenLine: '#8fc28f', greenBgHover: '#bedcbe',
  amber: '#9a7d00', pillFg: '#000080', pillBg: '#d4dcf0', pillLine: '#9aa8d0',
  chartBg: '#f7f6f0', scaleText: '#5a5648', grid: '#d8d4c6', scaleBorder: '#aca899',
  upBody: '#008000', downBody: '#c00000', wick: '#5a5648', candleBorder: 'transparent',
  watermark: 'rgba(26,26,40,0.07)',
  equityBg: '#ece9d8', equityText: '#5a5648', equityLine: '#000080', balanceLine: '#5a5648',
};

// ─────────────────────────────────────────────────────────────────────────────
// HALLOWEEN — spooky-seasonal: pumpkin-orange accent (#ff7518) on a purple-black night
// (deep #0e0712 base, dark-purple panels + purple borders), with a "toxic slime" green
// "up" and a blood-red "down". Orange + purple + black — a colour combo no other theme
// uses. The connecting pill rides the purple; the chart watermark glows pumpkin.
// ─────────────────────────────────────────────────────────────────────────────
const HALLOWEEN: ThemeTokens = {
  bg: '#0e0712', panel: '#190a24', panel2: '#100616', line: '#3a1a4a', line2: '#5a2a6e',
  fg: '#f6e3c8', muted: '#b08ac0', accent: '#ff7518', up: '#8bff4d', down: '#ff3355', gold: '#ffb43d',
  onAccent: '#1a0a06', hover: '#241033', sel: '#3a1a4a', rowLine: '#1c0e28', rowHover: '#20102e',
  surface: '#140820', acctActive: '#3a1a4a', inputRo: '#0b0510', lineHover: '#6e3a82',
  googleFg: '#1f1f1f', shadow: 'rgba(0,0,0,0.75)', backdrop: 'rgba(8,0,12,0.7)', chartLoadingBg: 'rgba(14,7,18,0.94)',
  green: '#8bff4d', greenGlow: '#8bff4d88', greenBg: '#1f3a10', greenLine: '#4a7a1f', greenBgHover: '#2e5215',
  amber: '#ffb43d', pillFg: '#d0a0ff', pillBg: '#281038', pillLine: '#5a2a6e',
  chartBg: '#0e0712', scaleText: '#b08ac0', grid: '#221033', scaleBorder: '#3a1a4a',
  upBody: '#8bff4d', downBody: '#ff3355', wick: '#b08ac0', candleBorder: 'transparent',
  watermark: 'rgba(255,117,24,0.08)',
  equityBg: '#190a24', equityText: '#b08ac0', equityLine: '#ff7518', balanceLine: '#8a6a9a',
};

// ─────────────────────────────────────────────────────────────────────────────
// ACADEMIC — research-paper / textbook: a clean cool-cream paper (#f7f5ef, whiter than
// Parchment's warm tan), ink-charcoal text, and a restrained scholarly OXBLOOD accent
// (#7c2230 — a university-crest maroon, not Parchment's burnt-orange). Muted forest-green
// "up" / brick-red "down" keep it professional and quiet. Restrained + legible.
// ─────────────────────────────────────────────────────────────────────────────
const ACADEMIC: ThemeTokens = {
  bg: '#f7f5ef', panel: '#fbfaf5', panel2: '#f0ede4', line: '#ddd8cb', line2: '#c7c0ae',
  fg: '#2a2722', muted: '#6f6857', accent: '#7c2230', up: '#3d6b3a', down: '#9c3a33', gold: '#927524',
  onAccent: '#f7f0e8', hover: '#efece3', sel: '#ebe4e2', rowLine: '#ece8de', rowHover: '#f2efe7',
  surface: '#f2efe7', acctActive: '#ece0e0', inputRo: '#efece3', lineHover: '#b9b09c',
  googleFg: '#1f1f1f', shadow: 'rgba(42,39,34,0.18)', backdrop: 'rgba(42,39,34,0.25)', chartLoadingBg: 'rgba(247,245,239,0.93)',
  green: '#3d6b3a', greenGlow: '#3d6b3a88', greenBg: '#dde7d6', greenLine: '#a7c0a0', greenBgHover: '#cdddc4',
  amber: '#927524', pillFg: '#7c2230', pillBg: '#f0e0e2', pillLine: '#d4b6ba',
  chartBg: '#f7f5ef', scaleText: '#6f6857', grid: '#e8e3d7', scaleBorder: '#c7c0ae',
  upBody: '#3d6b3a', downBody: '#9c3a33', wick: '#6f6857', candleBorder: 'transparent',
  watermark: 'rgba(42,39,34,0.06)',
  equityBg: '#fbfaf5', equityText: '#6f6857', equityLine: '#7c2230', balanceLine: '#6f6857',
};

// ─────────────────────────────────────────────────────────────────────────────
// OLD SCHOOL DARK — a real WINDOWS 95/98 trading app, dark edition. The retro read here is
// STRUCTURAL (see `body.theme-oldschooldark` in index.html): gray 3D-beveled chrome (raised
// buttons/panels via light-top-left / dark-bottom-right box-shadow bevels, sunken inputs),
// boxy square corners, no soft shadows, a Tahoma/MS-Sans bitmap font, and NAVY title bars.
// The palette is a dark-Win95 gray with the classic Win95 selection-navy as the accent —
// `line` is the DARK bevel edge and `line2` the LIGHT bevel edge (the CSS reads both).
// ─────────────────────────────────────────────────────────────────────────────
const OLD_SCHOOL_DARK: ThemeTokens = {
  bg: '#2a2a2a', panel: '#3b3b3b', panel2: '#313131', line: '#1c1c1c', line2: '#5a5a5a',
  fg: '#e8e8e8', muted: '#a0a0a0', accent: '#4a7fd0', up: '#00c000', down: '#d83030', gold: '#d8c000',
  onAccent: '#ffffff', hover: '#454545', sel: '#0a3a8a', rowLine: '#333333', rowHover: '#444444',
  surface: '#383838', acctActive: '#1f3a7a', inputRo: '#262626', lineHover: '#6a6a6a',
  googleFg: '#1f1f1f', shadow: '#0008', backdrop: 'rgba(0,0,0,0.5)', chartLoadingBg: 'rgba(42,42,42,0.94)',
  green: '#00c000', greenGlow: '#00c00088', greenBg: '#0d3a0d', greenLine: '#1c6e1c', greenBgHover: '#155215',
  amber: '#d8c000', pillFg: '#9cc0ff', pillBg: '#1a2a5a', pillLine: '#3a5aaa',
  chartBg: '#1e1e1e', scaleText: '#a0a0a0', grid: '#333333', scaleBorder: '#565656',
  upBody: '#00c000', downBody: '#d83030', wick: '#a0a0a0', candleBorder: 'transparent',
  watermark: 'rgba(232,232,232,0.06)',
  equityBg: '#3b3b3b', equityText: '#a0a0a0', equityLine: '#4a7fd0', balanceLine: '#808080',
};

// ─────────────────────────────────────────────────────────────────────────────
// HIGH CONTRAST DARK — the dark sibling of High Contrast: Windows-"High-Contrast-Black"
// accessibility. Pure black, pure-white text, BOLD WHITE borders (every panel/scale/candle
// outlined in white — the signature no other dark theme uses), a sharp bright-blue accent,
// and VIVID colored green/red. NOT Black & White (MONO): that is a soft GREYSCALE aesthetic
// (grey borders, white/grey candles, no colour); this is an AAA accessibility theme with
// white structural borders + a saturated accent and clearly-coloured up/down.
// ─────────────────────────────────────────────────────────────────────────────
const HIGH_CONTRAST_DARK: ThemeTokens = {
  bg: '#000000', panel: '#000000', panel2: '#0a0a0a', line: '#ffffff', line2: '#ffffff',
  fg: '#ffffff', muted: '#d0d0d0', accent: '#40a8ff', up: '#00e676', down: '#ff5252', gold: '#ffd400',
  onAccent: '#000000', hover: '#1a1a1a', sel: '#003a6e', rowLine: '#6a6a6a', rowHover: '#1a1a1a',
  surface: '#0a0a0a', acctActive: '#003a6e', inputRo: '#0d0d0d', lineHover: '#ffffff',
  googleFg: '#1f1f1f', shadow: '#000', backdrop: 'rgba(0,0,0,0.7)', chartLoadingBg: 'rgba(0,0,0,0.95)',
  green: '#00e676', greenGlow: '#00e67688', greenBg: '#052e1a', greenLine: '#00a050', greenBgHover: '#064026',
  amber: '#ffd400', pillFg: '#40a8ff', pillBg: '#00264a', pillLine: '#40a8ff',
  chartBg: '#000000', scaleText: '#ffffff', grid: '#333333', scaleBorder: '#ffffff',
  upBody: '#00e676', downBody: '#ff5252', wick: '#ffffff', candleBorder: '#ffffff',
  watermark: 'rgba(255,255,255,0.06)',
  equityBg: '#000000', equityText: '#ffffff', equityLine: '#40a8ff', balanceLine: '#888888',
};

// ─────────────────────────────────────────────────────────────────────────────
// DOS AMBER TERMINAL — a '90s amber-phosphor trading terminal. Amber-on-black, and the retro
// is STRUCTURAL (crt:true scanlines + `body.theme-dosamber` in index.html): a monospace
// bitmap font, an amber text-shadow GLOW, and double-line boxed borders. Distinct from
// Bloomberg Amber (which is the CLEAN amber with none of this CRT chrome) — same colour
// family, but this one wears the tube: scanlines, glow, boxed double rules.
// ─────────────────────────────────────────────────────────────────────────────
const DOS_AMBER: ThemeTokens = {
  bg: '#0a0700', panel: '#110b01', panel2: '#0c0800', line: '#4a2e00', line2: '#6e4a00',
  fg: '#ffb000', muted: '#a06a00', accent: '#ff9500', up: '#ffd000', down: '#ff5530', gold: '#ffc800',
  onAccent: '#0a0700', hover: '#1c1200', sel: '#2e1f00', rowLine: '#160e00', rowHover: '#1c1300',
  surface: '#0e0900', acctActive: '#2a1c00', inputRo: '#070500', lineHover: '#6e4a00',
  googleFg: '#1f1f1f', shadow: '#000c', backdrop: 'rgba(0,0,0,0.7)', chartLoadingBg: 'rgba(10,7,0,0.95)',
  green: '#ffc000', greenGlow: '#ffc00088', greenBg: '#2e2000', greenLine: '#6e4a00', greenBgHover: '#3e2c00',
  amber: '#ffb000', pillFg: '#ffc24d', pillBg: '#2a1c00', pillLine: '#6e4a00',
  chartBg: '#0a0700', scaleText: '#a06a00', grid: '#2a1c00', scaleBorder: '#4a2e00',
  upBody: '#ffd000', downBody: '#ff5530', wick: '#a06a00', candleBorder: 'transparent',
  watermark: 'rgba(255,176,0,0.07)',
  equityBg: '#110b01', equityText: '#a06a00', equityLine: '#ff9500', balanceLine: '#a06a00',
};

// ─────────────────────────────────────────────────────────────────────────────
// GREEN-PHOSPHOR CRT — a classic green-phosphor monitor (VT220 / old-monochrome). Green-on-
// black, and the retro is STRUCTURAL (crt:true + body:'crt-pixel' pixel font + heavy scanlines
// & green BLOOM in `body.theme-greencrt`). Distinct from Matrix (which is the animated
// digital-RAIN backdrop) and from Kali (green-on-black but RED accent): this is a static
// heavy-scanline phosphor tube with a GREEN accent and pixel type. Down=red for P&L legibility.
// ─────────────────────────────────────────────────────────────────────────────
const GREEN_CRT: ThemeTokens = {
  bg: '#001000', panel: '#001a00', panel2: '#000c00', line: '#0a4a0a', line2: '#0e6e0e',
  fg: '#33ff66', muted: '#1f9a3f', accent: '#00ff66', up: '#66ff33', down: '#ff4040', gold: '#c0ff00',
  onAccent: '#001000', hover: '#002600', sel: '#0a4a0a', rowLine: '#001800', rowHover: '#002200',
  surface: '#001600', acctActive: '#0a3a0a', inputRo: '#000a00', lineHover: '#0e6e0e',
  googleFg: '#1f1f1f', shadow: '#000c', backdrop: 'rgba(0,8,0,0.7)', chartLoadingBg: 'rgba(0,16,0,0.95)',
  green: '#33ff33', greenGlow: '#33ff3388', greenBg: '#0a3a0a', greenLine: '#1c6e1c', greenBgHover: '#155215',
  amber: '#c0ff00', pillFg: '#66ff99', pillBg: '#0a2e0a', pillLine: '#1c5e1c',
  chartBg: '#001000', scaleText: '#1f9a3f', grid: '#0a3a0a', scaleBorder: '#0e6e0e',
  upBody: '#66ff33', downBody: '#ff4040', wick: '#1f9a3f', candleBorder: 'transparent',
  watermark: 'rgba(51,255,51,0.07)',
  equityBg: '#001a00', equityText: '#1f9a3f', equityLine: '#00ff66', balanceLine: '#1f9a3f',
};

// ─────────────────────────────────────────────────────────────────────────────
// WINDOWS XP (LUNA) — bright + glossy (vs Win95's flat gray). Silver-blue panels, a green
// Start-accent, bliss-blue. Structural in `body.theme-winxp`: glossy BLUE gradient title bar,
// glossy rounded pill buttons, rounded silver-blue panels. Light.
// ─────────────────────────────────────────────────────────────────────────────
const WINXP: ThemeTokens = {
  bg: '#c8d8f0', panel: '#eef3fb', panel2: '#dde7f5', line: '#a8c0e0', line2: '#7da6d8',
  fg: '#0a1428', muted: '#4a6080', accent: '#2e8af0', up: '#1f9c2f', down: '#d83030', gold: '#e8a800',
  onAccent: '#ffffff', hover: '#dce8f8', sel: '#cfe0f8', rowLine: '#e0e8f4', rowHover: '#eaf1fb',
  surface: '#e4ecf8', acctActive: '#cfe0f8', inputRo: '#ffffff', lineHover: '#2e8af0',
  googleFg: '#1f1f1f', shadow: 'rgba(10,30,80,0.25)', backdrop: 'rgba(10,30,80,0.3)', chartLoadingBg: 'rgba(238,243,251,0.93)',
  green: '#1f9c2f', greenGlow: '#1f9c2f88', greenBg: '#d8f0db', greenLine: '#7cc888', greenBgHover: '#c4e8c9',
  amber: '#e8a800', pillFg: '#1a5fc0', pillBg: '#dce8f8', pillLine: '#9cc0ee',
  chartBg: '#ffffff', scaleText: '#4a6080', grid: '#e0e8f4', scaleBorder: '#a8c0e0',
  upBody: '#1f9c2f', downBody: '#d83030', wick: '#4a6080', candleBorder: 'transparent',
  watermark: 'rgba(10,20,40,0.06)',
  equityBg: '#eef3fb', equityText: '#4a6080', equityLine: '#2e8af0', balanceLine: '#4a6080',
};

// ─────────────────────────────────────────────────────────────────────────────
// WINDOWS 7 (AERO) — frosted GLASS. Translucent/blurred chrome (backdrop-filter), glossy
// gradient buttons with a soft blue glow, rounded corners, Aero-blue. Structural in
// `body.theme-win7`. Light + glassy.
// ─────────────────────────────────────────────────────────────────────────────
const WIN7: ThemeTokens = {
  bg: '#aac4e4', panel: '#eaf2fb', panel2: '#dde9f6', line: '#b0c8e4', line2: '#8badd8',
  fg: '#1a2a44', muted: '#4a6488', accent: '#1a8cff', up: '#1f9c2f', down: '#d83030', gold: '#d89000',
  onAccent: '#ffffff', hover: '#dcebfa', sel: '#cce4fb', rowLine: '#e2ecf7', rowHover: '#ecf4fc',
  surface: '#e6f0fb', acctActive: '#cfe4fb', inputRo: '#ffffff', lineHover: '#1a8cff',
  googleFg: '#1f1f1f', shadow: 'rgba(20,50,100,0.22)', backdrop: 'rgba(20,50,100,0.3)', chartLoadingBg: 'rgba(234,242,251,0.9)',
  green: '#1f9c2f', greenGlow: '#1f9c2f88', greenBg: '#d8f0db', greenLine: '#7cc888', greenBgHover: '#c4e8c9',
  amber: '#d89000', pillFg: '#1565c0', pillBg: '#dcebfa', pillLine: '#9cc6ee',
  chartBg: '#ffffff', scaleText: '#4a6488', grid: '#e2ecf7', scaleBorder: '#b0c8e4',
  upBody: '#1f9c2f', downBody: '#d83030', wick: '#4a6488', candleBorder: 'transparent',
  watermark: 'rgba(26,42,68,0.06)',
  equityBg: '#eaf2fb', equityText: '#4a6488', equityLine: '#1a8cff', balanceLine: '#4a6488',
};

// ─────────────────────────────────────────────────────────────────────────────
// WINDOWS 11 (FLUENT) — modern dark MICA: big rounded corners, acrylic translucency, soft
// shadows, accent-blue, clean flat-with-depth. Structural in `body.theme-win11`. Dark (Win11
// dark mica = sleek + most distinct from the light XP/7).
// ─────────────────────────────────────────────────────────────────────────────
const WIN11: ThemeTokens = {
  bg: '#202020', panel: '#2b2b2b', panel2: '#272727', line: '#383838', line2: '#4a4a4a',
  fg: '#ffffff', muted: '#a0a0a0', accent: '#60cdff', up: '#3fd07a', down: '#ff5d6c', gold: '#ffc83d',
  onAccent: '#00263d', hover: '#323232', sel: '#2d3f50', rowLine: '#2e2e2e', rowHover: '#2f2f2f',
  surface: '#2b2b2b', acctActive: '#243845', inputRo: '#292929', lineHover: '#60cdff',
  googleFg: '#1f1f1f', shadow: 'rgba(0,0,0,0.4)', backdrop: 'rgba(0,0,0,0.45)', chartLoadingBg: 'rgba(32,32,32,0.92)',
  green: '#3fd07a', greenGlow: '#3fd07a88', greenBg: '#15331f', greenLine: '#2a6e44', greenBgHover: '#1d4a2e',
  amber: '#ffc83d', pillFg: '#9ce0ff', pillBg: '#16323f', pillLine: '#2a5a70',
  chartBg: '#202020', scaleText: '#a0a0a0', grid: '#2e2e2e', scaleBorder: '#4a4a4a',
  upBody: '#3fd07a', downBody: '#ff5d6c', wick: '#a0a0a0', candleBorder: 'transparent',
  watermark: 'rgba(255,255,255,0.06)',
  equityBg: '#2b2b2b', equityText: '#a0a0a0', equityLine: '#60cdff', balanceLine: '#7a7a7a',
};

// ─────────────────────────────────────────────────────────────────────────────
// GITHUB DARK — the iconic GitHub dark look: navy-slate surfaces, blue accent, green/red
// up/down. Clean + FLAT (subtle 1px borders, no bevels/gradients — the anti-Win95).
// Distinct from Code (VS Code's neutral grey + azure): GitHub's navy-slate + #58a6ff is its
// own thing. System font + mono numbers via `body.theme-github`.
// ─────────────────────────────────────────────────────────────────────────────
const GITHUB_DARK: ThemeTokens = {
  bg: '#0d1117', panel: '#161b22', panel2: '#010409', line: '#30363d', line2: '#444c56',
  fg: '#c9d1d9', muted: '#8b949e', accent: '#58a6ff', up: '#3fb950', down: '#f85149', gold: '#d29922',
  onAccent: '#ffffff', hover: '#1c2128', sel: '#163056', rowLine: '#21262d', rowHover: '#161b22',
  surface: '#161b22', acctActive: '#132034', inputRo: '#0d1117', lineHover: '#58a6ff',
  googleFg: '#1f1f1f', shadow: 'rgba(1,4,9,0.6)', backdrop: 'rgba(1,4,9,0.6)', chartLoadingBg: 'rgba(13,17,23,0.92)',
  green: '#3fb950', greenGlow: '#3fb95088', greenBg: '#12261e', greenLine: '#238636', greenBgHover: '#1a3326',
  amber: '#d29922', pillFg: '#58a6ff', pillBg: '#0d2847', pillLine: '#1f6feb',
  chartBg: '#0d1117', scaleText: '#8b949e', grid: '#21262d', scaleBorder: '#30363d',
  upBody: '#3fb950', downBody: '#f85149', wick: '#8b949e', candleBorder: 'transparent',
  watermark: 'rgba(201,209,217,0.06)',
  equityBg: '#161b22', equityText: '#8b949e', equityLine: '#58a6ff', balanceLine: '#6e7681',
};

// ─────────────────────────────────────────────────────────────────────────────
// GITHUB LIGHT — the GitHub light palette, same clean-FLAT treatment as GitHub Dark.
// ─────────────────────────────────────────────────────────────────────────────
const GITHUB_LIGHT: ThemeTokens = {
  bg: '#ffffff', panel: '#f6f8fa', panel2: '#eaeef2', line: '#d0d7de', line2: '#afb8c1',
  fg: '#1f2328', muted: '#656d76', accent: '#0969da', up: '#1a7f37', down: '#cf222e', gold: '#9a6700',
  onAccent: '#ffffff', hover: '#eef1f4', sel: '#ddf4ff', rowLine: '#eaeef2', rowHover: '#f6f8fa',
  surface: '#f6f8fa', acctActive: '#ddf4ff', inputRo: '#f6f8fa', lineHover: '#afb8c1',
  googleFg: '#1f1f1f', shadow: 'rgba(31,35,40,0.15)', backdrop: 'rgba(31,35,40,0.4)', chartLoadingBg: 'rgba(255,255,255,0.92)',
  green: '#1a7f37', greenGlow: '#1a7f3755', greenBg: '#dafbe1', greenLine: '#4ac26b', greenBgHover: '#c8f0d2',
  amber: '#9a6700', pillFg: '#0969da', pillBg: '#ddf4ff', pillLine: '#54aeff',
  chartBg: '#ffffff', scaleText: '#656d76', grid: '#eaeef2', scaleBorder: '#d0d7de',
  upBody: '#1a7f37', downBody: '#cf222e', wick: '#656d76', candleBorder: 'transparent',
  watermark: 'rgba(31,35,40,0.06)',
  equityBg: '#f6f8fa', equityText: '#656d76', equityLine: '#0969da', balanceLine: '#afb8c1',
};

// ─────────────────────────────────────────────────────────────────────────────
// WINDOWS XP DARK (ROYALE NOIR) — the hidden dark Luna. A graphite/slate-blue chrome:
// a dark glossy title bar + dark metallic buttons (structural in `body.theme-winxpdark`)
// with the XP blue as the accent. Dark sibling of Windows XP.
// ─────────────────────────────────────────────────────────────────────────────
const WINXP_DARK: ThemeTokens = {
  bg: '#1b212b', panel: '#28303d', panel2: '#212833', line: '#3a4452', line2: '#4d5a6c',
  fg: '#e7edf6', muted: '#92a2b6', accent: '#3a9bf0', up: '#3fc04f', down: '#ff5a4d', gold: '#e8b020',
  onAccent: '#ffffff', hover: '#313a48', sel: '#27405e', rowLine: '#262e39', rowHover: '#2c3542',
  surface: '#252d39', acctActive: '#243a5a', inputRo: '#181d25', lineHover: '#3a9bf0',
  googleFg: '#1f1f1f', shadow: 'rgba(0,0,0,0.5)', backdrop: 'rgba(0,0,0,0.5)', chartLoadingBg: 'rgba(27,33,43,0.93)',
  green: '#3fc04f', greenGlow: '#3fc04f88', greenBg: '#123a1a', greenLine: '#266e33', greenBgHover: '#185224',
  amber: '#e8b020', pillFg: '#7fc0ff', pillBg: '#16304f', pillLine: '#2a5a8f',
  chartBg: '#161b22', scaleText: '#92a2b6', grid: '#2a323e', scaleBorder: '#3a4452',
  upBody: '#3fc04f', downBody: '#ff5a4d', wick: '#92a2b6', candleBorder: 'transparent',
  watermark: 'rgba(231,237,246,0.06)',
  equityBg: '#28303d', equityText: '#92a2b6', equityLine: '#3a9bf0', balanceLine: '#7a8aa0',
};

// ─────────────────────────────────────────────────────────────────────────────
// WINDOWS 7 DARK (AERO) — dark frosted GLASS: translucent dark-blue chrome with a heavy
// backdrop-blur (structural in `body.theme-win7dark`), glossy dark two-tone buttons + an
// Aero-blue glow. Dark sibling of Windows 7.
// ─────────────────────────────────────────────────────────────────────────────
const WIN7_DARK: ThemeTokens = {
  bg: '#16203a', panel: '#1f2c47', panel2: '#1a2440', line: '#33445f', line2: '#46587a',
  fg: '#e6eefb', muted: '#92a6c8', accent: '#34a0ff', up: '#3fc04f', down: '#ff5a4d', gold: '#e0a020',
  onAccent: '#04122a', hover: '#26365a', sel: '#26456e', rowLine: '#243150', rowHover: '#293a5e',
  surface: '#1d2843', acctActive: '#25456e', inputRo: '#141d36', lineHover: '#34a0ff',
  googleFg: '#1f1f1f', shadow: 'rgba(0,8,24,0.55)', backdrop: 'rgba(4,12,28,0.55)', chartLoadingBg: 'rgba(22,32,58,0.92)',
  green: '#3fc04f', greenGlow: '#3fc04f88', greenBg: '#123a1c', greenLine: '#266e36', greenBgHover: '#185226',
  amber: '#e0a020', pillFg: '#7fc0ff', pillBg: '#163252', pillLine: '#2a5a92',
  chartBg: '#101829', scaleText: '#92a6c8', grid: '#22304d', scaleBorder: '#33445f',
  upBody: '#3fc04f', downBody: '#ff5a4d', wick: '#92a6c8', candleBorder: 'transparent',
  watermark: 'rgba(230,238,251,0.06)',
  equityBg: '#1f2c47', equityText: '#92a6c8', equityLine: '#34a0ff', balanceLine: '#7a8eb0',
};

// ─────────────────────────────────────────────────────────────────────────────
// WINDOWS 11 LIGHT (FLUENT) — light MICA: translucent near-white chrome, big rounded
// corners, soft shadows, accent-fill active controls (structural in `body.theme-win11light`).
// Light sibling of Windows 11 — the Win11 light-mode look.
// ─────────────────────────────────────────────────────────────────────────────
const WIN11_LIGHT: ThemeTokens = {
  bg: '#f3f3f3', panel: '#fbfbfb', panel2: '#eef0f2', line: '#e2e3e6', line2: '#cfd1d4',
  fg: '#1a1a1a', muted: '#5d5d5d', accent: '#005fb8', up: '#0f9d58', down: '#d13438', gold: '#9a7000',
  onAccent: '#ffffff', hover: '#eaeaea', sel: '#cfe4fa', rowLine: '#ebebeb', rowHover: '#f4f4f4',
  surface: '#f6f6f6', acctActive: '#d8e8fb', inputRo: '#f0f0f0', lineHover: '#005fb8',
  googleFg: '#1f1f1f', shadow: 'rgba(0,0,0,0.16)', backdrop: 'rgba(0,0,0,0.32)', chartLoadingBg: 'rgba(243,243,243,0.92)',
  green: '#0f9d58', greenGlow: '#0f9d5855', greenBg: '#dcf3e6', greenLine: '#8fd6ac', greenBgHover: '#caecd8',
  amber: '#9a7000', pillFg: '#005fb8', pillBg: '#dcebfb', pillLine: '#a8cdf2',
  chartBg: '#ffffff', scaleText: '#5d5d5d', grid: '#ececec', scaleBorder: '#cfd1d4',
  upBody: '#0f9d58', downBody: '#d13438', wick: '#5d5d5d', candleBorder: 'transparent',
  watermark: 'rgba(26,26,26,0.05)',
  equityBg: '#fbfbfb', equityText: '#5d5d5d', equityLine: '#005fb8', balanceLine: '#9a9a9a',
};

// ─────────────────────────────────────────────────────────────────────────────
// NeXTSTEP — the iconic NeXT look: a coherent MEDIUM-GRAY grayscale world (NeXT's ~50%-gray
// workspace + lighter gray windows — it was NEVER near-black), with dark text reading on every
// surface. The retro is STRUCTURAL (`body.theme-nextstep`): CHUNKY monochrome bevels (a 2-layer
// raised edge THICKER than Win95's), a beveled gray title bar with black caption, Helvetica,
// square corners. `line` = DARK bevel edge, `line2` = LIGHT bevel edge.
// IMPORTANT: bg (desktop) is a MEDIUM gray, not dark — fg is dark, and base CSS puts `fg` text
// on `bg` (the active chart tab `.ctab.on`, chart cells). A dark bg here = dark-on-dark; the
// medium-gray bg keeps every fg-on-bg / fg-on-panel pair readable at the root (no per-spot
// override). chartBg is a LIGHT gray content area (light NeXT window) with coloured candles.
// Distinct from Win95 (thinner bevels, navy title) + Platinum (soft rounded, pinstripe).
// ─────────────────────────────────────────────────────────────────────────────
const NEXTSTEP: ThemeTokens = {
  bg: '#8c8c8c', panel: '#bcbcbc', panel2: '#aeaeae', line: '#646464', line2: '#ffffff',
  fg: '#161616', muted: '#3e3e3e', accent: '#34405a', up: '#1f7a33', down: '#b01818', gold: '#6e5e00',
  onAccent: '#ffffff', hover: '#c4c4c4', sel: '#9a9a9a', rowLine: '#a4a4a4', rowHover: '#c0c0c0',
  surface: '#b6b6b6', acctActive: '#97a0b0', inputRo: '#cccccc', lineHover: '#34405a',
  googleFg: '#1f1f1f', shadow: 'rgba(0,0,0,0.4)', backdrop: 'rgba(0,0,0,0.4)', chartLoadingBg: 'rgba(196,196,196,0.94)',
  green: '#1f7a33', greenGlow: '#1f7a3366', greenBg: '#cadccd', greenLine: '#8ab48f', greenBgHover: '#bad0bf',
  amber: '#6e5e00', pillFg: '#28324a', pillBg: '#c6c6c6', pillLine: '#6a6a6a',
  chartBg: '#c4c4c4', scaleText: '#454545', grid: '#b2b2b2', scaleBorder: '#7a7a7a',
  upBody: '#1f8a37', downBody: '#c01f1f', wick: '#555555', candleBorder: 'transparent',
  watermark: 'rgba(20,20,20,0.07)',
  equityBg: '#bcbcbc', equityText: '#454545', equityLine: '#34405a', balanceLine: '#5e5e5e',
};

// ─────────────────────────────────────────────────────────────────────────────
// CLASSIC MAC OS (PLATINUM) — Mac OS 8/9. The retro is STRUCTURAL (`body.theme-platinum`):
// a gray PINSTRIPE title bar (horizontal hairlines), ROUNDED-RECT buttons with a soft
// platinum bevel, the classic Mac selection blue. Softer + rounder than Win95's hard bevels —
// clearly Apple, and distinct from Win 3.1's flat teal hard-bevel look.
// ─────────────────────────────────────────────────────────────────────────────
const PLATINUM: ThemeTokens = {
  bg: '#a6a6a6', panel: '#dddddd', panel2: '#cccccc', line: '#808080', line2: '#ffffff',
  fg: '#1a1a1a', muted: '#565656', accent: '#2f5fb3', up: '#007a3d', down: '#c81e1e', gold: '#8a7000',
  onAccent: '#ffffff', hover: '#e6e6e6', sel: '#b6c6ec', rowLine: '#c2c2c2', rowHover: '#d8d8d8',
  surface: '#d4d4d4', acctActive: '#c2d0ee', inputRo: '#ffffff', lineHover: '#888888',
  googleFg: '#1f1f1f', shadow: 'rgba(0,0,0,0.3)', backdrop: 'rgba(0,0,0,0.32)', chartLoadingBg: 'rgba(221,221,221,0.94)',
  green: '#007a3d', greenGlow: '#007a3d66', greenBg: '#cce8d6', greenLine: '#86c4a0', greenBgHover: '#bce0c8',
  amber: '#8a7000', pillFg: '#2a4ca0', pillBg: '#d2dcf2', pillLine: '#a8badf',
  chartBg: '#f4f4f4', scaleText: '#565656', grid: '#dadada', scaleBorder: '#808080',
  upBody: '#007a3d', downBody: '#c81e1e', wick: '#565656', candleBorder: 'transparent',
  watermark: 'rgba(0,0,0,0.05)',
  equityBg: '#dddddd', equityText: '#565656', equityLine: '#2f5fb3', balanceLine: '#707070',
};

// ─────────────────────────────────────────────────────────────────────────────
// CLASSIC MAC OS DARK — the dark sibling of Platinum. Same STRUCTURAL Mac chrome
// (`body.theme-platinumdark`): a DARK gray PINSTRIPE title bar, dark rounded-rect buttons with
// a soft bevel, the Mac selection blue. Dark-tone retro Mac.
// ─────────────────────────────────────────────────────────────────────────────
const PLATINUM_DARK: ThemeTokens = {
  bg: '#3a3a3a', panel: '#4a4a4a', panel2: '#424242', line: '#2a2a2a', line2: '#5e5e5e',
  fg: '#ececec', muted: '#a0a0a0', accent: '#5a8cd8', up: '#3fc04f', down: '#ff5a4d', gold: '#d8b020',
  onAccent: '#ffffff', hover: '#545454', sel: '#3a5a8a', rowLine: '#3e3e3e', rowHover: '#4e4e4e',
  surface: '#464646', acctActive: '#2f4a72', inputRo: '#2e2e2e', lineHover: '#5a8cd8',
  googleFg: '#1f1f1f', shadow: 'rgba(0,0,0,0.5)', backdrop: 'rgba(0,0,0,0.5)', chartLoadingBg: 'rgba(58,58,58,0.94)',
  green: '#3fc04f', greenGlow: '#3fc04f88', greenBg: '#13361b', greenLine: '#2a6e34', greenBgHover: '#1c5226',
  amber: '#d8b020', pillFg: '#9cc0ff', pillBg: '#26344f', pillLine: '#3a5a8a',
  chartBg: '#262626', scaleText: '#a0a0a0', grid: '#3a3a3a', scaleBorder: '#5e5e5e',
  upBody: '#3fc04f', downBody: '#ff5a4d', wick: '#a0a0a0', candleBorder: 'transparent',
  watermark: 'rgba(236,236,236,0.06)',
  equityBg: '#4a4a4a', equityText: '#a0a0a0', equityLine: '#5a8cd8', balanceLine: '#808080',
};

// ─────────────────────────────────────────────────────────────────────────────
// macOS DARK (modern, Big Sur/Sonoma) — translucent VIBRANCY chrome (backdrop-blur, structural
// in `body.theme-macosdark`), big rounded corners, SF-Pro/system font, macOS systemBlue accent
// (#0a84ff dark-mode), systemGreen/Red candles. The MODERN mac look — distinct from the retro
// Classic Mac Platinum, and from Win11's mica by the SF font + macOS system colours.
// ─────────────────────────────────────────────────────────────────────────────
const MACOS_DARK: ThemeTokens = {
  bg: '#1e1e1e', panel: '#2a2a2c', panel2: '#242426', line: '#3a3a3c', line2: '#48484a',
  fg: '#f2f2f7', muted: '#98989f', accent: '#0a84ff', up: '#30d158', down: '#ff453a', gold: '#ffd60a',
  onAccent: '#ffffff', hover: '#323234', sel: '#0a3a6e', rowLine: '#2e2e30', rowHover: '#2f2f31',
  surface: '#2a2a2c', acctActive: '#10375e', inputRo: '#262628', lineHover: '#0a84ff',
  googleFg: '#1f1f1f', shadow: 'rgba(0,0,0,0.5)', backdrop: 'rgba(0,0,0,0.5)', chartLoadingBg: 'rgba(30,30,30,0.92)',
  green: '#30d158', greenGlow: '#30d15888', greenBg: '#10331c', greenLine: '#1f7a38', greenBgHover: '#175026',
  amber: '#ffd60a', pillFg: '#64d2ff', pillBg: '#0e2e44', pillLine: '#1f5e8a',
  chartBg: '#1e1e1e', scaleText: '#98989f', grid: '#2c2c2e', scaleBorder: '#48484a',
  upBody: '#30d158', downBody: '#ff453a', wick: '#98989f', candleBorder: 'transparent',
  watermark: 'rgba(242,242,247,0.06)',
  equityBg: '#2a2a2c', equityText: '#98989f', equityLine: '#0a84ff', balanceLine: '#7a7a80',
};

// ─────────────────────────────────────────────────────────────────────────────
// macOS LIGHT (modern, Big Sur/Sonoma) — the light sibling: white/light-gray translucent
// vibrancy chrome, big rounded corners, SF-Pro font, macOS systemBlue (#007aff light-mode).
// ─────────────────────────────────────────────────────────────────────────────
const MACOS_LIGHT: ThemeTokens = {
  bg: '#f5f5f7', panel: '#ffffff', panel2: '#eeeef0', line: '#e2e2e6', line2: '#d0d0d4',
  fg: '#1d1d1f', muted: '#6e6e73', accent: '#007aff', up: '#34c759', down: '#ff3b30', gold: '#b8860b',
  onAccent: '#ffffff', hover: '#ebebed', sel: '#cfe4ff', rowLine: '#ededf0', rowHover: '#f4f4f6',
  surface: '#f5f5f7', acctActive: '#d6e9ff', inputRo: '#f0f0f2', lineHover: '#007aff',
  googleFg: '#1f1f1f', shadow: 'rgba(0,0,0,0.14)', backdrop: 'rgba(0,0,0,0.3)', chartLoadingBg: 'rgba(245,245,247,0.92)',
  green: '#248a3d', greenGlow: '#34c75955', greenBg: '#dcf5e3', greenLine: '#8fdca6', greenBgHover: '#caeed6',
  amber: '#b8860b', pillFg: '#0066d6', pillBg: '#dceeff', pillLine: '#a8d2ff',
  chartBg: '#ffffff', scaleText: '#6e6e73', grid: '#ededf0', scaleBorder: '#d0d0d4',
  upBody: '#34c759', downBody: '#ff3b30', wick: '#6e6e73', candleBorder: 'transparent',
  watermark: 'rgba(29,29,31,0.05)',
  equityBg: '#ffffff', equityText: '#6e6e73', equityLine: '#007aff', balanceLine: '#a0a0a6',
};

/** The built-in themes, keyed by id. */
export const BUILTIN_THEMES: Record<string, ThemeDef> = {
  dark: { id: 'dark', name: 'Dark', tokens: DARK },
  light: { id: 'light', name: 'Light', tokens: LIGHT, light: true },
  tertiary: { id: 'tertiary', name: 'Tokyo Night', tokens: TERTIARY },
  '8bit': { id: '8bit', name: '8-bit (NES)', tokens: EIGHT_BIT, body: 'theme-8bit', crt: true },
  '16bit': { id: '16bit', name: '16-bit (SNES)', tokens: SIXTEEN_BIT, body: 'theme-16bit', crt: true },
  matrix: { id: 'matrix', name: 'Matrix', tokens: MATRIX, crt: true },
  dracula: { id: 'dracula', name: 'Dracula', tokens: DRACULA },
  nord: { id: 'nord', name: 'Nord', tokens: NORD },
  solarized: { id: 'solarized', name: 'Solarized Light', tokens: SOLARIZED_LIGHT, light: true },
  bloomberg: { id: 'bloomberg', name: 'Bloomberg Amber', tokens: BLOOMBERG_AMBER },
  synthwave: { id: 'synthwave', name: 'Synthwave', tokens: SYNTHWAVE },
  cyberpunk: { id: 'cyberpunk', name: 'Cyberpunk', tokens: CYBERPUNK },
  gruvbox: { id: 'gruvbox', name: 'Gruvbox Dark', tokens: GRUVBOX_DARK },
  monokai: { id: 'monokai', name: 'Monokai', tokens: MONOKAI },
  cottoncandy: { id: 'cottoncandy', name: 'Cotton Candy', tokens: COTTON_CANDY, kitty: true },
  macaron: { id: 'macaron', name: 'Macaron', tokens: MACARON, kitty: true },
  mono: { id: 'mono', name: 'Black & White', tokens: MONO },
  blueprint: { id: 'blueprint', name: 'Blueprint', tokens: BLUEPRINT },
  ember: { id: 'ember', name: 'Ember', tokens: EMBER },
  royal: { id: 'royal', name: 'Royal Gold', tokens: ROYAL },
  abyss: { id: 'abyss', name: 'Abyss', tokens: ABYSS },
  rosepine: { id: 'rosepine', name: 'Rosé Pine', tokens: ROSE_PINE },
  everforest: { id: 'everforest', name: 'Everforest', tokens: EVERFOREST },
  parchment: { id: 'parchment', name: 'Parchment', tokens: PARCHMENT, light: true },
  bordeaux: { id: 'bordeaux', name: 'Bordeaux', tokens: BORDEAUX },
  kali: { id: 'kali', name: 'Kali', tokens: KALI, crt: true },
  code: { id: 'code', name: 'Code', tokens: CODE },
  ticker: { id: 'ticker', name: 'Ticker', tokens: TICKER },
  highcontrast: { id: 'highcontrast', name: 'High Contrast', tokens: HIGH_CONTRAST, light: true },
  highcontrastdark: { id: 'highcontrastdark', name: 'High Contrast Dark', tokens: HIGH_CONTRAST_DARK },
  oldschool: { id: 'oldschool', name: 'Old School', tokens: OLD_SCHOOL, light: true },
  oldschooldark: { id: 'oldschooldark', name: 'Old School Dark', tokens: OLD_SCHOOL_DARK },
  nextstep: { id: 'nextstep', name: 'NeXTSTEP', tokens: NEXTSTEP, light: true },
  platinum: { id: 'platinum', name: 'Classic Mac OS', tokens: PLATINUM, light: true },
  platinumdark: { id: 'platinumdark', name: 'Classic Mac OS Dark', tokens: PLATINUM_DARK },
  dosamber: { id: 'dosamber', name: 'DOS Amber', tokens: DOS_AMBER, crt: true },
  greencrt: { id: 'greencrt', name: 'Green Phosphor', tokens: GREEN_CRT, crt: true, body: 'crt-pixel' },
  winxp: { id: 'winxp', name: 'Windows XP', tokens: WINXP, light: true },
  winxpdark: { id: 'winxpdark', name: 'Windows XP Dark', tokens: WINXP_DARK },
  win7: { id: 'win7', name: 'Windows 7', tokens: WIN7, light: true },
  win7dark: { id: 'win7dark', name: 'Windows 7 Dark', tokens: WIN7_DARK },
  win11: { id: 'win11', name: 'Windows 11', tokens: WIN11 },
  win11light: { id: 'win11light', name: 'Windows 11 Light', tokens: WIN11_LIGHT, light: true },
  macosdark: { id: 'macosdark', name: 'macOS', tokens: MACOS_DARK },
  macoslight: { id: 'macoslight', name: 'macOS Light', tokens: MACOS_LIGHT, light: true },
  github: { id: 'github', name: 'GitHub Dark', tokens: GITHUB_DARK },
  githublight: { id: 'githublight', name: 'GitHub Light', tokens: GITHUB_LIGHT, light: true },
  halloween: { id: 'halloween', name: 'Halloween', tokens: HALLOWEEN },
  academic: { id: 'academic', name: 'Academic', tokens: ACADEMIC, light: true },
};

/** Ids of the "cute" themes whose candles render as kitties — derived from the `kitty`
 *  flag so it stays in sync as themes are added. The KittyLayer overlay checks whether
 *  the active `theme-<id>` body class is one of these. */
export const KITTY_THEME_IDS: string[] = Object.values(BUILTIN_THEMES).filter((t) => t.kitty).map((t) => t.id);

/** The default theme id when none/unknown is set. */
export const DEFAULT_THEME_ID = 'dark';

/** Resolve a theme id to its definition (falls back to dark). */
export function resolveTheme(id: string | undefined | null): ThemeDef {
  return (id && BUILTIN_THEMES[id]) || BUILTIN_THEMES[DEFAULT_THEME_ID]!;
}

/** All theme ids in display order (for the switcher). */
export const THEME_ORDER: string[] = ['dark', 'light', 'tertiary', '8bit', '16bit', 'matrix', 'dracula', 'nord', 'solarized', 'bloomberg', 'synthwave', 'cyberpunk', 'gruvbox', 'monokai', 'cottoncandy', 'macaron', 'mono', 'blueprint', 'ember', 'royal', 'abyss', 'rosepine', 'everforest', 'parchment', 'bordeaux', 'kali', 'code', 'ticker', 'highcontrast', 'highcontrastdark', 'oldschool', 'oldschooldark', 'nextstep', 'platinum', 'platinumdark', 'dosamber', 'greencrt', 'winxp', 'winxpdark', 'win7', 'win7dark', 'win11', 'win11light', 'macosdark', 'macoslight', 'github', 'githublight', 'halloween', 'academic'];
