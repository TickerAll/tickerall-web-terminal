/**
 * The platform contract the renderer talks to through `window.terminal`. Types
 * only — no runtime imports — so the renderer never pulls in backend code.
 *
 * The terminal reaches the TickerAll API (or any injected backend) for market
 * data, streaming and trading. Symbol + timeframe are CHART properties (chosen
 * after connecting, MT5-style), never connection properties.
 */

import type { AppSettings } from './settingsSchema';

// ── Timeframes (MT5 ENUM_TIMEFRAMES ids ↔ labels) ────────────────────────────

export const TIMEFRAMES: { id: number; label: string }[] = [
  { id: 1, label: 'M1' },
  { id: 5, label: 'M5' },
  { id: 15, label: 'M15' },
  { id: 30, label: 'M30' },
  { id: 16385, label: 'H1' },
  { id: 16388, label: 'H4' },
  { id: 16408, label: 'D1' },
  { id: 32769, label: 'W1' },
  { id: 49153, label: 'MN1' },
];

export const TF_LABEL: Record<number, string> = Object.fromEntries(
  TIMEFRAMES.map((t) => [t.id, t.label]),
);

// ── Auth (TickerAll login via TickerAll sign-in) ───────────────────────────────────

export interface AuthUser {
  id: string;
  email: string;
  displayName?: string;
}

/** Whether a TickerAll session is established (a usable apiKey is held). */
export interface AuthState {
  authed: boolean;
  user?: AuthUser;
}

// ── Accounts ─────────────────────────────────────────────────────────────────

/** A broker account on the user's TickerAll roster (from `accounts.list()`). */
export interface BrokerAccount {
  id: string;
  broker: string;        // platform, e.g. 'mt5'
  server: string;        // broker server, e.g. 'FBS-Demo'
  accountNumber: string; // masked, e.g. '****9273' — display only, never typed
  isDemo: boolean;
  /** Registration lifecycle of the roster row — NOT live hotness. */
  status: string;
  /** Live broker-session hotness: true ⇒ queryable now (no password needed);
   *  false ⇒ cold, needs a password-only re-warm. The field to gate on. */
  hot: boolean;
  /** True if we hold this account's password locally (one-click re-warm). */
  remembered?: boolean;
}

/** Live account financials, the subset the Trade panel shows. */
export interface AccountInfo {
  login?: number;
  name?: string;
  currency: string;
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  marginLevel: number | null;
  leverage: number;
}

/** A connected account's full state, returned when a connection is established. */
export interface ConnectResult {
  accountId: string;
  label: string;          // "FBS-Demo · ****9273"
  broker: string;
  isDemo: boolean;
  info: AccountInfo | null;
  symbols: string[];
  watch: string[];        // the default Market Watch subset
  positions: PositionRow[];
}

/** Returned by `connectAccount` when a cold account has no remembered login. */
export interface NeedsPassword { needsPassword: true }

/** Warm a NEW / cold account with broker credentials (server + number known). */
export interface ConnectConfig {
  broker: 'mt4' | 'mt5';
  server: string;
  account: number;
  password: string;
  /** Remember the login locally (encrypted) for one-click re-warm next time. */
  remember?: boolean;
}

// ── Market data ──────────────────────────────────────────────────────────────

/** A candlestick point (time = epoch seconds = lightweight-charts UTCTimestamp). */
export interface ChartBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface OverlayPoint { time: number; value: number }

/** Best bid/ask for a symbol on an account. */
export interface Quote { accountId: string; symbol: string; bid: number; ask: number; time: number }

/** The per-symbol numbers needed for live floating-P&L (the official client's
 *  formula): profit = (deltaPrice / point) × tickValue × volume. */
export interface SymbolSpecLite {
  digits?: number;
  point?: number;
  tickValue?: number;
  contractSize?: number;
  volumeMin?: number;
  volumeStep?: number;
}

// ── Positions / history / orders ─────────────────────────────────────────────

export interface PositionRow {
  ticket: number;
  symbol: string;
  side: 'BUY' | 'SELL';
  volume: number;
  entryPrice: number;
  currentPrice: number;
  profit: number;
  stopLoss: number;
  takeProfit: number;
  swap: number;
  comment: string;
  /** When the position was opened (ISO/epoch string from the broker), if known —
   *  used to place the on-chart open-trade arrow + line at the open time. */
  openTime?: string;
}

