/**
 * WebTerminalApi — the browser implementation of TerminalApi.
 *
 * All broker data/trade/stream goes through an injected `TerminalBackend`
 * (see backend.ts) — so the terminal runs against ANY API. The default backend
 * (createTickerallBackend) targets the TickerAll API, so the hosted service needs
 * no custom hooks. This class owns only the host-neutral glue: localStorage
 * settings/profiles, the boot PlatformInfo, and the stream fan-out + watch-set
 * bookkeeping. Auth (login + the session JWT) is injected separately.
 */

import type {
  TerminalApi, AuthState, BrokerAccount, ConnectResult, NeedsPassword,
  ConnectConfig, ChartBar, Quote, SymbolSpecLite, PositionRow, HistoryRow, OrderRow, DealRow, PendingOrderRow, PlaceOrderReq,
  PositionPush, AccountPush, OrdersPush, ProfileSummary, PlatformInfo, HostNavItem,
  ServerAlertsApi,
} from '../shared/types';
import {
  type AppSettings, DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION, MIGRATIONS, deepMerge, setByPath,
} from '../shared/settingsSchema';
import type { BackendStream, TerminalBackend } from './backend';

/** Auth is host-supplied: the host wires this to its logged-in session — JWT
 *  only, never a stored broker password. */
export interface WebAuthProvider {
  getToken(): string | Promise<string>;
  authStatus(): Promise<AuthState>;
  loginEmail(email: string, password: string): Promise<AuthState>;
  loginGoogle(): Promise<AuthState>;
  logout(): Promise<void>;
  onAuthChange(cb: (state: AuthState) => void): void;
}

export interface WebTerminalApiConfig {
  /** The broker data/trade/stream backend. TickerAll's default is injected by the
   *  web entry when the host provides none (see index.tsx / createTickerallBackend). */
  backend: TerminalBackend;
  /** Login + the session JWT the backend authenticates with. */
  auth: WebAuthProvider;
  /** Manual trading allowed. Default true; false = watch-only (→ capabilities.canTrade:false). */
  tradingEnabled?: boolean;
  /** Seed for the INITIAL active account — a host that already warmed an account
   *  injects its accountId so the renderer auto-selects + connects it on first load. */
  activeAccountId?: string;
  /** Boot the chart on a specific symbol + timeframe. `activeTimeframe` is a canonical TF token. */
  activeSymbol?: string;
  activeTimeframe?: string;
  /** Host-injected extra entries for the MOBILE bottom bar. */
  mobileNavItems?: HostNavItem[];
}

