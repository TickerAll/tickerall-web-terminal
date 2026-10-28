/**
 * the TickerAll API transport for the WEB target — raw `fetch` (REST) + a native browser
 * `WebSocket` (stream). The desktop terminal uses `the desktop app` (node) in its
 * main process; the browser can't (the SDK `require('ws')` + sets a WS
 * Authorization header, both node-only). So the web data-layer talks to the TickerAll API
 * directly: the endpoints + the stream frame-protocol are reused 1:1 from the SDK.
 *
 *   - HTTP: `Authorization: Bearer <JWT>` header (browser fetch allows headers).
 *   - WS:   `wss://…/v1/stream?token=<JWT>` (browsers can't set WS headers; the TickerAll API
 *           already accepts the query token).
 *
 * Auth is injected as a `getToken()` provider (the web host supplies the user's
 * short-lived JWT from the frontend session — never a stored broker password).
 */

export interface ApiConfig {
  /** REST base, e.g. https://api.tickerall.com */
  baseUrl: string;
  /** Stream base, e.g. wss://api.tickerall.com/v1/stream */
  streamUrl: string;
  /** Supplies a valid short-lived JWT for each request / WS connect. */
  getToken: () => string | Promise<string>;
}

/** A mapped the TickerAll API error — carries the machine `code` + HTTP `status` so callers
 *  can branch (e.g. BROKER_ACCOUNT_NOT_HOT, FREE_TIER_LIVE_REJECTED). */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;
  constructor(p: { code: string; status: number; message: string; details?: unknown }) {
    super(p.message);
    this.name = 'ApiError';
    this.code = p.code;
    this.status = p.status;
    this.details = p.details;
  }
}

interface RequestOpts {
  body?: unknown;
  signal?: AbortSignal;
  /** Idempotency-Key header for the POST/DELETE/PATCH trade + session routes. */
  idempotencyKey?: string;
  /** A 204 is a valid success (no JSON body). */
  expectNoContent?: boolean;
}

export class ApiHttp {
  constructor(private readonly cfg: ApiConfig) {}