export interface HistoryRow {
  ticket: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  volume: number;
  openPrice: number;
  closePrice: number;
  openTime: string;
  closeTime: string;
  profit: number | null;
  // the TickerAll API marks a realised-PARTIAL row (0 < closed < opened) partial:true — the
  // position is STILL OPEN with a remainder, so it must not be treated as closed.
  partial?: boolean;
}

/** A historical ORDER (the History view's Orders tab). SDK >= 0.28.0 includes non-filled
 *  orders — a cancelled/expired/rejected order arrives on the op=0x65 sub=0x20 ORDER stream
 *  (it never produced a deal, so it's absent from the deal-log but present on the wire) — so
 *  `state` is 'filled' | 'canceled' | 'expired' | 'rejected' | 'partial' | 'placed' |
 *  'unknown'. `type` is the side label ('buy'/'sell'); the granular limit/stop order type
 *  isn't on the mobile wire. */
export interface OrderRow {
  ticket: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  type: string;
  volume: number;
  price: number;
  time: string;
  state?: string;
}

/** A historical DEAL / fill (the History view's Deals tab). The deal feed carries NO
 *  P/L — realised profit lives on the round-trip /history (the Positions tab) — so
 *  there is no profit field here. `entry` is the deal direction (IN=open/add,
 *  OUT=close/reduce, INOUT=reversal, OUT_BY=closed-by-opposite); `type` is the display
 *  label ('buy in', 'sell out', …). Real fills only (no balance/credit rows). */
export interface DealRow {
  ticket: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  entry: 'IN' | 'OUT' | 'INOUT' | 'OUT_BY';
  type: string;
  volume: number;
  price: number;
  time: string;
}

/** A resting (unfilled) PENDING order — LIMIT / STOP / STOP_LIMIT (the Trade view's
 *  Orders section). `side` is BUY/SELL; `orderType` is the display label ('buy limit',
 *  'sell stop', …); `price` is the trigger level. MT5 only (MT4 returns none). */
export interface PendingOrderRow {
  ticket: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  orderType: string;
  volume: number;
  price: number;
  stopLoss: number;
  takeProfit: number;
  setTime: string;
}

export interface PlaceOrderReq {
  accountId: string;
  type: 'market' | 'limit' | 'stop';
  symbol: string;
  side: 'BUY' | 'SELL';
  volume: number;
  price?: number;
  stopLoss?: number;
  takeProfit?: number;
  comment?: string;
}

// ── Stream pushes (main → renderer) ──────────────────────────────────────────

export type PositionPushEvent = 'position-opened' | 'position-updated' | 'position-closed';
export interface PositionPush { accountId: string; event: PositionPushEvent; position: PositionRow }
export interface AccountPush { accountId: string; balance: number; group: string }
export interface OrdersPush { accountId: string; orders: PendingOrderRow[] }

// ── Chart trade markers ──────────────────────────────────────────────────────

export interface TradeMarker {
  time: number;
  position: 'aboveBar' | 'belowBar';
  color: string;
  shape: 'arrowUp' | 'arrowDown' | 'circle';
  text: string;
}

export interface EquityPoint { time: number; equity: number; balance: number }

// ── Settings profiles ─────────────────────────────────────────────────────────

/** A named full-settings snapshot as the renderer lists it: its name + whether it is
 *  the profile currently loaded. The snapshot bytes live in the main process; the
 *  renderer only ever sees this summary + applies a load via the settings broadcast. */
export interface ProfileSummary { name: string; active: boolean }

// ── The API the preload exposes on `window.terminal` ─────────────────────────

/** Which host backs this API. Web = a browser host over the TickerAll API (or an
 *  injected backend); capabilities are host-derived (e.g. a deployment sets canTrade:false). */
export type PlatformKind = 'desktop' | 'web';

/** What this host can do — lets the renderer GATE UI instead of letting a method silently
 *  throw. Read SYNC (a static field, see TerminalApi.platform) so gating is render-time. */
export interface Capabilities {
  /** Manual trading (open/close/modify + the New Order UI). A web deployment can disable it
   *  (read-only chart/quotes/positions still work). */
  canTrade: boolean;
  /** A native window-controls overlay to recolour (desktop only). */
  nativeTitlebar: boolean;
}

