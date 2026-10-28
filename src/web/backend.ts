/**
 * TerminalBackend — the data/trade/stream surface the terminal needs from a
 * server. Implement this to run the terminal against ANY API; TickerAll ships a
 * default (createTickerallBackend) so the hosted API needs no custom hooks.
 *
 * Everything the backend returns is in the renderer's own types (PositionRow,
 * ChartBar, …) — a host maps its wire format to these and never has to match
 * TickerAll's endpoints or frame protocol.
 *
 * Only the non-optional methods are required to "just work" (accounts, candles,
 * a live stream, place/close/modify). Optional methods light up extra UI when
 * present and degrade gracefully when absent (the renderer feature-detects them).
 */
import type {
  AccountInfo, BrokerAccount, ChartBar, ConnectConfig, DealRow, HistoryRow, OrderRow,
  PendingOrderRow, PlaceOrderReq, PositionRow, Quote, SymbolSpecLite,
  PositionPush, AccountPush, OrdersPush, ServerAlertsApi,
} from '../shared/types';

/** A connected account's opening snapshot (what the renderer shows on connect). */
export interface AccountConnection {
  label: string;
  broker: string;
  isDemo: boolean;
  info: AccountInfo | null;
  symbols: string[];
  positions: PositionRow[];
}

/** One candle request. Exactly one of {count} / {hours} / {beforeTime+beforeCount}
 *  is set by the caller. Return bars oldest→newest. */
export interface CandlesRequest {
  accountId: string;
  symbol: string;
  timeframe: number;      // MT5 TF code (1,5,15,30,16385,…)
  count?: number;         // most-recent N bars
  hours?: number;         // last N hours
  beforeTime?: number;    // bars strictly older than this epoch-seconds time…
  beforeCount?: number;   // …how many of them
  signal?: AbortSignal;
}

export interface OpResult { ok: boolean; message: string; ticket?: number }

/** Callbacks the backend fires as live frames arrive (already in renderer types). */
export interface BackendStreamHandlers {
  onTick(q: Quote): void;
  onPosition(p: PositionPush): void;
  onAccount(a: AccountPush): void;
  onOrders(o: OrdersPush): void;
  onLog(message: string): void;
  onReconnect(): void;
  onState(state: 'connected' | 'reconnecting'): void;
}

/** A live connection. The terminal (un)subscribes per account; the backend pushes
 *  via the handlers given to openStream(). */
export interface BackendStream {
  subscribeTicks(accountId: string, symbols: string[]): void;
  unsubscribeTicks(accountId: string, symbols: string[]): void;
  subscribeAccount(accountId: string): void;
  subscribePositions(accountId: string): void;
  subscribeOrders(accountId: string): void;
  close(): Promise<void>;
}

export interface TerminalBackend {
  // ── Accounts ──
  listAccounts(): Promise<BrokerAccount[]>;
  /** Attach to a warm account and return its opening snapshot (symbols, info,
   *  open positions, a display label). Throw an error this backend's own
   *  isNotHot() recognizes if the account is cold → the terminal prompts for the
   *  broker password, calls reconnect(), then connect() again. */
  connect(accountId: string): Promise<AccountConnection>;
  /** Warm a cold account with its broker password (never persisted by the terminal). */
  reconnect(accountId: string, password: string): Promise<void>;
  /** Open a brand-new broker session from credentials → the new accountId. */
  createSession(cfg: ConnectConfig): Promise<string>;
  /** Cool the live session (keep the account listed). */
  disconnect(accountId: string): Promise<void>;
  /** True if an error means "account is not currently connected/warm". */
  isNotHot(err: unknown): boolean;

  // ── Market data ──
  candles(req: CandlesRequest): Promise<ChartBar[]>;
  symbolSpec(accountId: string, symbol: string): Promise<SymbolSpecLite | null>;

  // ── Positions ──
  positions(accountId: string): Promise<PositionRow[]>;

  // ── Trading ──
  placeOrder(req: PlaceOrderReq): Promise<OpResult>;
  closePosition(accountId: string, ticket: number, volume?: number): Promise<OpResult>;
  modifyPosition(accountId: string, ticket: number, stopLoss?: number, takeProfit?: number): Promise<OpResult>;

  // ── Live stream ──
  openStream(handlers: BackendStreamHandlers): BackendStream;

  // ── Optional — present them to light up the matching UI ──
  removeAccount?(accountId: string): Promise<void>;
  history?(accountId: string, symbol?: string, limit?: number): Promise<HistoryRow[]>;
  ordersHistory?(accountId: string, symbol?: string, limit?: number): Promise<OrderRow[]>;
  dealsHistory?(accountId: string, symbol?: string, limit?: number): Promise<DealRow[]>;
  listPendingOrders?(accountId: string): Promise<PendingOrderRow[]>;
  modifyPendingOrder?(accountId: string, ticket: number, price?: number, stopLoss?: number, takeProfit?: number): Promise<OpResult>;
  cancelPendingOrder?(accountId: string, ticket: number): Promise<OpResult>;
  /** Server-side alerts + web-push, if the backend offers them. */
  serverAlerts?: ServerAlertsApi;
}
