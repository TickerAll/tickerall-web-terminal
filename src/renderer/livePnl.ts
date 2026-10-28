/**
 * Live position P&L recompute — the official client recomputes floating P&L per tick (the broker
 * doesn't push it per tick). Two independent updates, and keeping them independent is the whole
 * point: `currentPrice` is just the side's close price (bid for a long, ask for a short) and needs
 * NO symbol spec, so it MUST update on every tick regardless; `profit` needs the spec's
 * point/tickValue (or contractSize) and only recomputes when that's available, otherwise the
 * broker's last value is kept. Coupling currentPrice to the spec froze the whole positions row
 * whenever the spec was missing/slow (the studio "positions don't update on tick" bug).
 *
 * Returns the SAME reference when nothing changed, so a React list keyed on the position can skip
 * the row (and the caller can tell whether anything moved).
 */

/** The spec fields the P&L formula reads (a subset of SymbolSpecLite; all optional). */
export interface PnlSpec {
  tickValue?: number | null;
  point?: number | null;
  contractSize?: number | null;
}

/** The position fields this recompute reads/writes (structural — any richer position satisfies it). */
export interface LivePos {
  side: 'BUY' | 'SELL';
  entryPrice: number;
  volume: number;
  profit: number;
  currentPrice?: number;
}

export function recomputePositionPnl<T extends LivePos>(
  p: T,
  bid: number,
  ask: number,
  factor?: number | null,
): T {
  const close = p.side === 'BUY' ? bid : ask;
  // profit is recomputed per-tick ONLY via `factor` — the account-currency value of a 1.0 price
  // move per 1.0 lot, derived from the broker/the TickerAll API's own deposit-currency profit (see
  // deriveAccountPnlFactor). Correct for ANY deposit currency, no cross-rate needed. When there
  // is no factor yet, we KEEP the last value (the TickerAll API already serves the deposit currency) — we do
  // NOT recompute from the symbol spec's profit-currency tickValue/contractSize, which rendered a
  // THB account's P&L as the USD figure (~34× too small). Currency-correct-but-static beats
  // smooth-but-wrong; the factor bootstraps from the TickerAll API's next profit and per-tick smoothness resumes.
  let profit = p.profit;
  if (factor != null && Number.isFinite(factor)) {
    const delta = p.side === 'BUY' ? bid - p.entryPrice : p.entryPrice - ask;
    profit = delta * p.volume * factor;
  }
  // currentPrice always tracks the tick; only allocate a new object when something actually moved.
  if (close === p.currentPrice && profit === p.profit) return p;
  return { ...p, profit, currentPrice: close };
}

/**
 * Recover the ACCOUNT-currency P&L factor — the deposit-currency value of a 1.0 price move per
 * 1.0 lot — from a broker-pushed position. The broker's `profit` is authoritative and already in
 * the deposit currency, and corresponds to `currentPrice`; since floating P&L is linear in the
 * price delta, `profit / (delta × volume)` recovers exactly the conversion the broker applied
 * (contract size × profit→deposit cross-rate), with NO symbol spec and NO cross-rate lookup.
 *
 * Returns null when it can't be derived cleanly — the position hasn't moved (delta ≈ 0), zero
 * volume, or a non-finite / wrong-signed result — in which case the caller keeps the previous
 * factor (or the broker's own value). Re-derived on every push, so it self-corrects and any
 * inter-push drift snaps back the moment the broker pushes again.
 */
export function deriveAccountPnlFactor(p: {
  side: 'BUY' | 'SELL';
  entryPrice: number;
  currentPrice: number;
  volume: number;
  profit: number;
}): number | null {
  const delta = p.side === 'BUY' ? p.currentPrice - p.entryPrice : p.entryPrice - p.currentPrice;
  const denom = delta * p.volume;
  if (!Number.isFinite(denom) || Math.abs(denom) < 1e-9) return null;
  const k = p.profit / denom;
  return Number.isFinite(k) && k > 0 ? k : null;
}