/** The host discriminator + its capabilities, read once at boot. */
export interface PlatformInfo {
  kind: PlatformKind;
  capabilities: Capabilities;
  /** Optional seed for the INITIAL active account (web only). A partner host that already
   *  warmed a broker account (e.g. an a partner host deployment attaching via the a partner host)
   *  injects its accountId here so the renderer auto-selects + connects it on first load —
   *  no manual pick+connect step. Only used when there's no persisted active
   *  account; the renderer just attempts connectAccount(it) (a HOT account connects with no
   *  password, a cooled one surfaces the reconnect prompt). §29 presence — a blank value is
   *  ignored, never "connect account ''". Absent on desktop and on the unconfigured web host. */
  activeAccountId?: string;
  /** Optional "open this chart on boot" symbol (web only) — a host deep-linking
   *  to a specific chart (e.g. a host 'open chart' row → ?acct=&symbol=&tf=)
   *  injects the broker instrument token here. Applied ONCE the deep-linked account's roster
   *  resolves (same window activeAccountId is honored), and only when the symbol is actually on
   *  that roster. §29 presence — blank ignored. Absent on a normal web boot. */
  activeSymbol?: string;
  /** Optional boot timeframe paired with activeSymbol (web only) — a canonical TF TOKEN
   *  ('M1'|'M5'|'M15'|'M30'|'H1'|'H4'|'D1'|'W1'|'MN1'); the renderer maps token→numeric MT5 enum.
   *  INDEPENDENTLY optional: activeSymbol with no timeframe applies the symbol and keeps the current
   *  tf; an unknown/absent token leaves the tf unchanged. Ignored without a valid activeSymbol. */
  activeTimeframe?: string;
  /** Optional host-injected entries for the MOBILE bottom bar (web only) — see `HostNavItem`.
   *  A partner host that embeds the terminal inside its own mobile app shell (e.g. a partner host's
   *  Studio) injects its own nav entry (a "back to the app" exit action) so the user sees ONE
   *  unified bottom bar instead of the terminal's bar plus a second host bar. Rides
   *  `window.__TICKERALL_WEB__` (the items carry `onSelect` CLOSURES, which cannot travel on a
   *  `data-*` attribute — same reason `getToken` rides the global). Absent → the bar renders
   *  exactly the four built-in tabs, so every current host is byte-unchanged. */
  mobileNavItems?: HostNavItem[];
}

/**
 * One host-injected entry in the mobile bottom bar, rendered alongside the built-in
 * Quotes / Charts / Trade / History tabs.
 *
 * FROZEN HOST CONTRACT (agreed with the web-host + partner owners) — injected entries are
 * ACTIONS, not terminal views: they never take the tab bar's active (`.on`) state, because the
 * thing they select lives OUTSIDE the terminal (a partner host's entry exits the Studio). They tint
 * with `--accent` on the same `currentColor` icon rule as the built-in tabs, so a host that
 * also stamps `data-brand-accent` gets ONE bar in ONE colour.
 *
 * §29 presence: an item missing `id`/`label`/`icon` (or carrying a blank one) is DROPPED rather
 * than rendered as an empty button — see `resolveMobileNavItems`.
 */
export interface HostNavItem {
  /** Stable identity, unique within the injected set (the React key). Blank → dropped. */
  id: string;
  /** The caption under the icon. Blank → dropped. */
  label: string;
  /** The glyph: either an INLINE `<svg …>` string (24×24, `stroke`/`fill="currentColor"` so it
   *  inherits the bar's colour exactly like the built-in icons) or a `data:` image URI. Any
   *  other shape is dropped (the renderer never injects arbitrary host markup). */
  icon: string;
  /** Tapped → the host runs this closure (e.g. exit the embedded Studio). Takes precedence
   *  over `href`. */
  onSelect?: () => void;
  /** Plain-navigation alternative for a host with no closure. IGNORED when `onSelect` is set. */
  href?: string;
  /** Where the entry sits relative to the built-in tabs. Default `'end'`. */
  position?: 'start' | 'end';
}

