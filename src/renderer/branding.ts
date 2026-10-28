/**
 * Host-injected branding — lets a partner host serve THIS renderer under its own product
 * name / logo, so none of the built-in "TickerAll" marks render for that partner's users,
 * from ONE shared bundle (no fork). The web host stamps discrete `<html data-brand-*>`
 * attributes at serve time — the same channel it already stamps `data-platform="web"` on,
 * so it is CSP-clean (no inline script, which the renderer's `script-src 'self'` policy
 * would block) and read the same way `useViewport.isWebPlatform()` reads the platform marker.
 *
 * The frozen host contract is the attribute NAMES below (agreed with the web-host owner):
 *   data-brand-name        → productName   (absent → 'TickerAll')
 *   data-brand-logo        → logoDataUri   (optional; a `data:` URI that REPLACES the text wordmark)
 *   data-brand-logo-color  → logoColor     (optional; tints the TEXT wordmark ONLY — never --accent)
 *   data-brand-accent      → accent        (optional; DOES override the per-theme --accent, see below)
 *   data-brand-accent-dark → accentDark    (optional; the accent to use on DARK themes instead)
 *   data-brand-home        → homeUrl       (optional; absent → '/')
 *   data-brand-hide-logo   → hideBrandMark (optional; value "true" ⇒ suppress the top-bar brand
 *                                            mark entirely — for a partner host that supplies its
 *                                            OWN navbar logo/chrome and would otherwise show two)
 *
 * `data-brand-accent` is the ONE attribute that reaches past the wordmark into the theme: it
 * replaces the active theme's `--accent` (and recomputes `--on-accent` for legibility) at
 * theme-apply time. It exists so a partner that embeds the terminal inside its own mobile shell
 * gets ONE bar in ONE colour — the built-in tabs, the host-injected nav entries and the rest of
 * the interactive chrome all tint together, instead of a partner-crimson host bar butting up
 * against a TickerAll-blue terminal bar. This DELIBERATELY relaxes the original "branding never
 * sets --accent" contract (authorized 2026-07-29 for the Studio mobile bar); `data-brand-logo-color`
 * is unchanged and still tints the wordmark ONLY. `data-brand-accent-dark` covers the case where
 * one colour can't serve both a light and a dark palette; absent, the base accent serves both.
 * Chart colours are NOT touched — the theme's palette keeps owning the canvas.
 *
 * ABSENT attributes fall back to the built-in TickerAll identity, so tickerall.com — which
 * stamps nothing — is byte-unchanged (§29 presence semantics: an empty/whitespace value is
 * treated as ABSENT, never as a real "" brand). The attributes are stamped before first
 * paint and never change at runtime, so this is a plain read of `document.documentElement`.
 */

export interface Branding {
  /** Product wordmark + window/label copy. Default 'TickerAll'. */
  productName: string;
  /** Optional logotype as a self-contained `data:` URI — replaces the text wordmark (an <img>). */
  logoDataUri?: string;
  /** Optional colour for the TEXT wordmark only (never the per-theme `--accent`). */
  logoColor?: string;
  /** Optional partner accent that REPLACES the active theme's `--accent` (all themes unless
   *  `accentDark` narrows it). Undefined unless a valid CSS colour was stamped. */
  accent?: string;
  /** Optional accent used on DARK themes in place of `accent` (for a partner colour that only
   *  reads on one base). Undefined → `accent` serves every theme. */
  accentDark?: string;
  /** Where the home/logo link navigates (web only). Default '/' = the serving origin root. */
  homeUrl: string;
  /**
   * Suppress the renderer's own top-bar brand mark. A partner host that renders its own navbar
   * logo stamps `data-brand-hide-logo="true"` so the bundle doesn't ALSO show a mark (→ dupe).
   * Absent → false, so tickerall.com and every current host are unchanged (§29 presence).
   */
  hideBrandMark: boolean;
}

const DEFAULT_PRODUCT_NAME = 'TickerAll';

/** Trim to a non-empty string, or undefined — an empty/whitespace attr counts as absent (§29). */
function clean(v: string | undefined): string | undefined {
  const s = v?.trim();
  return s ? s : undefined;
}

/**
 * A CSS colour we're willing to write into `--accent`: `#rgb`/`#rgba`/`#rrggbb`/`#rrggbbaa`, a
 * functional `rgb()/rgba()/hsl()/hsla()`, or a plain colour keyword. Anything else is treated as
 * ABSENT, so a typo'd/garbage attribute leaves the theme's own accent standing rather than
 * silently blanking the interactive colour of the whole UI.
 */
const COLOR_RE = /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([0-9a-z.,%\/\s+-]*\)|[a-z]+)$/i;

/** Trim to a valid CSS colour, or undefined (a bad value must not blank `--accent`). */
function cleanColor(v: string | undefined): string | undefined {
  const s = clean(v);
  return s && COLOR_RE.test(s) ? s : undefined;
}

