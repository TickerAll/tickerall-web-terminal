/**
 * StatusBar — the pinned bottom footer (Layout cluster, area C). A slim, theme-aware
 * strip that surfaces the live session at a glance, MT5/TradingView-style:
 *
 *   connection state · active symbol+TF · bid / spread · server clock · balance /
 *   equity / floating P&L · (optional) active-tool hint.
 *
 * The candle countdown now lives INSIDE the chart, anchored on the right price axis
 * below the last-price label (TradingView/MT5 style — see `CandleCountdown`). The
 * footer keeps the server clock; both share the bar-phase maths in `../chart/countdown`.
 *
 * Self-contained + broker-decoupled: it reads ONLY props the shell passes (the
 * connection summary, the active quote, the account + floating P&L, an optional tool
 * hint). The single piece of internal state is a 1-second ticker that drives the
 * server clock — everything else re-renders only when its prop changes. No per-tick
 * work, no broker imports.
 *
 * Server-clock math — the broker bar PHASE (same bucketing as the forming bar):
 *   serverNow = localNow + offset    (offset = broker − local, frozen at the last tick)
 * serverNow is the broker clock, learned ONCE from the freshest tick's timestamp
 * (offset captured at arrival, then HELD) so it keeps advancing with the 1 Hz local
 * clock during tick silence — ticks are bursty, the clock must not freeze between
 * them. With no tick yet the offset is 0 → serverNow falls back to local UTC.
 */

import { useEffect, useRef, useState } from 'react';
import type { AccountInfo } from '../../shared/types';
import { TF_LABEL } from '../../shared/types';
import { computeBarPhase } from '../chart/countdown';
import { fmtPrice, fmtMoney } from '../format';

/** A live quote the footer reads (mirrors the renderer QuoteVal — bid/ask/time). */
export interface StatusQuote { bid: number; ask: number; time: number }

/** The connection state the footer renders — derived by the shell from the
 *  connected map + connecting set + the active account. */
export interface ConnectionSummary {
  /** warm = active account live; connecting = a connect is in flight; offline = nothing live. */
  state: 'warm' | 'connecting' | 'offline';
  /** How many accounts are mid-connect (shown as "connecting N…"). */
  connecting: number;
  /** A short label for the active connection (e.g. "FBS-Demo") — display only. */
  label?: string;
}

interface Props {
  /** The active chart symbol, or null when none is charted. */
  activeSymbol: string | null;
  /** The active chart timeframe (MT5 ENUM_TIMEFRAMES id). */
  timeframe: number;
  /** The active symbol's latest quote (bid/ask/time) — undefined until a tick lands. */
  quote?: StatusQuote;
  /** The active account's financials (balance/equity), or null when none is active. */
  account: AccountInfo | null;
  /** Floating P&L for the active account (sum of open-position profit) — recomputed
   *  per tick upstream and passed down so the footer does no per-tick work. */
  floatingPnl: number;
  /** Live connection state for the active account. */
  connection: ConnectionSummary;
  /** Optional active-drawing-tool hint (e.g. "Trendline — click two points"). */
  toolHint?: string | null;
}

/** HH:MM:SS of a broker-server epoch-second, in UTC (broker server time is the bar
 *  grid; rendering it in UTC keeps it phase-consistent with the in-chart countdown). */
export function fmtClock(epochSec: number): string {
  return new Date(epochSec * 1000).toISOString().slice(11, 19);
}

/**
 * The pure clock maths the footer renders — a thin pass-through to `computeBarPhase`
 * (the shared bar-phase maths in `../chart/countdown`) so the footer clock and the
 * in-chart countdown stay in lockstep. Returns the broker `serverNow` plus the
 * bar-phase fields (kept on the return for back-compat with any caller).
 *
 *   serverNow = localNow + offsetSec   (offset frozen at tick arrival, so the clock
 *                                       keeps advancing during tick silence — ticks
 *                                       are bursty/like rain, the clock must NOT freeze)
 *
 * `offsetSec = 0` (no tick learned yet) makes serverNow == local UTC — a safe fallback.
 */
export function computeClock(localNowSec: number, offsetSec: number, timeframe: number): {
  serverNow: number; remain: number; tfSec: number; barEnd: number;
} {
  return computeBarPhase(localNowSec, offsetSec, timeframe);
}