/** A customer-scoped alert as the TickerAll API stores it (`GET /v1/alerts`). */
export interface ServerAlertRow {
  id: string; accountId: string; symbol: string; op: 'above' | 'below'; price: number;
  enabled: boolean; triggeredAt: string | null;
}
/** A browser PushSubscription's JSON (`subscription.toJSON()`). */
export interface PushSubscriptionJson { endpoint: string; keys: { p256dh: string; auth: string }; userAgent?: string }
export interface ServerAlertsApi {
  /** The VAPID public key, or null when the server has push alerts switched off. */
  vapidPublicKey(): Promise<string | null>;
  list(): Promise<ServerAlertRow[]>;
  create(a: { accountId: string; symbol: string; op: 'above' | 'below'; price: number }): Promise<ServerAlertRow>;
  patch(id: string, p: { enabled?: boolean; rearm?: true }): Promise<ServerAlertRow>;
  remove(id: string): Promise<void>;
  subscribePush(sub: PushSubscriptionJson): Promise<void>;
  unsubscribePush(endpoint: string): Promise<void>;
}

export interface TerminalApi {
  /** Which host backs this API + what it can do — a SYNC static (set at boot), so the
   *  renderer gates UI at render-time (e.g. hide manual-trade UI when !canTrade). */
  platform: PlatformInfo;

  // Auth — gates everything else. Networking happens in the main process.
  authStatus(): Promise<AuthState>;
  loginEmail(email: string, password: string): Promise<AuthState>;
  loginGoogle(): Promise<AuthState>;
  logout(): Promise<void>;
  onAuthChange(cb: (state: AuthState) => void): void;

  // Accounts
  listAccounts(): Promise<BrokerAccount[]>;
  /** accountIds the user had connected last session (auto-reopen on launch). */
  previouslyConnected(): Promise<string[]>;
  /** Establish a connection to a listed account by id — re-warms with the saved
   *  password if we have one. Returns `{ needsPassword: true }` when a cold
   *  account has no saved password (the renderer then prompts for ONLY the
   *  password — never the account number). */
  connectAccount(accountId: string): Promise<ConnectResult | NeedsPassword>;
  /** Re-warm a cold ROSTER account with ONLY its password (the TickerAll API holds the real
   *  number server-side, keyed by accountId — the user never types it). */
  reconnectAccount(accountId: string, password: string, remember: boolean): Promise<ConnectResult>;
  /** Add a NEW account (not on the roster) with full broker credentials. */
  connectWithCreds(cfg: ConnectConfig): Promise<ConnectResult>;
  /** Drop the live connection to an account (keeps it on the roster). */
  disconnectAccount(accountId: string): Promise<void>;
  forgetAccount(accountId: string): Promise<void>;
  /** Permanently remove an account from the roster — works whether it's
   *  connected or cold (idempotent; cools any live session first). The account
   *  can be re-added later with its credentials. */
  removeAccount(accountId: string): Promise<void>;

  // Market data
  candles(accountId: string, symbol: string, timeframe: number, count: number): Promise<ChartBar[]>;
  /** Older bars before `beforeTime` (epoch s) — for chart scroll-back. */
  candlesBefore(accountId: string, symbol: string, timeframe: number, beforeTime: number, count: number): Promise<ChartBar[]>;
  /** Fetch a recent `hours` window (≤168h = fast path) — progressive history. */
  candlesByHours(accountId: string, symbol: string, timeframe: number, hours: number): Promise<ChartBar[]>;
  /** Recent bars fetched fresh from the broker — the chart's history on load. */
  candlesLive(accountId: string, symbol: string, timeframe: number, count: number): Promise<ChartBar[]>;
  /** Abort in-flight scroll/zoom history fetches — called on chart-context change so
   *  rapid navigation doesn't storm the broker with stale deep-history requests. */
  cancelHistory(): Promise<void>;

