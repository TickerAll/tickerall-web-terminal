/** MT5-faithful LIVE account financials.
 *
 *  The broker's WS account-update push carries only BALANCE (and margin changes only when a
 *  position opens/closes), so a connect-time equity / free-margin / margin-level snapshot goes
 *  STALE — `info.equity` would freeze while floating P&L moves. The terminal must recompute the
 *  three derived figures every tick from balance + the live floating P&L, exactly as the MT5
 *  client does:
 *      equity      = balance + Σ floating P&L
 *      freeMargin  = equity − margin
 *      marginLevel = margin > 0 ? equity / margin × 100 : null      (null = no margin in use)
 *
 *  `balance` null/undefined (the account snapshot hasn't decoded yet) → all three null. A balance
 *  of 0 is a VALID funded-but-empty / blown account (§29), so it is NOT treated as "absent":
 *  equity = 0 + floating, not null. Single source of truth for Toolbox (desktop) + MobileTrade +
 *  MobileAccountView so the formula can never drift between surfaces. */
export function liveFinancials(
  balance: number | null | undefined,
  margin: number,
  floating: number,
): { equity: number | null; freeMargin: number | null; marginLevel: number | null } {
  const equity = balance != null ? balance + floating : null;
  const freeMargin = equity != null ? equity - margin : null;
  const marginLevel = equity != null && margin > 0 ? (equity / margin) * 100 : null;
  return { equity, freeMargin, marginLevel };
}
