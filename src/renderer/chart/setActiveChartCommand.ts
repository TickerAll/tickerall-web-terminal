/**
 * Pure decision for the host "switch the active chart" runtime command (a host
 * strip click → window CustomEvent 'tickerall:set-active-chart'). The Terminal listener gathers
 * the live context (active account, per-account rosters) and APPLIES whatever this returns, so the
 * validation is unit-testable without a render harness.
 *
 * Guarantees (promised to the host):
 *  - malformed detail (missing/non-string symbol or timeframe) → null (no-op).
 *  - blank symbol → null.
 *  - the symbol MUST be on the target account's roster → else null (never chart a symbol the
 *    account can't stream).
 *  - detail.accountId (optional; omitted in v1) routes to that account when it's connected; absent
 *    → the current active account. No active/target account → null.
 *  - timeframe is a TF TOKEN ('M5'); an unknown/absent token maps to null → the caller switches the
 *    symbol/account but leaves the current timeframe (never a bogus tf).
 */
export interface SetActiveChartDetail {
  symbol?: unknown;
  timeframe?: unknown;
  accountId?: unknown;
}

export interface ChartCmdCtx {
  activeId: string | null;
  /** connected account id → the symbols on that account. */
  rosters: Record<string, string[]>;
  /** map a TF token ('M5') → numeric MT5 enum, or null when unmapped/absent. */
  tokenToTimeframe: (token: string) => number | null;
}

export interface SetActiveChartResult {
  accountId: string;
  symbol: string;
  /** null when the token was unknown/absent → keep the current timeframe. */
  tf: number | null;
}

export interface BootChartResult {
  symbol: string;
  /** null when the token is unknown/absent → apply the symbol, keep the current timeframe. */
  tf: number | null;
}

/**
 * Boot-time active-chart resolution from the /studio deep-link (platform.activeSymbol +
 * activeTimeframe). Unlike the runtime command, the timeframe is INDEPENDENTLY optional — a
 * symbol-only boot applies the symbol and keeps the current tf. Symbol absent/blank OR not on the
 * account's roster → null (never chart a symbol the account can't stream). Applied ONCE when the
 * roster resolves, so it replaces the host's retry-until-roster poll.
 */
export function resolveBootChart(
  symbol: string | undefined,
  timeframeToken: string | undefined,
  roster: string[],
  tokenToTimeframe: (token: string) => number | null,
): BootChartResult | null {
  const s = symbol?.trim();
  if (!s || !roster.includes(s)) return null;
  return { symbol: s, tf: timeframeToken ? tokenToTimeframe(timeframeToken) : null };
}

export function resolveSetActiveChart(detail: SetActiveChartDetail, ctx: ChartCmdCtx): SetActiveChartResult | null {
  if (!detail || typeof detail.symbol !== 'string' || typeof detail.timeframe !== 'string') return null;
  const symbol = detail.symbol.trim();
  if (!symbol) return null;

  const wantAcct = typeof detail.accountId === 'string' && detail.accountId.trim() ? detail.accountId.trim() : null;
  const target = wantAcct && ctx.rosters[wantAcct] ? wantAcct : ctx.activeId;
  if (!target) return null;                                  // no active/target account → nothing to switch

  const roster = ctx.rosters[target];
  if (!roster || !roster.includes(symbol)) return null;      // symbol not on that account's roster → no-op

  return { accountId: target, symbol, tf: ctx.tokenToTimeframe(detail.timeframe) };
}