export function StatusBar({
  activeSymbol, timeframe, quote, account, floatingPnl, connection, toolHint,
}: Props) {
  // The ONE internal timer: a 1 Hz tick that re-renders the clock + countdown. Cleared
  // on unmount. Everything else is prop-driven (so it can't churn per market tick).
  const [, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Learn the broker clock offset (broker − local) ONCE per tick, captured at the
  // moment that tick's time changes — then HOLD it. Recomputing it every render against
  // the current local clock would pin serverNow to the last tick (it'd freeze between
  // ticks, and ticks are bursty/silent for many seconds — §"ticks are like rain"). So
  // the offset is frozen and serverNow advances with the 1 Hz local clock between ticks.
  const offsetRef = useRef(0);
  const lastTickRef = useRef<number | null>(null);
  const tickTime = quote && Number.isFinite(quote.time) ? quote.time : null;
  if (tickTime !== null && tickTime !== lastTickRef.current) {
    lastTickRef.current = tickTime;
    offsetRef.current = tickTime - Date.now() / 1000; // freeze the broker offset at arrival
  }

  // Server clock — the broker bar phase, bucketed identically to the forming bar. The
  // maths lives in computeBarPhase (via computeClock) so the footer clock, the in-chart
  // countdown, and the test all share it. (The countdown itself now renders in-chart.)
  const { serverNow } = computeClock(Date.now() / 1000, offsetRef.current, timeframe);

  const hasQuote = quote !== undefined && Number.isFinite(quote.bid);
  // Spread in points-ish raw price units; 0 / flat must render (never a falsy blank).
  const spread = hasQuote ? quote!.ask - quote!.bid : null;

  // User-facing connection text. The internal state id stays 'warm' (and the sb-warm CSS
  // class), but we never SHOW the word "warm" — display the friendly "Live" instead.
  const connText =
    connection.state === 'warm' ? (connection.label ? `Live · ${connection.label}` : 'Live')
    : connection.state === 'connecting' ? `connecting ${connection.connecting || 1}…`
    : 'offline';

  return (
    <footer className="statusbar" role="contentinfo">
      {/* Connection state — colour-coded dot + label. */}
      <span className={`sb-conn sb-${connection.state}`} title={`Connection: ${connText}`}>
        <span className="sb-dot" />
        {connText}
      </span>

      <span className="sb-sep" />

      {/* Active symbol + timeframe. */}
      <span className="sb-sym">
        {activeSymbol ? <><b>{activeSymbol}</b>{' '}<span className="sb-tf">{TF_LABEL[timeframe] ?? timeframe}</span></> : <span className="sb-dim">no symbol</span>}
      </span>

      <span className="sb-sep" />

      {/* Latest bid + spread for the active symbol. */}
      <span className="sb-quote" title="Bid · spread">
        <span className="sb-k">bid</span>
        <span className="sb-v">{hasQuote ? fmtPrice(quote!.bid) : '—'}</span>
        <span className="sb-k">spr</span>
        <span className="sb-v">{spread !== null ? spread.toFixed(spread >= 1 ? 2 : 5) : '—'}</span>
      </span>

      <span className="sb-sep" />

      {/* Server clock (broker time, UTC). The candle countdown now renders in-chart,
          anchored below the last-price label (see CandleCountdown). */}
      <span className="sb-clock" title="Broker server time (UTC)">{fmtClock(serverNow)}</span>

      {/* Pushed to the right: account financials + floating P&L (+ optional tool hint). */}
      <span className="sb-spacer" />

      {toolHint && <><span className="sb-tool" title="Active tool">✎ {toolHint}</span><span className="sb-sep" /></>}

      {account ? (
        <span className="sb-acct">
          <span className="sb-k">bal</span>
          <span className="sb-v">{fmtMoney(account.balance)}</span>
          <span className="sb-k">eq</span>
          <span className="sb-v">{fmtMoney(account.equity)}</span>
          <span className="sb-k">P/L</span>
          <span className={`sb-v sb-pl ${floatingPnl >= 0 ? 'sb-up' : 'sb-down'}`}>{fmtMoney(floatingPnl)}</span>
          {account.currency && <span className="sb-ccy">{account.currency}</span>}
        </span>
      ) : (
        <span className="sb-dim">not connected</span>
      )}
    </footer>
  );
}
