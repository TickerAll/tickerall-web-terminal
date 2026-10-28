/**
 * Web auth providers — the browser side of `WebAuthProvider` (the host-supplied
 * auth the WebTerminalApi delegates to).
 *
 * The web terminal authenticates to the TickerAll API with a short-lived session
 * JWT, sent as `Authorization: Bearer <JWT>` on every request. Broker passwords
 * are NEVER persisted in the browser.
 *
 * Two providers:
 *  - `createDirectWebAuth(authUrl)` — talks to a TickerAll sign-in endpoint
 *    directly (email login + token refresh). For standalone / self-hosted use;
 *    you must supply the sign-in base URL.
 *  - `createHostWebAuth(hooks)` — wraps a host-supplied `getToken` (+ optional
 *    user / login hooks). This is the embedded path: the host page already holds
 *    the logged-in session and hands the terminal the JWT (refreshed host-side),
 *    so the browser never calls a sign-in endpoint directly.
 */

import type { AuthState, AuthUser } from '../shared/types';
import type { WebAuthProvider } from './webTerminalApi';

const APP = 'tickerall';
const LS_SESSION = 'tickerall.web.session'; // { refreshToken, user } — the JWT session, never a broker password

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: AuthUser & { phone?: string; roles?: string[] };
}

/** Read a JWT's `exp` (→ epoch ms) without verifying — only to schedule a
 *  proactive refresh. Browser base64url decode (atob needs '+/' + padding). */
function jwtExpiryMs(jwt: string): number | null {
  try {
    const part = jwt.split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    const payload = JSON.parse(atob(b64 + pad)) as { exp?: number };
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

const toUser = (u: AuthTokens['user']): AuthUser => ({ id: u.id, email: u.email, displayName: u.displayName });

/** Direct sign-in provider (standalone / self-hosted). */
class DirectWebAuth implements WebAuthProvider {
  private readonly authUrl: string;
  private accessToken: string | null = null;
  private accessTokenExpMs = 0;
  private user: AuthUser | null = null;
  private refreshing: Promise<string> | null = null;
  private readonly listeners: Array<(s: AuthState) => void> = [];

  constructor(authUrl: string) {
    if (!authUrl) {
      throw new Error(
        'createDirectWebAuth requires a sign-in base URL. On an embedded host, inject a token via window.__TICKERALL_WEB__.getToken instead.',
      );
    }
    this.authUrl = authUrl.replace(/\/$/, '');
    this.user = this.readSession()?.user ?? null;
  }

  // ── localStorage session (refreshToken + user; accessToken stays in memory) ──
  private readSession(): { refreshToken: string; user: AuthUser } | null {
    try { const s = localStorage.getItem(LS_SESSION); return s ? (JSON.parse(s) as { refreshToken: string; user: AuthUser }) : null; }
    catch { return null; }
  }
  private writeSession(refreshToken: string, user: AuthUser): void {
    try { localStorage.setItem(LS_SESSION, JSON.stringify({ refreshToken, user })); } catch { /* quota — stay in memory */ }
  }
  private clearSession(): void { try { localStorage.removeItem(LS_SESSION); } catch { /* ignore */ } }

  async authStatus(): Promise<AuthState> {
    const sess = this.readSession();
    if (!sess) return { authed: false };
    this.user = sess.user;
    return { authed: true, user: sess.user };
  }

  /** A valid short-lived access token: cached until ~60s before expiry, else
   *  refreshed (single-flight) from the persisted single-use refreshToken. */
  async getToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.accessTokenExpMs - 60_000) return this.accessToken;
    if (this.refreshing) return this.refreshing;
    const sess = this.readSession();
    if (!sess?.refreshToken) throw new Error('Not logged in — sign in to TickerAll first.');
    this.refreshing = (async () => {
      try {
        const t = await this.post<AuthTokens>('/v1/auth/refresh', { refreshToken: sess.refreshToken });
        this.applyAccess(t.accessToken);
        this.user = toUser(t.user);
        this.writeSession(t.refreshToken, this.user); // rotated single-use refresh
        return t.accessToken;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  async loginEmail(email: string, password: string): Promise<AuthState> {
    return this.complete(await this.post<AuthTokens>('/v1/auth/login', { email, password, app: APP }));
  }
  async loginGoogle(): Promise<AuthState> {
    throw new Error('Google sign-in is handled by the TickerAll website — use email sign-in here, or open the terminal from tickerall.com.');
  }
  async logout(): Promise<void> {
    this.accessToken = null; this.accessTokenExpMs = 0; this.user = null; this.refreshing = null;
    this.clearSession(); this.emit();
  }
  onAuthChange(cb: (state: AuthState) => void): void { this.listeners.push(cb); }

  private complete(t: AuthTokens): AuthState {
    this.applyAccess(t.accessToken);
    this.user = toUser(t.user);
    this.writeSession(t.refreshToken, this.user);
    this.emit();
    return { authed: true, user: this.user };
  }
  private applyAccess(accessToken: string): void {
    this.accessToken = accessToken;
    this.accessTokenExpMs = jwtExpiryMs(accessToken) ?? (Date.now() + 5 * 60_000);
  }
  private emit(): void {
    const s: AuthState = this.user ? { authed: true, user: this.user } : { authed: false };
    for (const cb of this.listeners) { try { cb(s); } catch { /* listener error */ } }
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.authUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    } catch (e) {
      throw new Error((e as Error)?.message || 'Network request failed');
    }
    if (!res.ok) {
      let msg = `${res.status}`;
      try { const j = (await res.json()) as { error?: string; message?: string }; msg = j.error ?? j.message ?? msg; } catch { /* keep status */ }
      throw new Error(msg); // 'invalid_credentials' flows through to humanizeError()
    }
    return (await res.json()) as T;
  }
}

export function createDirectWebAuth(authUrl: string): WebAuthProvider {
  return new DirectWebAuth(authUrl);
}

// ── Host-injected provider (embedded) ────────────────────────────────────────

/** What the host page wires when it owns auth (it already holds the session). */
export interface HostAuthHooks {
  /** Returns a valid short-lived JWT (the host refreshes it, e.g. via a server
   *  route — a browser can't refresh across origins). */
  getToken: () => string | Promise<string>;
  user?: AuthUser;
  loginEmail?: (email: string, password: string) => Promise<AuthState>;
  loginGoogle?: () => Promise<AuthState>;
  logout?: () => Promise<void>;
  onAuthChange?: (cb: (s: AuthState) => void) => void;
}

/** Wrap host-supplied auth hooks into a WebAuthProvider. The host only mounts the
 *  terminal once the user is signed in, so `authStatus` reports authed. */
export function createHostWebAuth(hooks: HostAuthHooks): WebAuthProvider {
  const managed = async (): Promise<never> => { throw new Error('Sign-in is managed by TickerAll.'); };
  return {
    getToken: () => hooks.getToken(),
    authStatus: async () => (hooks.user ? { authed: true, user: hooks.user } : { authed: true }),
    loginEmail: hooks.loginEmail ?? managed,
    loginGoogle: hooks.loginGoogle ?? managed,
    logout: hooks.logout ?? (async () => { /* host-managed */ }),
    onAuthChange: hooks.onAuthChange ?? (() => { /* host-managed */ }),
  };
}
