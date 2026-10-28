/**
 * createTickerallBackend — the default TerminalBackend: talks to the TickerAll API
 * over REST (fetch) + a native WebSocket stream. This is what the terminal uses
 * when the host injects no custom `backend`, so tickerall.com needs zero hooks.
 *
 * It maps the API's wire shapes into the renderer's types here, so the rest of
 * the terminal — and any alternative backend — never sees them.
 */
import type {
  AccountInfo, BrokerAccount, ChartBar, ConnectConfig, DealRow, HistoryRow, OrderRow,
  PendingOrderRow, PlaceOrderReq, PositionRow, PositionPushEvent, SymbolSpecLite,
  ServerAlertRow, ServerAlertsApi,
} from '../shared/types';
import { ApiError, ApiHttp, ApiStream, type ApiConfig } from './apiClient';
import type {
  AccountConnection, BackendStream, BackendStreamHandlers, CandlesRequest, OpResult, TerminalBackend,
} from './backend';

// ── API wire shapes (the fields this backend consumes) ──
interface ApiAccountListItem { id: string; broker: string; server: string; accountNumber: string; isDemo: boolean; status: string; hot: boolean }
interface ApiSdkPosition { ticket: number; symbol: string; side: 'BUY' | 'SELL'; volume: number; entryPrice?: number; currentPrice?: number; profit?: number; stopLoss?: number; takeProfit?: number; swap?: number; comment?: string; openTime?: string }
interface ApiSdkAccountInfo { login?: number; name?: string; currency?: string; balance: number; equity?: number; margin?: number; freeMargin?: number; marginLevel?: number | null; leverage: number }
interface ApiAccountDetail { status: string; account: ApiSdkAccountInfo | null; positions: ApiSdkPosition[]; server: string; accountNumber: string; broker: string; isDemo: boolean }
interface ApiCandle { timestamp: number; open: number; high: number; low: number; close: number }
interface ApiSymbolSpec { name: string; digits?: number; point?: number; tickValue?: number; tickValueAccount?: number; contractSize?: number; volumeMin?: number; volumeStep?: number }
interface ApiHistoryTrade { ticket: string; symbol: string; side: 'BUY' | 'SELL'; volume: number; openPrice: number; closePrice: number; openTime: string; closeTime: string; profit: number | null; complete?: boolean; partial?: boolean }
interface ApiHistoryOrder { orderTicket: string; symbol: string; side: 'BUY' | 'SELL'; volume: number; price: number; time: string; positionId: string; state: string; dealCount: number }
interface ApiDeal { ticket: string; positionId: string; symbol: string; side: 'BUY' | 'SELL'; entry: 'IN' | 'OUT' | 'INOUT' | 'OUT_BY'; volume: number; price: number; stopLoss: number; takeProfit: number; time: string }
interface ApiPlaceResult { ticket?: number; side?: string; volume?: number; symbol?: string; status?: string }
interface ApiPendingOrder { ticket: string; symbol: string; side: 'BUY' | 'SELL'; orderType: string; volume: number; price: number; stopLoss: number; takeProfit: number; setTime: string }

// ── TF + mappers ──
const TF_TO_LABEL: Record<number, string> = { 1: 'M1', 5: 'M5', 15: 'M15', 30: 'M30', 16385: 'H1', 16388: 'H4', 16408: 'D1', 32769: 'W1', 49153: 'MN1' };
const TF_MINUTES: Record<number, number> = { 1: 1, 5: 5, 15: 15, 30: 30, 16385: 60, 16388: 240, 16408: 1440, 32769: 10080, 49153: 43200 };
const tfLabel = (tf: number): string => TF_TO_LABEL[tf] ?? 'H1';
const tfMinutes = (tf: number): number => TF_MINUTES[tf] ?? 60;
const enc = encodeURIComponent;
const toChartBar = (b: ApiCandle): ChartBar => ({ time: Math.floor(b.timestamp / 60) * 60, open: b.open, high: b.high, low: b.low, close: b.close });

