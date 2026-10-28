# TickerAll Web Terminal

An MT5-style trading terminal that runs **in the browser** — chart any symbol and
trade live against *any* MT4/MT5 broker through the
[TickerAll API](https://tickerall.com), with no MetaTrader install.

It's a React app. The whole UI (charts, market watch, trade panel, drawing tools,
alerts) is a shared renderer that reaches the outside world only through a single
`window.terminal` platform object. This repo ships the **web** implementation of
that object — talking to a backend over REST + WebSocket, with auth supplied by the
host page. The backend is pluggable: it defaults to the TickerAll API, or you point
it at your own (see **Use with any API**).

> **Status: early.** The web target of the TickerAll terminal, extracted for public
> use. Charts, market data, and live trading run against the hosted TickerAll API
> out of the box.

## Install

```bash
npm install @tickerall/web-terminal
```

The package ships prebuilt assets in `dist/web/` (the bundle + `index.html`). Serve
that folder as static files, or copy `web.js` + `web.mjs` + `chunks/` into your app
and embed them (see **Embedding** below).

## Build from source

```bash
npm install
npm run build      # → dist/web/ (web.js, web.mjs, index.html, chunks/)
npm run typecheck  # tsc --noEmit
```

## Run it

Open `dist/web/index.html` (served over HTTP, not `file://`). Sign in, connect a
**demo** broker account (server / login / password), pick a symbol + timeframe, and
the chart loads real history and streams live ticks. Broker passwords are only ever
sent to the backend to open a session — they are never stored in the browser.

## Embedding

The app reads its config from `window.__TICKERALL_WEB__`, set before `web.js` loads:

```html
<script>
  window.__TICKERALL_WEB__ = {
    // REST + stream default to the public TickerAll API; override for self-hosting.
    baseUrl: 'https://api.tickerall.com',
    // Auth: the host supplies a short-lived session JWT (refreshed host-side).
    getToken: async () => currentSessionJwt,
    user: { id, email, displayName },
    tradingEnabled: true,
  };
</script>
<script src="web.js"></script>
```

Key config fields (all optional):

| field | meaning |
|---|---|
| `baseUrl` / `streamUrl` | TickerAll API REST / WS base (default: the public API) |
| `getToken` | returns a valid short-lived session JWT — the embedded-auth path |
| `authUrl` | sign-in base URL for the standalone email-login path (no host token) |
| `backend` | a custom `TerminalBackend` to run against any API (see below) |
| `tradingEnabled` | `false` = watch-only (hides all buy/sell UI) |
| `activeAccountId` / `activeSymbol` / `activeTimeframe` | boot straight into an account / chart |

If you host the terminal on a different API or a direct sign-in endpoint, widen the
`connect-src` in the generated `dist/web/index.html` CSP (or supply your own CSP on
the embedding page).

## Use with any API

The terminal reaches all broker data, trading, and the live feed through **one
interface** — `TerminalBackend`, defined in [`src/web/backend.ts`](src/web/backend.ts).
Implement it and inject it, and the UI runs against your server unchanged.
Everything the backend returns is in the terminal's own types (`PositionRow`,
`ChartBar`, `Quote`, …), so you map your wire format once, inside the backend —
nothing TickerAll-specific leaks into the rest of the app.

### 1. Implement the backend

Only the core methods are required to make it work; the optional ones light up
extra UI when present and degrade quietly when absent.

