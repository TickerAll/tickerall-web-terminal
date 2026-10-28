/**
 * Which markers a trade draws on the chart — the SINGLE source both the open-position and
 * closed-trade draw branches derive from, so they can't diverge on what an ENTRY looks like.
 *
 * INVARIANT (the pinned marker spec): an ENTRY — an open position, OR a closed trade's opening leg —
 * is an arrow in the side's direction WITH a side tag (BUY ▲ labelled / SELL ▼ labelled). A CLOSING
 * leg is the OPPOSITE-direction arrow with NO tag. The `entry` op therefore CARRIES its `tag`
 * structurally: you cannot describe an entry without its label. This is the 3rd open/close marker
 * regression — the open branch kept drawing an entry as an unlabelled arrow (like a close) because
 * nothing forced the two branches to agree. Now they both iterate this.
 */

export type MarkerOp =
  | { role: 'entry'; arrow: 'up' | 'down'; tag: 'BUY' | 'SELL' } // entry: arrow + LABELLED (always)
  | { role: 'exit'; arrow: 'up' | 'down' };                      // closing leg: arrow, NO label

export function tradeMarkerOps(trade: { side: 'BUY' | 'SELL'; open: boolean }): MarkerOp[] {
  const entryUp: 'up' | 'down' = trade.side === 'BUY' ? 'up' : 'down';
  const exitUp: 'up' | 'down' = trade.side === 'BUY' ? 'down' : 'up'; // opposite of the entry
  const ops: MarkerOp[] = [{ role: 'entry', arrow: entryUp, tag: trade.side }];
  if (!trade.open) ops.push({ role: 'exit', arrow: exitUp });
  return ops;
}