  async request<T>(method: string, path: string, opts: RequestOpts = {}): Promise<T> {
    const token = await this.cfg.getToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;

    let res: Response;
    try {
      res = await fetch(`${this.cfg.baseUrl}${path}`, {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: opts.signal,
      });
    } catch (e) {
      throw new ApiError({
        status: 0,
        code: 'NETWORK_ERROR',
        message: (e as Error)?.message || 'Network request failed',
      });
    }

    if (opts.expectNoContent && res.status === 204) return undefined as T;
    if (!res.ok) {
      const errBody = await this.safeJson(res);
      throw new ApiError({
        status: res.status,
        code: (errBody?.error as string) ?? (errBody?.code as string) ?? `HTTP_${res.status}`,
        message: (errBody?.message as string) ?? res.statusText ?? 'Request failed',
        details: errBody?.details,
      });
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  /** Convenience: a fresh idempotency key for the write routes. */
  idempotencyKey(): string {
    const c = globalThis.crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  private async safeJson(res: Response): Promise<Record<string, unknown> | null> {
    try {
      const t = await res.text();
      if (!t) return null;
      try { return JSON.parse(t) as Record<string, unknown>; }
      catch { return { error: 'PARSE_ERROR', message: t }; }
    } catch {
      return null;
    }
  }
}

// ── Stream ──────────────────────────────────────────────────────────────────
// Native-WebSocket port of the SDK's stream: connect → subscribe → frames, with
// heartbeat + exponential-backoff reconnect + resubscribe-on-reconnect. The the TickerAll API
// frame protocol (tick / position_update / account_update / subscribed / error /
// pong) is identical to the SDK's; only the transport (browser WS + ?token) differs.

export interface ApiTick { accountId: string; symbol: string; bid: number; ask: number; timestamp: string }
export interface ApiPositionFrame { accountId: string; event: 'opened' | 'updated' | 'closed'; position: unknown }
export interface ApiAccountFrame { accountId: string; snapshot: { balance: number; group?: string; [k: string]: unknown } }
export interface ApiOrdersFrame { accountId: string; orders: unknown[] }

type StreamEvent = 'tick' | 'position' | 'orders' | 'account' | 'log' | 'reconnect' | 'state';
/** 'reconnecting' from the moment the socket drops (not by the user) until it is back. */
export type StreamState = 'connected' | 'reconnecting';
type Sub =
  | { kind: 'ticks'; accountId: string; symbols: Set<string> }
  | { kind: 'positions'; accountId: string }
  | { kind: 'orders'; accountId: string }
  | { kind: 'account'; accountId: string };

const HEARTBEAT_MS = 25_000;
const HEARTBEAT_TIMEOUT_MS = 10_000;
const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];

export class ApiStream {
  private ws: WebSocket | null = null;
  private closedByUser = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly subs = new Map<string, Sub>();
  private readonly listeners: Record<StreamEvent, Array<(arg: unknown) => void>> = {
    tick: [], position: [], orders: [], account: [], log: [], reconnect: [], state: [],
  };
  private lifecycleHooked = false;

  constructor(private readonly cfg: ApiConfig) {}

  on(event: StreamEvent, cb: (arg: never) => void): void {
    this.listeners[event].push(cb as (arg: unknown) => void);
  }
  private emit(event: StreamEvent, arg: unknown): void {
    for (const cb of this.listeners[event]) { try { cb(arg); } catch { /* listener error — ignore */ } }
  }

  async connect(): Promise<void> {
    this.closedByUser = false;
    this.hookLifecycle();
    await this.openOnce();
  }

  /** Phones suspend the page: the socket dies quietly and the backoff timer is frozen. When the
   *  app returns to the foreground (or the network comes back) reconnect NOW instead of waiting
   *  out the backoff, and ping a socket that still LOOKS open so a dead one is replaced within
   *  HEARTBEAT_TIMEOUT_MS rather than at the next 25s heartbeat. Idempotent; no-op after close(). */
  resume(): void {
    if (this.closedByUser) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer); this.reconnectTimer = null;
      this.reconnectAttempts = Math.max(1, this.reconnectAttempts); // so onopen reports a reconnect → the renderer resyncs
      this.openOnce().catch(() => this.scheduleReconnect());
      return;
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.clearHeartbeatTimeout();
      this.send({ type: 'ping' });
      this.heartbeatTimeoutTimer = setTimeout(() => this.forceReconnect(), HEARTBEAT_TIMEOUT_MS);
    }
  }