  // ── Settings (Foundation 1) ──
  settingsGet(): Promise<AppSettings>;
  settingsSet(path: string, value: unknown): Promise<AppSettings>;
  settingsReset(section?: string): Promise<AppSettings>;
  settingsExport(): Promise<string>;
  settingsImport(json: string): Promise<AppSettings>;
  onSettingsChanged(cb: (s: AppSettings) => void): void;
  /** Named full-settings profiles (Item 14). `load` replaces the live settings and
   *  fires `onSettingsChanged`; the rest return the updated profile list. */
  profilesList(): Promise<ProfileSummary[]>;
  profilesSave(name: string): Promise<ProfileSummary[]>;
  profilesLoad(name: string): Promise<AppSettings>;
  profilesDelete(name: string): Promise<ProfileSummary[]>;
  profilesRename(oldName: string, newName: string): Promise<ProfileSummary[]>;
  /** Recolour the native window-controls overlay (titlebar) to match the active theme.
   *  Windows/Linux; a no-op on macOS (system-drawn traffic lights). */
  setTitlebarOverlay(color: string, symbolColor: string): Promise<void>;
  /** Add/remove symbols from an account's live tick subscription. */
  watch(accountId: string, symbols: string[]): Promise<void>;
  unwatch(accountId: string, symbols: string[]): Promise<void>;
  onTick(cb: (q: Quote) => void): void;
  onPosition(cb: (p: PositionPush) => void): void;
  onAccount(cb: (a: AccountPush) => void): void;
  /** Live resting pending orders — the FULL book pushed on subscribe + on every change.
   *  Optional: the web api implements it; a host that can't stream orders omits it and
   *  the renderer falls back to its post-mutation refreshPending (a safe no-op). */
  onOrders?(cb: (o: OrdersPush) => void): void;
  onLog(cb: (m: string) => void): void;
  /** Fires after the streaming connection re-establishes following a drop. Position
   *  pushes are deltas, so a close that arrived while the socket was down is lost →
   *  the position lingers as a phantom "open". The renderer resyncs positions from
   *  REST on this signal. Optional: the web api implements it; a host with its own
   *  reconnect handling (desktop re-warms on stream reconnect) may omit it. */
  onStreamReconnect?(cb: () => void): void;
  /** Live-stream health: 'reconnecting' while the socket is down (not user-closed), 'connected'
   *  once it is back. The mobile UI shows a "Reconnecting…" pill from it. Optional (web api). */
  onStreamState?(cb: (state: 'connected' | 'reconnecting') => void): void;
  /** Server-side price alerts + web push (fire while the app is closed). Web api only; the
   *  the TickerAll API half answers 404 until it is switched on, and vapidPublicKey() then resolves null →
   *  the renderer stays device-local. Desktop omits it. */
  serverAlerts?: ServerAlertsApi;

  // Positions / history / trading
  positions(accountId: string): Promise<PositionRow[]>;
  /** Per-symbol spec for live P&L (point / tickValue / contractSize). */
  symbolSpec(accountId: string, symbol: string): Promise<SymbolSpecLite | null>;
  history(accountId: string, symbol?: string, limit?: number): Promise<HistoryRow[]>;
  /** Historical ORDERS (filled). Optional — desktop + web implement it; the History
   *  view's Orders tab degrades gracefully (an "not available yet" note) when absent. */
  ordersHistory?(accountId: string, symbol?: string, limit?: number): Promise<OrderRow[]>;
  /** Historical DEALS / fills. Optional — web-only for now (no desktop-app deals
   *  method); the Deals tab shows "not available yet" until an impl exists. */
  dealsHistory?(accountId: string, symbol?: string, limit?: number): Promise<DealRow[]>;
  placeOrder(req: PlaceOrderReq): Promise<{ ok: boolean; message: string; ticket?: number }>;
  closePosition(accountId: string, ticket: number, volume?: number): Promise<{ ok: boolean; message: string }>;
  modifyPosition(accountId: string, ticket: number, stopLoss?: number, takeProfit?: number): Promise<{ ok: boolean; message: string }>;
  /** The account's resting PENDING orders (the Trade view's Orders section). Optional —
   *  desktop + web implement it; the section is hidden when absent. */
  listPendingOrders?(accountId: string): Promise<PendingOrderRow[]>;
  /** Modify a resting pending order's trigger price / SL / TP. Any field left undefined
   *  is unchanged. Optional (auto-lights when the impl is present). */
  modifyPendingOrder?(accountId: string, ticket: number, price?: number, stopLoss?: number, takeProfit?: number): Promise<{ ok: boolean; message: string }>;
  /** Cancel (delete) a resting pending order by its ticket. Optional. */
  cancelPendingOrder?(accountId: string, ticket: number): Promise<{ ok: boolean; message: string }>;
}