function mapPosition(p: ApiSdkPosition): PositionRow {
  return {
    ticket: p.ticket, symbol: p.symbol, side: p.side, volume: p.volume,
    entryPrice: p.entryPrice ?? 0, currentPrice: p.currentPrice ?? 0, profit: p.profit ?? 0,
    stopLoss: p.stopLoss ?? 0, takeProfit: p.takeProfit ?? 0, swap: p.swap ?? 0,
    comment: p.comment ?? '', openTime: p.openTime,
  };
}
function mapAccountInfo(a: ApiSdkAccountInfo | null): AccountInfo | null {
  if (!a) return null;
  const equity = a.equity ?? a.balance;
  // Never default a missing currency to 'USD' — that silently mislabels a non-USD
  // account. Empty = unknown; display sites omit the label rather than show a wrong one.
  return {
    login: a.login, name: a.name, currency: a.currency ?? '', balance: a.balance, equity,
    margin: a.margin ?? 0, freeMargin: a.freeMargin ?? equity, marginLevel: a.marginLevel ?? null, leverage: a.leverage,
  };
}
function mapHistory(t: ApiHistoryTrade): HistoryRow {
  return { ticket: t.ticket, symbol: t.symbol, side: t.side, volume: t.volume, openPrice: t.openPrice, closePrice: t.closePrice, openTime: t.openTime, closeTime: t.closeTime, profit: t.profit, partial: t.partial === true };
}
function mapOrder(o: ApiHistoryOrder): OrderRow {
  return { ticket: o.orderTicket, symbol: o.symbol, side: o.side, type: o.side === 'BUY' ? 'buy' : 'sell', volume: o.volume, price: o.price, time: o.time, state: o.state ? o.state.toLowerCase() : undefined };
}
const DEAL_ENTRY_LABEL: Record<string, string> = { IN: 'in', OUT: 'out', INOUT: 'reversal', OUT_BY: 'close-by' };
function mapDeal(d: ApiDeal): DealRow {
  return { ticket: d.ticket, symbol: d.symbol, side: d.side, entry: d.entry, type: `${d.side === 'BUY' ? 'buy' : 'sell'} ${DEAL_ENTRY_LABEL[d.entry] ?? 'in'}`, volume: d.volume, price: d.price, time: d.time };
}
function mapPending(o: ApiPendingOrder): PendingOrderRow {
  return { ticket: o.ticket, symbol: o.symbol, side: o.side, orderType: o.orderType, volume: o.volume, price: o.price, stopLoss: o.stopLoss, takeProfit: o.takeProfit, setTime: o.setTime };
}
const POS_EVENT: Record<string, PositionPushEvent> = { opened: 'position-opened', updated: 'position-updated', closed: 'position-closed' };
const tickSeconds = (ts: string): number => {
  const ms = Date.parse(ts);
  if (Number.isFinite(ms)) return ms / 1000;
  const n = Number(ts);
  return Number.isFinite(n) ? (n > 1e12 ? n / 1000 : n) : Date.now() / 1000;
};

export interface TickerallBackendOptions {
  baseUrl: string;
  streamUrl: string;
  getToken: () => string | Promise<string>;
}

class TickerallBackend implements TerminalBackend {
  private readonly http: ApiHttp;
  private readonly apiCfg: ApiConfig;

  constructor(opts: TickerallBackendOptions) {
    this.apiCfg = { baseUrl: opts.baseUrl.replace(/\/$/, ''), streamUrl: opts.streamUrl, getToken: opts.getToken };
    this.http = new ApiHttp(this.apiCfg);
  }

  isNotHot(e: unknown): boolean {
    const code = (e as { code?: string }).code;
    const msg = (e as Error)?.message ?? '';
    return code === 'BROKER_ACCOUNT_NOT_HOT' || /not.*hot|not.*connect/i.test(msg);
  }

