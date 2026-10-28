/**
 * Web entry — the browser host for the shared renderer.
 *
 * Ordering is load-bearing: the renderer reads `window.terminal` at MODULE LOAD
 * (renderer/api.ts: `export const api = window.terminal`), so the platform MUST
 * be installed BEFORE the renderer's module graph evaluates. We install
 * synchronously, then DYNAMIC-import the renderer — esbuild keeps a dynamically
 * imported internal module's top-level code deferred until the `import()` runs,
 * so `installWebPlatform()` is guaranteed to have set `window.terminal` first. A
 * static import would be hoisted and the renderer would read undefined.
 *
 * Config comes from the host page via `window.__TICKERALL_WEB__`:
 *   - Embedded: the host injects { getToken, user } from its logged-in session.
 *   - Standalone: with no host config, a direct sign-in provider is used; supply
 *     `authUrl`. REST/stream default to the public TickerAll API.
 *   - Any API: supply a `backend` (see backend.ts) to run against your own server.
 *     Omit it and the default TickerAll backend is used — no hooks needed.
 */

import { installWebPlatform } from './mount';
import { createDirectWebAuth, createHostWebAuth, type HostAuthHooks } from './webAuth';
import { createTickerallBackend } from './tickerallBackend';
import type { TerminalBackend } from './backend';
import type { HostNavItem } from '../shared/types';
import type { WebAuthProvider } from './webTerminalApi';

interface TickerallWebConfig {
  /** REST base. Default https://api.tickerall.com (used by the default backend). */
  baseUrl?: string;
  /** WS stream. Default derived from baseUrl → wss://…/v1/stream (default backend). */
  streamUrl?: string;
  /** Run against ANY API: supply a backend (see backend.ts). Omit → default TickerAll backend. */
  backend?: TerminalBackend;
  /** Manual trading allowed. Default true (full trading); false = watch-only
   *  (capabilities.canTrade:false → the renderer hides all buy/sell UI). */
  tradingEnabled?: boolean;
  /** Seed for the INITIAL active account. A host that already warmed a broker
   *  account injects its accountId so the renderer auto-selects + connects it on
   *  first load (no manual pick+connect). Surfaced on platform.activeAccountId;
   *  only used when there's no persisted active account. */
  activeAccountId?: string;
  /** Deep-link: boot the chart on a specific symbol + timeframe. Forwarded to
   *  platform.activeSymbol/activeTimeframe; the renderer applies them once the
   *  account roster resolves (the symbol must be on that account's roster).
   *  `activeTimeframe` is a canonical TF TOKEN (M1/M5/H1/…), independently optional.
   *  Both untouched when absent. */
  activeSymbol?: string;
  activeTimeframe?: string;
  /** Host-injected extra entries for the MOBILE bottom bar (e.g. an "exit to app"
   *  item). Forwarded to platform.mobileNavItems; the renderer appends them to its
   *  built-in tabs. */
  mobileNavItems?: HostNavItem[];
  /** Sign-in base URL for the standalone (direct) auth path. */
  authUrl?: string;
  /** Host owns auth entirely — a full provider. */
  auth?: WebAuthProvider;
  /** Or just the session token (+ optional user / login hooks) — wrapped here. */
  getToken?: HostAuthHooks['getToken'];
  user?: HostAuthHooks['user'];
  loginEmail?: HostAuthHooks['loginEmail'];
  loginGoogle?: HostAuthHooks['loginGoogle'];
  logout?: HostAuthHooks['logout'];
  onAuthChange?: HostAuthHooks['onAuthChange'];
}

declare global {
  interface Window { __TICKERALL_WEB__?: TickerallWebConfig }
}

/** https://api.tickerall.com → wss://api.tickerall.com/v1/stream */
function deriveStreamUrl(httpBase: string): string {
  const ws = httpBase.replace(/^http/, 'ws').replace(/\/$/, '');
  return `${ws}/v1/stream`;
}

const cfg: TickerallWebConfig = window.__TICKERALL_WEB__ ?? {};

const baseUrl = (cfg.baseUrl ?? 'https://api.tickerall.com').replace(/\/$/, '');
const streamUrl = cfg.streamUrl ?? deriveStreamUrl(baseUrl);

// Default standalone "Sign out": a full-page POST to the host's logout route,
// which clears the session server-side and redirects to sign-in. Used only when
// the host injected no logout hook; otherwise the host's hook wins.
const hostLogout = async (): Promise<void> => {
  const f = document.createElement('form');
  f.method = 'POST';
  f.action = '/api/auth/logout';
  document.body.appendChild(f);
  f.submit();
};

const auth: WebAuthProvider =
  cfg.auth
  ?? (cfg.getToken
    ? createHostWebAuth({
        getToken: cfg.getToken,
        user: cfg.user,
        loginEmail: cfg.loginEmail,
        loginGoogle: cfg.loginGoogle,
        logout: cfg.logout ?? hostLogout,
        onAuthChange: cfg.onAuthChange,
      })
    : createDirectWebAuth(cfg.authUrl ?? ''));

// The broker data/trade/stream backend. A host can inject its own (any API);
// otherwise the default talks to the TickerAll API with the session JWT — no hooks.
const backend: TerminalBackend = cfg.backend ?? createTickerallBackend({ baseUrl, streamUrl, getToken: () => auth.getToken() });

installWebPlatform({ backend, auth, tradingEnabled: cfg.tradingEnabled, activeAccountId: cfg.activeAccountId, activeSymbol: cfg.activeSymbol, activeTimeframe: cfg.activeTimeframe, mobileNavItems: cfg.mobileNavItems });

// Subtle "TickerAll" brand mark, bottom-right, low-opacity and non-interactive.
// A host can hide it with CSS: [data-tickerall-mark] { display: none }
try {
  const addMark = (): void => {
    if (!document.body || document.querySelector('[data-tickerall-mark]')) return;
    const mark = document.createElement('div');
    mark.setAttribute('data-tickerall-mark', '');
    mark.textContent = 'TickerAll';
    mark.style.cssText =
      'position:fixed;right:7px;bottom:calc(3px + env(safe-area-inset-bottom,0px));' +
      'z-index:2147483000;font:600 10px/1 system-ui,-apple-system,sans-serif;letter-spacing:.06em;' +
      'color:currentColor;opacity:.16;pointer-events:none;user-select:none';
    document.body.appendChild(mark);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addMark);
  else addMark();
} catch { /* non-fatal */ }
console.log('%cTickerAll Web Terminal%c · tickerall.com', 'color:#e8a13c;font-weight:700', 'color:inherit');

// Renderer boots now (and only now reads window.terminal).
import('../renderer/main').catch((e: unknown) => {
  const root = document.getElementById('root');
  if (root) root.innerHTML = `<div class="center muted" style="padding:40px;text-align:center">Failed to load the terminal.<br/><span class="tiny">${String((e as Error)?.message ?? e)}</span></div>`;
});