// ── Default watch list (host-neutral) ──
const WATCH_PRIORITY = ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'USDCHF', 'NZDUSD', 'XAUUSD', 'BTCUSD', 'ETHUSD'];
function defaultWatch(symbols: string[]): string[] {
  const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const picked: string[] = [];
  for (const want of WATCH_PRIORITY) {
    const hit = symbols.find((s) => norm(s).startsWith(want));
    if (hit && !picked.includes(hit)) picked.push(hit);
  }
  return picked.length === 0 ? symbols.slice(0, 8) : picked;
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── localStorage-backed settings (reuses the pure settingsSchema logic) ────────
const LS_SETTINGS = 'tickerall.web.settings';
const LS_PROFILES = 'tickerall.web.profiles';   // { active, profiles: name→AppSettings }
const LS_CONNECTED = 'tickerall.web.connectedAccounts';

class WebSettings {
  private data: AppSettings;
  private readonly listeners: Array<(s: AppSettings) => void> = [];
  constructor() { this.data = this.read(); }

  private read(): AppSettings {
    let raw: Record<string, unknown> = {};
    try { const s = localStorage.getItem(LS_SETTINGS); if (s) raw = JSON.parse(s) as Record<string, unknown>; } catch { raw = {}; }
    raw = this.migrate(raw);
    const merged = deepMerge(structuredClone(DEFAULT_SETTINGS), raw);
    merged.schemaVersion = SETTINGS_SCHEMA_VERSION;
    return merged;
  }
  private migrate(raw: Record<string, unknown>): Record<string, unknown> {
    let v = typeof raw.schemaVersion === 'number' ? (raw.schemaVersion as number) : 0;
    while (v < SETTINGS_SCHEMA_VERSION && MIGRATIONS[v]) { raw = MIGRATIONS[v]!(raw); v++; }
    return raw;
  }
  private persist(): void { try { localStorage.setItem(LS_SETTINGS, JSON.stringify(this.data)); } catch { /* quota — keep in-memory */ } }
  private emit(): void { for (const cb of this.listeners) cb(this.data); }

  get(): AppSettings { return this.data; }
  setPath(path: string, value: unknown): AppSettings { setByPath(this.data as unknown as Record<string, unknown>, path, value); this.persist(); this.emit(); return this.data; }
  reset(section?: string): AppSettings {
    if (section && section in DEFAULT_SETTINGS) (this.data as unknown as Record<string, unknown>)[section] = structuredClone((DEFAULT_SETTINGS as unknown as Record<string, unknown>)[section]);
    else this.data = structuredClone(DEFAULT_SETTINGS);
    this.persist(); this.emit(); return this.data;
  }
  exportJSON(): string { return JSON.stringify(this.data, null, 2); }
  importJSON(json: string): AppSettings {
    try { const raw = this.migrate(JSON.parse(json) as Record<string, unknown>); this.data = deepMerge(structuredClone(DEFAULT_SETTINGS), raw); this.data.schemaVersion = SETTINGS_SCHEMA_VERSION; this.persist(); this.emit(); } catch { /* invalid — keep current */ }
    return this.data;
  }
  onChange(cb: (s: AppSettings) => void): void { this.listeners.push(cb); }

  private readProfiles(): { active: string; profiles: Record<string, AppSettings> } {
    try { const s = localStorage.getItem(LS_PROFILES); if (s) return JSON.parse(s) as { active: string; profiles: Record<string, AppSettings> }; } catch { /* fall through */ }
    return { active: '', profiles: {} };
  }
  private writeProfiles(p: { active: string; profiles: Record<string, AppSettings> }): void { try { localStorage.setItem(LS_PROFILES, JSON.stringify(p)); } catch { /* quota */ } }
  private summaries(p: { active: string; profiles: Record<string, AppSettings> }): ProfileSummary[] { return Object.keys(p.profiles).sort().map((name) => ({ name, active: name === p.active })); }
  profilesList(): ProfileSummary[] { return this.summaries(this.readProfiles()); }
  profilesSave(name: string): ProfileSummary[] { const p = this.readProfiles(); p.profiles[name] = structuredClone(this.data); p.active = name; this.writeProfiles(p); return this.summaries(p); }
  profilesLoad(name: string): AppSettings { const p = this.readProfiles(); const snap = p.profiles[name]; if (snap) { this.data = deepMerge(structuredClone(DEFAULT_SETTINGS), snap as unknown as Record<string, unknown>); p.active = name; this.writeProfiles(p); this.persist(); this.emit(); } return this.data; }
  profilesDelete(name: string): ProfileSummary[] { const p = this.readProfiles(); delete p.profiles[name]; if (p.active === name) p.active = ''; this.writeProfiles(p); return this.summaries(p); }
  profilesRename(oldName: string, newName: string): ProfileSummary[] { const p = this.readProfiles(); if (p.profiles[oldName] !== undefined) { p.profiles[newName] = p.profiles[oldName]!; delete p.profiles[oldName]; if (p.active === oldName) p.active = newName; this.writeProfiles(p); } return this.summaries(p); }
}

const EMPTY_ALERTS: ServerAlertsApi = {
  vapidPublicKey: async () => null,
  list: async () => [],
  create: async () => { throw new Error('Server-side alerts are not available in this terminal.'); },
  patch: async () => { throw new Error('Server-side alerts are not available in this terminal.'); },
  remove: async () => { /* no-op */ },
  subscribePush: async () => { /* no-op */ },
  unsubscribePush: async () => { /* no-op */ },
};

/**
 * Build the boot PlatformInfo the renderer reads — the WRITER half of the host↔bundle boot contract.
 * Every boot-intent key the renderer READS off `platform` must be forwarded here from the host's
 * injected config, or it silently never reaches the renderer. Conditional spreads keep an
 * unconfigured host byte-identical. Pure + exported so the forwarding contract is unit-testable.
 */
export function buildWebPlatform(cfg: WebTerminalApiConfig): PlatformInfo {
  return {
    kind: 'web',
    capabilities: {
      canTrade: cfg.tradingEnabled !== false,
      nativeTitlebar: false,
    },
    ...(cfg.activeAccountId ? { activeAccountId: cfg.activeAccountId } : {}),
    ...(cfg.activeSymbol ? { activeSymbol: cfg.activeSymbol } : {}),
    ...(cfg.activeTimeframe ? { activeTimeframe: cfg.activeTimeframe } : {}),
    ...(cfg.mobileNavItems ? { mobileNavItems: cfg.mobileNavItems } : {}),
  };
}

export class WebTerminalApi implements TerminalApi {
  readonly platform: PlatformInfo;
  readonly serverAlerts: ServerAlertsApi;

  private readonly backend: TerminalBackend;
  private readonly settings = new WebSettings();
  private stream: BackendStream | null = null;
  private readonly watchSets = new Map<string, Set<string>>();
  private readonly historyAborts = new Set<AbortController>();
  private readonly tickCbs: Array<(q: Quote) => void> = [];
  private readonly positionCbs: Array<(p: PositionPush) => void> = [];
  private readonly accountCbs: Array<(a: AccountPush) => void> = [];
  private readonly ordersCbs: Array<(o: OrdersPush) => void> = [];
  private readonly logCbs: Array<(m: string) => void> = [];
  private readonly reconnectCbs: Array<() => void> = [];
  private readonly stateCbs: Array<(s: 'connected' | 'reconnecting') => void> = [];

  constructor(private readonly cfg: WebTerminalApiConfig) {
    this.backend = cfg.backend;
    this.serverAlerts = cfg.backend.serverAlerts ?? EMPTY_ALERTS;
    this.platform = buildWebPlatform(cfg);
  }

  // ── Auth (delegated to the host) ──
  authStatus(): Promise<AuthState> { return this.cfg.auth.authStatus(); }
  loginEmail(email: string, password: string): Promise<AuthState> { return this.cfg.auth.loginEmail(email, password); }
  loginGoogle(): Promise<AuthState> { return this.cfg.auth.loginGoogle(); }
  logout(): Promise<void> { return this.cfg.auth.logout(); }
  onAuthChange(cb: (state: AuthState) => void): void { this.cfg.auth.onAuthChange(cb); }

  // ── Accounts ──
  async listAccounts(): Promise<BrokerAccount[]> { return this.backend.listAccounts(); }
  async previouslyConnected(): Promise<string[]> { return this.readConnected(); }
  async connectAccount(accountId: string): Promise<ConnectResult | NeedsPassword> {
    try { return await this.buildConnection(accountId); }
    catch (e) { if (!this.backend.isNotHot(e)) throw e; return { needsPassword: true }; }   // web has no stored password → prompt
  }
  async reconnectAccount(accountId: string, password: string, _remember: boolean): Promise<ConnectResult> {
    await this.backend.reconnect(accountId, password);   // never persist the password in the browser
    return this.buildConnectionWarm(accountId);
  }
  async connectWithCreds(cfg: ConnectConfig): Promise<ConnectResult> {
    const accountId = await this.backend.createSession(cfg);
    return this.buildConnectionWarm(accountId);
  }
  async disconnectAccount(accountId: string): Promise<void> {
    await this.backend.disconnect(accountId);
    const set = this.watchSets.get(accountId);
    if (set && this.stream) this.stream.unsubscribeTicks(accountId, [...set]);
    this.watchSets.delete(accountId);
    this.forgetConnected(accountId);
  }
  async forgetAccount(accountId: string): Promise<void> { this.forgetConnected(accountId); }   // no stored broker password on web
  async removeAccount(accountId: string): Promise<void> {
    if (this.backend.removeAccount) await this.backend.removeAccount(accountId);
    const set = this.watchSets.get(accountId);
    if (set && this.stream) this.stream.unsubscribeTicks(accountId, [...set]);
    this.watchSets.delete(accountId);
    this.forgetConnected(accountId);
  }

  private async buildConnectionWarm(accountId: string): Promise<ConnectResult> {
    let lastErr: unknown;
    for (let i = 0; i < 6; i++) { try { return await this.buildConnection(accountId); } catch (e) { if (!this.backend.isNotHot(e)) throw e; lastErr = e; await delay(700); } }
    throw lastErr;
  }
  private async buildConnection(accountId: string): Promise<ConnectResult> {
    const conn = await this.backend.connect(accountId);   // throws isNotHot if cold
    this.rememberConnected(accountId);
    const watch = defaultWatch(conn.symbols);
    const set = this.watchSets.get(accountId) ?? new Set<string>();
    watch.forEach((s) => set.add(s));
    this.watchSets.set(accountId, set);
    this.ensureStreamFor(accountId, [...set]);
    return {
      accountId,
      label: conn.label,
      broker: conn.broker,
      isDemo: conn.isDemo,
      info: conn.info,
      symbols: conn.symbols,
      watch,
      positions: conn.positions,
    };
  }
  private rememberConnected(accountId: string): void {
    const cur = this.readConnected(); if (!cur.includes(accountId)) { cur.push(accountId); this.writeConnected(cur); }
  }
  private forgetConnected(accountId: string): void { this.writeConnected(this.readConnected().filter((x) => x !== accountId)); }
  private readConnected(): string[] { try { const s = localStorage.getItem(LS_CONNECTED); return s ? (JSON.parse(s) as string[]) : []; } catch { return []; } }
  private writeConnected(ids: string[]): void { try { localStorage.setItem(LS_CONNECTED, JSON.stringify(ids)); } catch { /* quota */ } }

  // ── Market data ──
  async candles(accountId: string, symbol: string, timeframe: number, count: number): Promise<ChartBar[]> { return this.backend.candles({ accountId, symbol, timeframe, count }); }
  async candlesLive(accountId: string, symbol: string, timeframe: number, count: number): Promise<ChartBar[]> { return this.backend.candles({ accountId, symbol, timeframe, count }); }
  async candlesByHours(accountId: string, symbol: string, timeframe: number, hours: number): Promise<ChartBar[]> { return this.backend.candles({ accountId, symbol, timeframe, hours }); }
  async candlesBefore(accountId: string, symbol: string, timeframe: number, beforeTime: number, count: number): Promise<ChartBar[]> {
    const ctrl = new AbortController(); this.historyAborts.add(ctrl);
    try { return await this.backend.candles({ accountId, symbol, timeframe, beforeTime, beforeCount: count, signal: ctrl.signal }); }
    finally { this.historyAborts.delete(ctrl); }
  }
  async cancelHistory(): Promise<void> { for (const c of this.historyAborts) c.abort(); this.historyAborts.clear(); }

  // ── Settings ──
  async settingsGet(): Promise<AppSettings> { return this.settings.get(); }
  async settingsSet(path: string, value: unknown): Promise<AppSettings> { return this.settings.setPath(path, value); }
  async settingsReset(section?: string): Promise<AppSettings> { return this.settings.reset(section); }
  async settingsExport(): Promise<string> { return this.settings.exportJSON(); }
  async settingsImport(json: string): Promise<AppSettings> { return this.settings.importJSON(json); }
  onSettingsChanged(cb: (s: AppSettings) => void): void { this.settings.onChange(cb); }
  async profilesList(): Promise<ProfileSummary[]> { return this.settings.profilesList(); }
  async profilesSave(name: string): Promise<ProfileSummary[]> { return this.settings.profilesSave(name); }
  async profilesLoad(name: string): Promise<AppSettings> { return this.settings.profilesLoad(name); }
  async profilesDelete(name: string): Promise<ProfileSummary[]> { return this.settings.profilesDelete(name); }
  async profilesRename(oldName: string, newName: string): Promise<ProfileSummary[]> { return this.settings.profilesRename(oldName, newName); }
  async setTitlebarOverlay(_color: string, _symbolColor: string): Promise<void> { /* no native titlebar on web */ }

  // ── Stream ──
  async watch(accountId: string, symbols: string[]): Promise<void> {
    const set = this.watchSets.get(accountId); if (!set) return;
    const fresh = symbols.filter((s) => !set.has(s)); fresh.forEach((s) => set.add(s));
    if (fresh.length && this.stream) this.stream.subscribeTicks(accountId, fresh);
  }
  async unwatch(accountId: string, symbols: string[]): Promise<void> {
    const set = this.watchSets.get(accountId); if (!set) return;
    symbols.forEach((s) => set.delete(s));
    if (this.stream) this.stream.unsubscribeTicks(accountId, symbols);
  }
  onTick(cb: (q: Quote) => void): void { this.tickCbs.push(cb); }
  onPosition(cb: (p: PositionPush) => void): void { this.positionCbs.push(cb); }
  onAccount(cb: (a: AccountPush) => void): void { this.accountCbs.push(cb); }
  onOrders(cb: (o: OrdersPush) => void): void { this.ordersCbs.push(cb); }
  onLog(cb: (m: string) => void): void { this.logCbs.push(cb); }
  onStreamReconnect(cb: () => void): void { this.reconnectCbs.push(cb); }
  onStreamState(cb: (s: 'connected' | 'reconnecting') => void): void { this.stateCbs.push(cb); }

  private ensureStreamFor(accountId: string, watch: string[]): void {
    const stream = this.ensureStream();
    stream.subscribeAccount(accountId);
    stream.subscribePositions(accountId);
    stream.subscribeOrders(accountId);
    if (watch.length) stream.subscribeTicks(accountId, watch);
  }
  private ensureStream(): BackendStream {
    if (this.stream) return this.stream;
    this.stream = this.backend.openStream({
      onTick: (q) => this.fire(this.tickCbs, q),
      onPosition: (p) => this.fire(this.positionCbs, p),
      onAccount: (a) => this.fire(this.accountCbs, a),
      onOrders: (o) => this.fire(this.ordersCbs, o),
      onLog: (m) => this.fire(this.logCbs, m),
      onReconnect: () => { for (const cb of this.reconnectCbs) { try { cb(); } catch { /* listener error */ } } },
      onState: (st) => { for (const cb of this.stateCbs) { try { cb(st); } catch { /* listener error */ } } },
    });
    return this.stream;
  }
  private fire<T>(cbs: Array<(arg: T) => void>, arg: T): void { for (const cb of cbs) { try { cb(arg); } catch { /* listener error */ } } }

  // ── Positions / history / trading (delegated) ──
  async positions(accountId: string): Promise<PositionRow[]> { return this.backend.positions(accountId); }
  async symbolSpec(accountId: string, symbol: string): Promise<SymbolSpecLite | null> { return this.backend.symbolSpec(accountId, symbol); }
  async history(accountId: string, symbol?: string, limit = 100): Promise<HistoryRow[]> { return this.backend.history ? this.backend.history(accountId, symbol, limit) : []; }
  async ordersHistory(accountId: string, symbol?: string, limit = 100): Promise<OrderRow[]> { return this.backend.ordersHistory ? this.backend.ordersHistory(accountId, symbol, limit) : []; }
  async dealsHistory(accountId: string, symbol?: string, limit = 100): Promise<DealRow[]> { return this.backend.dealsHistory ? this.backend.dealsHistory(accountId, symbol, limit) : []; }
  async listPendingOrders(accountId: string): Promise<PendingOrderRow[]> { return this.backend.listPendingOrders ? this.backend.listPendingOrders(accountId) : []; }
  async placeOrder(req: PlaceOrderReq): Promise<{ ok: boolean; message: string; ticket?: number }> { return this.backend.placeOrder(req); }
  async closePosition(accountId: string, ticket: number, volume?: number): Promise<{ ok: boolean; message: string }> { return this.backend.closePosition(accountId, ticket, volume); }
  async modifyPosition(accountId: string, ticket: number, stopLoss?: number, takeProfit?: number): Promise<{ ok: boolean; message: string }> { return this.backend.modifyPosition(accountId, ticket, stopLoss, takeProfit); }
  async modifyPendingOrder(accountId: string, ticket: number, price?: number, stopLoss?: number, takeProfit?: number): Promise<{ ok: boolean; message: string }> {
    return this.backend.modifyPendingOrder ? this.backend.modifyPendingOrder(accountId, ticket, price, stopLoss, takeProfit) : { ok: false, message: 'Modifying pending orders is not supported by this backend.' };
  }
  async cancelPendingOrder(accountId: string, ticket: number): Promise<{ ok: boolean; message: string }> {
    return this.backend.cancelPendingOrder ? this.backend.cancelPendingOrder(accountId, ticket) : { ok: false, message: 'Cancelling pending orders is not supported by this backend.' };
  }
}