/** The camelCase dataset keys the browser derives from the `data-brand-*` attributes. */
interface BrandDataset {
  brandName?: string;
  brandLogo?: string;
  brandLogoColor?: string;
  brandAccent?: string;
  brandAccentDark?: string;
  brandHome?: string;
  brandHideLogo?: string;
}

/**
 * Pure resolver: raw `<html>` dataset → resolved Branding (defaults filled). Exported so the
 * resolution logic is unit-testable without a DOM (mirrors `useViewport.resolveTier`'s split).
 */
export function resolveBranding(ds: BrandDataset): Branding {
  return {
    productName: clean(ds.brandName) ?? DEFAULT_PRODUCT_NAME,
    logoDataUri: clean(ds.brandLogo),
    logoColor: clean(ds.brandLogoColor),
    accent: cleanColor(ds.brandAccent),
    accentDark: cleanColor(ds.brandAccentDark),
    homeUrl: clean(ds.brandHome) ?? '/',
    hideBrandMark: clean(ds.brandHideLogo) === 'true',
  };
}

/**
 * True when NO partner brand is stamped (no `data-brand-name`) → render TickerAll's house
 * wordmark (the TICKER + [ALL!] pill). A stamped partner name renders as a plain word/logo.
 * Exported pure for tests.
 */
export function isDefaultBrandFrom(ds: Pick<BrandDataset, 'brandName'>): boolean {
  return clean(ds.brandName) === undefined;
}

/**
 * Preview/screenshot hook: `?hidelogo=1` in the URL forces the brand mark off with NO
 * host-stamped attribute, so the host can verify the "host supplies its own chrome" layout
 * from a plain preview URL. It only ever adds suppression — a real stamped attr wins.
 */
function previewHideLogo(): boolean {
  if (typeof window === 'undefined' || !window.location) return false;
  return new URLSearchParams(window.location.search).get('hidelogo') === '1';
}

/** The live `<html>` dataset, or {} when there's no document (node / unit tests). */
function htmlDataset(): BrandDataset {
  if (typeof document === 'undefined') return {};
  const ds = document.documentElement.dataset;
  return {
    brandName: ds.brandName,
    brandLogo: ds.brandLogo,
    brandLogoColor: ds.brandLogoColor,
    brandAccent: ds.brandAccent,
    brandAccentDark: ds.brandAccentDark,
    brandHome: ds.brandHome,
    // Host-stamped attr wins; else the `?hidelogo=1` preview hook can force suppression.
    brandHideLogo: ds.brandHideLogo ?? (previewHideLogo() ? 'true' : undefined),
  };
}

/** The resolved branding for this session (host-stamped `<html data-brand-*>` or TA default). */
export function getBranding(): Branding {
  return resolveBranding(htmlDataset());
}

/** Whether to paint TickerAll's house wordmark (i.e. no partner brand is stamped). */
export function isDefaultBrand(): boolean {
  return isDefaultBrandFrom(htmlDataset());
}

/**
 * Pure resolver — exported for tests. The partner accent to use for a theme, or undefined when
 * none is stamped (→ the theme keeps its own `--accent`). `accentDark` wins on a dark theme;
 * with only `accent` stamped, one colour serves every theme.
 */
export function resolveBrandAccent(b: Pick<Branding, 'accent' | 'accentDark'>, light: boolean): string | undefined {
  return (light ? b.accent : (b.accentDark ?? b.accent)) ?? undefined;
}

/** Expand `#rgb`/`#rgba` to 6 hex digits; undefined for any non-hex colour. */
function hexRgb(c: string): [number, number, number] | undefined {
  const m = /^#([0-9a-f]{3,8})$/i.exec(c);
  if (!m) return undefined;
  let h = m[1];
  if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split('').map((d) => d + d).join('');
  if (h.length < 6) return undefined;
  const n = parseInt(h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Pure resolver — exported for tests. The legible ink to place ON a partner accent fill (the
 * `--on-accent` token: active-tf text, primary buttons, the hovered logo pill). Black on a light
 * accent, white on a dark one, by WCAG relative luminance — so a pale partner colour can't ship
 * white-on-white. Undefined for a non-hex colour we can't measure: the theme's own `--on-accent`
 * then stands (§29 — unmeasurable is ABSENT, never a guessed value).
 */
export function onAccentFor(accent: string): string | undefined {
  const rgb = hexRgb(accent);
  if (!rgb) return undefined;
  const lin = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  const L = 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
  // Contrast vs white is (1.05)/(L+0.05); vs black it's (L+0.05)/0.05. They cross at L≈0.179.
  return L > 0.179 ? '#000000' : '#ffffff';
}

/** The host-stamped accent for a theme of this base (light/dark), or undefined when none. */
export function getBrandAccent(light: boolean): string | undefined {
  return resolveBrandAccent(getBranding(), light);
}
