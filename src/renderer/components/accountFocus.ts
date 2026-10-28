import type { ChartTab } from './ChartTabs';

/** Choose which of an account's chart tabs to activate when switching TO that account.
 *
 *  Per-account workspace memory (#19): switching to account B must restore B's OWN
 *  last-active chart, not carry the symbol you were just looking at on account A into B,
 *  and not reset to B's first tab. Priority:
 *    1. B's own last-active symbol (`lastSym`, persisted per account in ta.acctWs),
 *    2. else a B tab matching the symbol you're leaving (`currentSym`) — a mild
 *       convenience for a never-visited account that happens to hold that symbol,
 *    3. else B's first tab.
 *  Returns null only when B has no tabs yet (the bootstrap effect then opens its first).
 *
 *  Kept pure (no React) so the per-account restore is unit-testable in isolation. */
export function pickAccountTab(
  accTabs: ChartTab[],
  lastSym: string | null | undefined,
  currentSym: string | null | undefined,
): ChartTab | null {
  if (accTabs.length === 0) return null;
  return (lastSym ? accTabs.find((t) => t.symbol === lastSym) : undefined)
      ?? (currentSym ? accTabs.find((t) => t.symbol === currentSym) : undefined)
      ?? accTabs[0]!;
}

/** Reflect a symbol/TF change on the ACTIVE chart into its own tab — WITHOUT ever reassigning
 *  a tab to a different account.
 *
 *  A tab's `accountId` is its IDENTITY (which broker-account the chart belongs to); only its
 *  symbol/TF change when you retune that chart. Guarding on `t.accountId === activeId` is the
 *  load-bearing fix for the desktop "per-account charts forgotten" bug: when you switch to an
 *  account that has no tabs yet, `activeTabId` briefly still points at the OUTGOING account's
 *  active tab — and the old mirror logic reassigned THAT tab's accountId to the incoming
 *  account, silently STEALING the chart away from the account that owned it. So switching back
 *  found the chart gone. With the guard, a foreign-account tab is never touched; the bootstrap
 *  effect opens a fresh tab for the tab-less incoming account instead.
 *
 *  Returns the SAME array reference when nothing changed, so setTabs bails out (no re-render /
 *  no workspace-persist churn). Pure (no React) so it's unit-testable in isolation. */
export function mirrorActiveTab(
  tabs: ChartTab[],
  activeTabId: string | null,
  activeId: string | null,
  activeSymbol: string | null,
  timeframe: number,
): ChartTab[] {
  if (!activeTabId || !activeId || !activeSymbol) return tabs;
  let changed = false;
  const next = tabs.map((t) => {
    if (t.id === activeTabId && t.accountId === activeId && !(t.symbol === activeSymbol && t.timeframe === timeframe)) {
      changed = true;
      return { ...t, symbol: activeSymbol, timeframe };
    }
    return t;
  });
  return changed ? next : tabs;
}