  private hookLifecycle(): void {
    if (this.lifecycleHooked || typeof window === 'undefined') return;
    this.lifecycleHooked = true;
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this.resume(); });
    window.addEventListener('pageshow', () => this.resume());
    window.addEventListener('online', () => this.resume());
  }

  private openOnce(): Promise<void> {
    return new Promise(async (resolve, reject) => {
      const token = await this.cfg.getToken();
      const url = `${this.cfg.streamUrl}${this.cfg.streamUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
      const ws = new WebSocket(url);
      this.ws = ws;
      let settled = false;

      ws.onopen = () => {
        const wasReconnect = this.reconnectAttempts > 0;
        this.reconnectAttempts = 0;
        this.startHeartbeat();
        this.resendSubscriptions();
        this.emit('state', 'connected');
        if (wasReconnect) this.emit('reconnect', { attempt: 0 });
        if (!settled) { settled = true; resolve(); }
      };
      ws.onmessage = (ev) => {
        try { this.handleFrame(JSON.parse(typeof ev.data === 'string' ? ev.data : '')); }
        catch { this.emit('log', 'failed to parse server frame'); }
      };
      ws.onerror = () => {
        if (!settled) { settled = true; reject(new Error('WebSocket error before open')); }
      };
      ws.onclose = (ev) => {
        this.stopHeartbeat();
        this.ws = null;
        if (!settled) { settled = true; reject(new Error(`WebSocket closed before open (code=${ev.code})`)); }
        if (!this.closedByUser) { this.emit('state', 'reconnecting'); this.scheduleReconnect(); }
      };
    });
  }

  private handleFrame(f: Record<string, unknown>): void {
    switch (f.type) {
      case 'tick':
        this.emit('tick', { accountId: f.accountId, symbol: f.symbol, bid: f.bid, ask: f.ask, timestamp: f.timestamp });
        return;
      case 'position_update':
        this.emit('position', { accountId: f.accountId, event: f.event, position: f.position });
        return;
      case 'order_update':
        this.emit('orders', { accountId: f.accountId, orders: f.orders });
        return;
      case 'account_update':
        this.emit('account', { accountId: f.accountId, snapshot: f.snapshot });
        return;
      case 'subscribed':
        if (Array.isArray(f.rejected) && f.rejected.length > 0) {
          this.emit('log', `subscribe rejected: ${JSON.stringify(f.rejected)}`);
        }
        return;
      case 'error':
        this.emit('log', `stream error: ${String(f.code)} ${String(f.message)}`);
        return;
      case 'pong':
        this.clearHeartbeatTimeout();
        return;
    }
  }

  subscribeTicks(accountId: string, symbols: string[]): void {
    const key = `ticks:${accountId}`;
    const existing = this.subs.get(key);
    if (existing && existing.kind === 'ticks') { for (const s of symbols) existing.symbols.add(s); }
    else this.subs.set(key, { kind: 'ticks', accountId, symbols: new Set(symbols) });
    this.send({ type: 'subscribe', channels: [{ kind: 'ticks', accountId, symbols }] });
  }
  unsubscribeTicks(accountId: string, symbols: string[]): void {
    const key = `ticks:${accountId}`;
    const existing = this.subs.get(key);
    if (existing && existing.kind === 'ticks') {
      for (const s of symbols) existing.symbols.delete(s);
      if (existing.symbols.size === 0) this.subs.delete(key);
    }
    this.send({ type: 'unsubscribe', channels: [{ kind: 'ticks', accountId, symbols }] });
  }
  subscribePositions(accountId: string): void {
    this.subs.set(`positions:${accountId}`, { kind: 'positions', accountId });
    this.send({ type: 'subscribe', channels: [{ kind: 'positions', accountId }] });
  }
  subscribeOrders(accountId: string): void {
    this.subs.set(`orders:${accountId}`, { kind: 'orders', accountId });
    this.send({ type: 'subscribe', channels: [{ kind: 'orders', accountId }] });
  }
  subscribeAccount(accountId: string): void {
    this.subs.set(`account:${accountId}`, { kind: 'account', accountId });
    this.send({ type: 'subscribe', channels: [{ kind: 'account', accountId }] });
  }

  async close(): Promise<void> {
    this.closedByUser = true;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.stopHeartbeat();
    const ws = this.ws;
    this.ws = null;
    if (ws && ws.readyState !== WebSocket.CLOSED) { try { ws.close(); } catch { /* ignore */ } }
  }

  private send(frame: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try { this.ws.send(JSON.stringify(frame)); } catch { /* drop — resubscribe on reconnect */ }
  }

  private resendSubscriptions(): void {
    const channels: unknown[] = [];
    for (const s of this.subs.values()) {
      channels.push(s.kind === 'ticks' ? { kind: 'ticks', accountId: s.accountId, symbols: [...s.symbols] } : { kind: s.kind, accountId: s.accountId });
    }
    if (channels.length > 0) this.send({ type: 'subscribe', channels });
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      this.send({ type: 'ping' });
      this.heartbeatTimeoutTimer = setTimeout(() => this.forceReconnect(), HEARTBEAT_TIMEOUT_MS);
    }, HEARTBEAT_MS);
  }
  private clearHeartbeatTimeout(): void {
    if (this.heartbeatTimeoutTimer) { clearTimeout(this.heartbeatTimeoutTimer); this.heartbeatTimeoutTimer = null; }
  }
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.clearHeartbeatTimeout();
    this.heartbeatTimer = null;
  }
  private forceReconnect(): void {
    if (this.ws) { try { this.ws.close(); } catch { /* ignore */ } }
  }
  private scheduleReconnect(): void {
    if (this.closedByUser || this.reconnectTimer) return;
    const base = BACKOFF_MS[Math.min(this.reconnectAttempts, BACKOFF_MS.length - 1)];
    const jitter = Math.floor(Math.random() * Math.min(base, 1_000));
    this.reconnectAttempts += 1;
    const attempt = this.reconnectAttempts;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.emit('reconnect', { attempt });
      this.openOnce().catch(() => this.scheduleReconnect());
    }, base + jitter);
  }
}
