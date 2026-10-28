import { useEffect, useState } from 'react';

/** Layout tier. The desktop Electron app is ALWAYS 'desktop' (the responsive layout
 *  is web-only per product spec); the web terminal reflows by viewport width. */
export type Tier = 'desktop' | 'tablet' | 'mobile';

/** Breakpoints (px), inclusive upper bounds. Mobile ≤600, tablet 601–1024, desktop
 *  ≥1025 — EXCEPT a TOUCH (coarse-pointer) device up to BP_TABLET_TOUCH_MAX is kept on
 *  the tablet layout, so an iPad in landscape (~1080–1366) gets the touch layout instead
 *  of the mouse/hover desktop one. The responsive CSS keys off #mt5[data-tier], so the
 *  tier resolved here is the single source of truth (no @media mirror to keep in sync). */
export const BP_MOBILE_MAX = 600;
export const BP_TABLET_MAX = 1024;
/** Upper width bound for treating a TOUCH device as a tablet (covers iPad Pro 12.9"
 *  landscape = 1366). A mouse (fine) pointer above BP_TABLET_MAX still gets desktop. */
export const BP_TABLET_TOUCH_MAX = 1366;

/** True when running as the WEB terminal. The web build bakes `class="web"` +
 *  `data-platform="web"` onto <html> BEFORE first paint (build.mjs HTML transform);
 *  desktop Electron emits the untouched index.html and so lacks the marker → always
 *  'desktop'. A localStorage override (`ta.platform=web`) lets a desktop browser
 *  preview the web layout without a real device. */
export function isWebPlatform(): boolean {
  if (typeof document === 'undefined') return false;
  const el = document.documentElement;
  if (el.dataset.platform === 'web' || el.classList.contains('web')) return true;
  try { return localStorage.getItem('ta.platform') === 'web'; } catch { return false; }
}

/** Pure tier resolver — width + isWeb → tier. Exported for unit tests. Desktop never
 *  reflows regardless of width, so a narrow Electron window stays the full layout. */
export function resolveTier(width: number, isWeb: boolean, height?: number, coarsePointer = false): Tier {
  if (!isWeb) return 'desktop';
  if (width <= BP_MOBILE_MAX) return 'mobile';
  // A PHONE turned sideways (e.g. 844×390) is still a phone: its short side is ≤ the mobile
  // breakpoint and it has a touch (coarse) pointer. Width alone would call it a tablet and
  // hand it the three-panel layout with the chart squeezed to a sliver. The coarse-pointer
  // gate keeps a short desktop browser window (mouse) on its normal tiers.
  if (height !== undefined && height <= BP_MOBILE_MAX && coarsePointer && width <= BP_TABLET_MAX) return 'mobile';
  if (width <= BP_TABLET_MAX) return 'tablet';
  // An iPad (and other large tablets) in landscape is 1025–1366 wide but has a touch
  // (coarse) pointer — keep it on the touch tablet layout rather than the mouse/hover
  // desktop one (whose fixed 272px sidebar + 212px toolbox squeeze the chart, and the
  // #mt5 overflow:hidden shell clips anything that overflows). A real desktop at the
  // same width has a fine pointer and correctly stays 'desktop'.
  if (coarsePointer && width <= BP_TABLET_TOUCH_MAX) return 'tablet';
  return 'desktop';
}

/** Touch-first device? (`pointer: coarse` — phones/tablets; false for a mouse, in SSR, and in tests.) */
export function hasCoarsePointer(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try { return window.matchMedia('(pointer: coarse)').matches; } catch { return false; }
}

/** Dev/test override: force a layout tier regardless of width/pointer via localStorage
 *  `ta.tier` (set by the in-terminal tier toggle). null when unset/invalid → normal resolution.
 *  Lets you preview mobile/tablet/desktop on any device without resizing. */
export function tierOverride(): Tier | null {
  if (typeof window === 'undefined') return null;
  try {
    const t = localStorage.getItem('ta.tier');
    return (t === 'mobile' || t === 'tablet' || t === 'desktop') ? t : null;
  } catch { return null; }
}

export interface Viewport {
  tier: Tier;
  isWeb: boolean;
  width: number;
  height: number;
}

/** 'landscape' when wider than tall — the phone turned sideways gets a chart-only Charts view. */
export function orientationOf(width: number, height: number): 'portrait' | 'landscape' {
  return width > height ? 'landscape' : 'portrait';
}

/** Responsive viewport hook. Tracks window width (web only) and resolves the layout
 *  tier. On desktop Electron it resolves once to 'desktop' and attaches NO resize
 *  listener (zero churn, the layout can never reflow). On web it rAF-coalesces resize
 *  events and only re-renders when the tier actually changes. */
export function useViewport(): Viewport {
  const [vp, setVp] = useState<Viewport>(() => {
    const isWeb = isWebPlatform();
    const width = typeof window === 'undefined' ? 1280 : window.innerWidth;
    const height = typeof window === 'undefined' ? 800 : window.innerHeight;
    return { tier: tierOverride() ?? resolveTier(width, isWeb, height, hasCoarsePointer()), isWeb, width, height };
  });

  useEffect(() => {
    const isWeb = isWebPlatform();
    if (!isWeb) return; // desktop: nothing to track, layout is fixed
    let raf = 0;
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const width = window.innerWidth;
        const height = window.innerHeight;
        const tier = tierOverride() ?? resolveTier(width, true, height, hasCoarsePointer());
        setVp((prev) => (prev.tier === tier && prev.width === width && prev.height === height ? prev : { tier, isWeb: true, width, height }));
      });
    };
    window.addEventListener('resize', onResize);
    onResize(); // sync once in case width changed between initial state and mount
    return () => { window.removeEventListener('resize', onResize); cancelAnimationFrame(raf); };
  }, []);

  return vp;
}
