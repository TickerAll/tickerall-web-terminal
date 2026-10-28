/** MT5-style mobile TRADE view (≤600px): the account-summary band (dotted leaders,
 *  Balance/Equity/Margin/Free margin/Margin Level) over the open-positions list and the
 *  resting Orders list. On a position row: tap charts the symbol, ✕ closes, swipe LEFT
 *  reveals ✎ Modify, and a LONG-PRESS opens an action menu (Modify / Chart / Close). */
import { useState } from 'react';
import type { AccountInfo, PositionRow, PendingOrderRow } from '../../shared/types';
import { money, px, pnl } from './mobileFmt';
import { MobilePositionRow } from './MobilePositionRow';
import { liveFinancials } from './accountMath';

export function MobileTrade({
  account, positions, pending = [], pendingAvailable = false,
  onSelect, onClose, onModify, onModifyPending, onCancelPending, canTrade = true,
}: {
  account: AccountInfo | null;
  positions: PositionRow[];
  pending?: PendingOrderRow[];
  pendingAvailable?: boolean;
  onSelect: (symbol: string) => void;
  onClose: (ticket: number) => void;
  onModify?: (p: PositionRow) => void;
  onModifyPending?: (o: PendingOrderRow) => void;
  onCancelPending?: (ticket: string) => void;
  /** When false, positions/orders render READ-ONLY (no close / modify / cancel affordances). */
  canTrade?: boolean;
}) {
  const [menuFor, setMenuFor] = useState<PositionRow | null>(null); // long-press action menu target
  // Equity/free-margin/margin-level are LIVE-derived from balance + Σ floating P&L — the WS
  // account-update carries only balance, so account.equity freezes at connect time (§MT5).
  const floating = positions.reduce((s, p) => s + p.profit, 0);
  const live = liveFinancials(account?.balance, account?.margin ?? 0, floating);
  const summary: [string, string][] = [
    ['Balance', account ? money(account.balance) : '—'],
    ['Equity', live.equity != null ? money(live.equity) : '—'],
    ['Margin', account ? money(account.margin) : '—'],
    ['Free margin', live.freeMargin != null ? money(live.freeMargin) : '—'],
    ['Margin Level (%)', live.marginLevel != null ? money(live.marginLevel) : '—'],
  ];
  return (
    <div className="m-trade">
      <div className="m-acct">
        {summary.map(([k, v]) => (
          <div className="m-acct-row" key={k}>
            <span className="m-acct-k">{k}:</span>
            <span className="m-acct-led" aria-hidden="true" />
            <span className="m-acct-v">{v}</span>
          </div>
        ))}
      </div>
      <div className="m-sec">Positions</div>
      {positions.length === 0 ? (
        <div className="m-empty">No open positions.</div>
      ) : positions.map((p) => (
        <MobilePositionRow
          key={p.ticket}
          onTap={() => onSelect(p.symbol)}
          onModify={() => onModify?.(p)}
          onClose={() => onClose(p.ticket)}
          onMenu={() => setMenuFor(p)}
          canTrade={canTrade}
        >
          <div className="m-row-main">
            <div className="m-row-top"><b>{p.symbol},</b>{' '}
              <span className={p.side === 'BUY' ? 'm-buy' : 'm-sell'}>{p.side === 'BUY' ? 'buy' : 'sell'} {p.volume}</span>
            </div>
            <div className="m-row-sub">{px(p.entryPrice)} → {px(p.currentPrice)}</div>
          </div>
          <div className={`m-row-pnl ${p.profit >= 0 ? 'm-up' : 'm-down'}`}>{pnl(p.profit)}</div>
        </MobilePositionRow>
      ))}

      {pendingAvailable && pending.length > 0 && (
        <>
          <div className="m-sec">Orders</div>
          {pending.map((o) => (
            <div className="m-row m-pos" key={o.ticket} onClick={() => onSelect(o.symbol)}>
              <div className="m-row-main">
                <div className="m-row-top"><b>{o.symbol},</b>{' '}
                  <span className={o.side === 'BUY' ? 'm-buy' : 'm-sell'}>{o.orderType} {o.volume}</span>
                </div>
                <div className="m-row-sub">at {px(o.price)}{o.stopLoss ? ` · SL ${px(o.stopLoss)}` : ''}{o.takeProfit ? ` · TP ${px(o.takeProfit)}` : ''}</div>
              </div>
              {canTrade && onModifyPending && <button className="m-row-x" aria-label="Modify order" onClick={(e) => { e.stopPropagation(); onModifyPending(o); }}>✎</button>}
              {canTrade && onCancelPending && <button className="m-row-x" aria-label="Cancel order" onClick={(e) => { e.stopPropagation(); onCancelPending(o.ticket); }}>✕</button>}
            </div>
          ))}
        </>
      )}

      {/* Long-press action menu (Item 7) — same actions as the swipe (Item 5), just a more
          discoverable affordance. */}
      {menuFor && (
        <div className="m-actions-back" onClick={() => setMenuFor(null)}>
          <div className="m-actions" onClick={(e) => e.stopPropagation()}>
            <div className="m-actions-h">
              <b>{menuFor.symbol}</b>{' '}
              <span className={menuFor.side === 'BUY' ? 'm-buy' : 'm-sell'}>{menuFor.side === 'BUY' ? 'buy' : 'sell'} {menuFor.volume}</span>
            </div>
            {canTrade && onModify && <button className="m-actions-item" onClick={() => { const p = menuFor; setMenuFor(null); onModify(p); }}>✎ Modify S/L · T/P</button>}
            <button className="m-actions-item" onClick={() => { const p = menuFor; setMenuFor(null); onSelect(p.symbol); }}>📈 View on chart</button>
            {canTrade && <button className="m-actions-item m-actions-danger" onClick={() => { const p = menuFor; setMenuFor(null); onClose(p.ticket); }}>✕ Close position</button>}
            <button className="m-actions-cancel" onClick={() => setMenuFor(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