  // ── Accounts ──
  async listAccounts(): Promise<BrokerAccount[]> {
    const list = await this.http.request<ApiAccountListItem[]>('GET', '/v1/accounts');
    return list.map((a) => ({ id: a.id, broker: a.broker, server: a.server, accountNumber: a.accountNumber, isDemo: a.isDemo, status: a.status, hot: a.hot, remembered: false }));
  }
  async connect(accountId: string): Promise<AccountConnection> {
    const [symbolsRes, detail] = await Promise.all([
      this.http.request<{ symbols: string[] }>('GET', `/v1/accounts/${enc(accountId)}/symbols`),   // throws NOT_HOT if cold
      this.http.request<ApiAccountDetail>('GET', `/v1/accounts/${enc(accountId)}`).catch(() => null),
    ]);
    const online = detail && detail.status === 'online' ? detail : null;
    return {
      label: detail ? `${detail.server} · ${detail.accountNumber}` : accountId,
      broker: detail?.broker ?? 'mt5',
      isDemo: detail?.isDemo ?? true,
      info: online ? mapAccountInfo(online.account) : null,
      symbols: symbolsRes.symbols,
      positions: online ? online.positions.map(mapPosition) : [],
    };
  }
  async reconnect(accountId: string, password: string): Promise<void> {
    await this.http.request('POST', `/v1/accounts/${enc(accountId)}/reconnect`, { body: { password }, idempotencyKey: this.http.idempotencyKey() });
  }
  async createSession(cfg: ConnectConfig): Promise<string> {
    const session = await this.http.request<{ accountId: string }>('POST', '/v1/sessions', { body: { broker: cfg.broker, server: cfg.server, account: cfg.account, password: cfg.password }, idempotencyKey: this.http.idempotencyKey() });
    return session.accountId;
  }
  async disconnect(accountId: string): Promise<void> {
    await this.http.request('POST', `/v1/accounts/${enc(accountId)}/disconnect`, { idempotencyKey: this.http.idempotencyKey() });
  }
  async removeAccount(accountId: string): Promise<void> {
    await this.http.request('DELETE', `/v1/accounts/${enc(accountId)}`, { idempotencyKey: this.http.idempotencyKey() });
  }

  // ── Market data ──
  private async fetchCandles(accountId: string, symbol: string, hours: number, timeframe: number, signal?: AbortSignal): Promise<ApiCandle[]> {
    const q = new URLSearchParams({ symbol, hours: String(hours), timeframe: tfLabel(timeframe) });
    return (await this.http.request<{ candles: ApiCandle[] }>('GET', `/v1/accounts/${enc(accountId)}/candles?${q.toString()}`, { signal })).candles;
  }
  async candles(req: CandlesRequest): Promise<ChartBar[]> {
    const { accountId, symbol, timeframe } = req;
    if (req.beforeTime != null) {
      const count = req.beforeCount ?? 0;
      const tfSec = tfMinutes(timeframe) * 60;
      const reach = Math.ceil((Date.now() / 1000 - req.beforeTime) / 3600 + (count * tfSec) / 3600) + 1;
      const hours = Math.min(Math.max(reach, 169), 26280);   // force the deep history walk (>168h)
      const raw = await this.fetchCandles(accountId, symbol, hours, timeframe, req.signal);
      return raw.map(toChartBar).filter((b) => b.time < req.beforeTime!).slice(-count);
    }
    if (req.hours != null) {
      return (await this.fetchCandles(accountId, symbol, req.hours, timeframe, req.signal)).map(toChartBar);
    }
    // by count: the candles endpoint takes hours, so convert, over-fetch ~3×, sort, slice.
    const count = req.count ?? 0;
    const hours = Math.max(72, Math.floor((count * tfMinutes(timeframe)) / 60 * 3) + 1);
    const raw = await this.fetchCandles(accountId, symbol, hours, timeframe, req.signal);
    raw.sort((a, b) => a.timestamp - b.timestamp);
    const sliced = count >= raw.length ? raw : raw.slice(raw.length - count);
    return sliced.map(toChartBar);
  }
  async symbolSpec(accountId: string, symbol: string): Promise<SymbolSpecLite | null> {
    const res = await this.http.request<{ spec: ApiSymbolSpec }>('GET', `/v1/accounts/${enc(accountId)}/symbols/${enc(symbol)}/spec`).catch(() => null);
    const s = res?.spec;
    // Live P&L must be in the account's DEPOSIT currency; prefer tickValueAccount.
    return s ? { digits: s.digits, point: s.point, tickValue: s.tickValueAccount ?? s.tickValue, contractSize: s.contractSize, volumeMin: s.volumeMin, volumeStep: s.volumeStep } : null;
  }