```ts
// implements TerminalBackend — see src/web/backend.ts for the exact signatures
export function createMyBackend(opts: { getToken: () => Promise<string> }): TerminalBackend {
  const api = makeClient(opts.getToken);   // your REST/WS client; sends the bearer token

  return {
    // ── Accounts (required) ──
    async listAccounts()        { return (await api.get('/accounts')).map(toBrokerAccount); },
    async connect(id)           { // fetch symbols + opening snapshot; THROW if the account is cold
                                  return toAccountConnection(await api.get(`/accounts/${id}`)); },
    async reconnect(id, pw)     { await api.post(`/accounts/${id}/connect`, { password: pw }); },
    async createSession(creds)  { return (await api.post('/sessions', creds)).accountId; },
    async disconnect(id)        { await api.post(`/accounts/${id}/disconnect`); },
    isNotHot(err)               { return (err as { code?: string })?.code === 'ACCOUNT_OFFLINE'; },

    // ── Market data (required) ──
    async candles(req)          { return (await api.get(candlesUrl(req))).map(toChartBar); },
    async symbolSpec(id, sym)   { return toSymbolSpec(await api.get(`/accounts/${id}/symbols/${sym}`)); },
    async positions(id)         { return (await api.get(`/accounts/${id}/positions`)).map(toPositionRow); },

    // ── Trading (required) — return { ok, message, ticket? } ──
    async placeOrder(req)           { return run(() => api.post(`/accounts/${req.accountId}/orders`, req)); },
    async closePosition(id, t, v)   { return run(() => api.del(`/accounts/${id}/positions/${t}`, { volume: v })); },
    async modifyPosition(id, t, sl, tp) { return run(() => api.patch(`/accounts/${id}/positions/${t}`, { sl, tp })); },

    // ── Live feed (required) ──
    openStream(h) {
      const ws = api.openSocket();
      ws.on('tick',      m => h.onTick({ accountId: m.id, symbol: m.sym, bid: m.bid, ask: m.ask, time: m.t }));
      ws.on('position',  m => h.onPosition(toPositionPush(m)));
      ws.on('orders',    m => h.onOrders({ accountId: m.id, orders: m.orders.map(toPendingRow) }));
      ws.on('account',   m => h.onAccount({ accountId: m.id, balance: m.balance, group: m.group ?? '' }));
      ws.on('reconnect', () => h.onReconnect());          // after a dropped socket re-establishes
      ws.on('state',     s => h.onState(s));              // 'connected' | 'reconnecting'
      return {
        subscribeTicks:     (id, syms) => ws.send({ sub: 'ticks', id, syms }),
        unsubscribeTicks:   (id, syms) => ws.send({ unsub: 'ticks', id, syms }),
        subscribeAccount:   id => ws.send({ sub: 'account', id }),
        subscribePositions: id => ws.send({ sub: 'positions', id }),
        subscribeOrders:    id => ws.send({ sub: 'orders', id }),
        close:              () => ws.close(),
      };
    },

    // ── Optional — add to light up the matching UI ──
    // history, ordersHistory, dealsHistory, listPendingOrders,
    // modifyPendingOrder, cancelPendingOrder, removeAccount, serverAlerts
  };
}
```

A **cold** account must make `connect()` throw an error your own `isNotHot()`
recognizes — the terminal then prompts for the broker password, calls
`reconnect()`, and retries `connect()`. Auth is separate from the backend: the
host supplies the session token via `getToken` (above); the backend just uses it.

[`src/web/tickerallBackend.ts`](src/web/tickerallBackend.ts) is a complete
reference implementation (the default TickerAll backend) to copy from.

### 2. Inject it

```html
<script>
  window.__TICKERALL_WEB__ = {
    getToken: async () => mySessionJwt,                     // your session bearer token
    backend:  createMyBackend({ getToken: () => getToken() }),
  };
</script>
<script src="web.js"></script>
```

**For TickerAll, inject nothing** — omit `backend` and the built-in
`createTickerallBackend` talks to `api.tickerall.com` with your session token, no
hooks required.

## Layout

```
src/renderer/   the shared UI (charts, trade panels, drawing, alerts, themes)
src/web/        the browser platform — window.terminal, the TerminalBackend contract + default
src/shared/     the TerminalApi contract + settings schema
build.mjs       esbuild web build
```

`src/web/backend.ts` is the backend contract; `src/web/tickerallBackend.ts` is the
default implementation; `src/web/webTerminalApi.ts` wires a backend into the
renderer's `window.terminal`.

## License

MIT — see [LICENSE](LICENSE).