  // ── Positions / history ──
  async positions(accountId: string): Promise<PositionRow[]> {
    const detail = await this.http.request<ApiAccountDetail>('GET', `/v1/accounts/${enc(accountId)}`);
    return detail.status === 'online' ? detail.positions.map(mapPosition) : [];
  }
  async history(accountId: string, symbol?: string, limit = 100): Promise<HistoryRow[]> {
    const q = new URLSearchParams(); if (symbol) q.set('symbol', symbol); q.set('limit', String(limit));
    const res = await this.http.request<{ trades: ApiHistoryTrade[] }>('GET', `/v1/accounts/${enc(accountId)}/history?${q.toString()}`);
    // Closed-trade history only — drop the still-open side (complete:false).
    return res.trades.filter((t) => t.complete !== false).map(mapHistory);
  }
  async ordersHistory(accountId: string, symbol?: string, limit = 100): Promise<OrderRow[]> {
    const q = new URLSearchParams(); if (symbol) q.set('symbol', symbol); q.set('limit', String(limit));
    const res = await this.http.request<{ orders: ApiHistoryOrder[] }>('GET', `/v1/accounts/${enc(accountId)}/orders-history?${q.toString()}`);
    return res.orders.map(mapOrder);
  }
  async dealsHistory(accountId: string, symbol?: string, limit = 100): Promise<DealRow[]> {
    const q = new URLSearchParams(); if (symbol) q.set('symbol', symbol); q.set('limit', String(limit));
    const res = await this.http.request<{ deals: ApiDeal[] }>('GET', `/v1/accounts/${enc(accountId)}/deals-history?${q.toString()}`);
    return res.deals.map(mapDeal);
  }
  async listPendingOrders(accountId: string): Promise<PendingOrderRow[]> {
    const res = await this.http.request<{ orders: ApiPendingOrder[] }>('GET', `/v1/accounts/${enc(accountId)}/orders/pending`);
    return res.orders.map(mapPending);
  }

  // ── Trading ──
  async placeOrder(req: PlaceOrderReq): Promise<OpResult> {
    try {
      const r = await this.http.request<ApiPlaceResult>('POST', `/v1/accounts/${enc(req.accountId)}/orders`, {
        body: { type: req.type, symbol: req.symbol, side: req.side, volume: req.volume, price: req.price, stopLoss: req.stopLoss, takeProfit: req.takeProfit, comment: req.comment },
        idempotencyKey: this.http.idempotencyKey(),
      });
      return { ok: true, message: `#${r.ticket} ${r.side} ${r.volume} ${r.symbol} ${r.status}`, ticket: r.ticket };
    } catch (e) { return { ok: false, message: (e as Error).message }; }
  }
  async closePosition(accountId: string, ticket: number, volume?: number): Promise<OpResult> {
    try {
      await this.http.request('DELETE', `/v1/accounts/${enc(accountId)}/positions/${ticket}`, { body: volume !== undefined ? { volume } : {}, idempotencyKey: this.http.idempotencyKey() });
      return { ok: true, message: `Closed #${ticket}` };
    } catch (e) { return { ok: false, message: (e as Error).message }; }
  }
  async modifyPosition(accountId: string, ticket: number, stopLoss?: number, takeProfit?: number): Promise<OpResult> {
    try {
      await this.http.request('PATCH', `/v1/accounts/${enc(accountId)}/positions/${ticket}`, { body: { stopLoss, takeProfit }, idempotencyKey: this.http.idempotencyKey() });
      return { ok: true, message: `Modified #${ticket}` };
    } catch (e) { return { ok: false, message: (e as Error).message }; }
  }
  async modifyPendingOrder(accountId: string, ticket: number, price?: number, stopLoss?: number, takeProfit?: number): Promise<OpResult> {
    try {
      await this.http.request('PATCH', `/v1/accounts/${enc(accountId)}/orders/${ticket}`, { body: { price, stopLoss, takeProfit }, idempotencyKey: this.http.idempotencyKey() });
      return { ok: true, message: `Modified order #${ticket}` };
    } catch (e) { return { ok: false, message: (e as Error).message }; }
  }
  async cancelPendingOrder(accountId: string, ticket: number): Promise<OpResult> {
    try {
      await this.http.request('DELETE', `/v1/accounts/${enc(accountId)}/orders/${ticket}`, { body: {}, idempotencyKey: this.http.idempotencyKey() });
      return { ok: true, message: `Cancelled order #${ticket}` };
    } catch (e) { return { ok: false, message: (e as Error).message }; }
  }

  // ── Server alerts + web push (dark until enabled server-side → vapid 404 → null) ──
  readonly serverAlerts: ServerAlertsApi = {
    vapidPublicKey: async () => {
      try { return (await this.http.request<{ publicKey: string }>('GET', '/v1/push/vapid-public-key')).publicKey || null; }
      catch (e) { if (e instanceof ApiError && e.status === 404) return null; throw e; }
    },
    list: async () => (await this.http.request<{ alerts: ServerAlertRow[] }>('GET', '/v1/alerts')).alerts,
    create: (a) => this.http.request<ServerAlertRow>('POST', '/v1/alerts', { body: a }),
    patch: (id, p) => this.http.request<ServerAlertRow>('PATCH', `/v1/alerts/${enc(id)}`, { body: p }),
    remove: (id) => this.http.request<void>('DELETE', `/v1/alerts/${enc(id)}`, { expectNoContent: true }),
    subscribePush: async (sub) => { await this.http.request('POST', '/v1/push/subscriptions', { body: sub }); },
    unsubscribePush: (endpoint) => this.http.request<void>('DELETE', '/v1/push/subscriptions', { body: { endpoint }, expectNoContent: true }),
  };

  // ── Stream ──
  openStream(h: BackendStreamHandlers): BackendStream {
    const s = new ApiStream(this.apiCfg);
    s.on('tick', (t: { accountId: string; symbol: string; bid: number; ask: number; timestamp: string }) =>
      h.onTick({ accountId: t.accountId, symbol: t.symbol, bid: t.bid, ask: t.ask, time: tickSeconds(t.timestamp) }));
    s.on('position', (p: { accountId: string; event: string; position: ApiSdkPosition }) =>
      h.onPosition({ accountId: p.accountId, event: POS_EVENT[p.event] ?? 'position-updated', position: mapPosition(p.position) }));
    s.on('orders', (o: { accountId: string; orders: ApiPendingOrder[] }) =>
      h.onOrders({ accountId: o.accountId, orders: o.orders.map(mapPending) }));
    s.on('account', (a: { accountId: string; snapshot: { balance: number; group?: string } }) =>
      h.onAccount({ accountId: a.accountId, balance: a.snapshot.balance, group: a.snapshot.group ?? '' }));
    s.on('log', (m: string) => h.onLog(m));
    s.on('reconnect', () => h.onReconnect());
    s.on('state', (st: 'connected' | 'reconnecting') => h.onState(st));
    // Connect lazily; ApiStream buffers subscriptions and resends them on open, and
    // self-schedules reconnect on failure, so callers may subscribe immediately.
    void s.connect().catch(() => { /* reconnect is scheduled internally */ });
    return {
      subscribeTicks: (id, syms) => s.subscribeTicks(id, syms),
      unsubscribeTicks: (id, syms) => s.unsubscribeTicks(id, syms),
      subscribeAccount: (id) => s.subscribeAccount(id),
      subscribePositions: (id) => s.subscribePositions(id),
      subscribeOrders: (id) => s.subscribeOrders(id),
      close: () => s.close(),
    };
  }
}

export function createTickerallBackend(opts: TickerallBackendOptions): TerminalBackend {
  return new TickerallBackend(opts);
}
