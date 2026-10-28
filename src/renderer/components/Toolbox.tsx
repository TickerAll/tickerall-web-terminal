import { useMemo, useState } from 'react';
import type { ConnAcct } from '../types';
import type { HistoryRow, OrderRow, DealRow, PositionRow, PendingOrderRow } from '../../shared/types';
import { fmtMoney, fmtPrice, fmtTradeTime, orderStateLabel } from '../format';
import { AlertsPanel } from '../alerts/AlertsPanel';
import { type Period, PERIODS, parseT, periodRange } from './historyFilter';
import { liveFinancials } from './accountMath';

export type ToolboxTab = 'trade' | 'history' | 'journal' | 'alerts';

/** Toolbox — MT5's bottom panel: Trade (account + open positions), History,
 *  Journal, and Alerts. */
export function Toolbox({
  tab, setTab, acct, history, journal, onClose,
  orders = [], ordersAvailable = false, deals = [], dealsAvailable = false, period, onPeriodChange,
  pending = [], pendingAvailable = false, onModifyPosition, onModifyPending, onCancelPending,
  accounts, activeId, activeSymbol, canTrade = true,
}: {
  tab: ToolboxTab;
  setTab: (t: ToolboxTab) => void;
  acct: ConnAcct | null;
  history: HistoryRow[];
  /** Historical ORDERS + DEALS for the History view's Orders / Deals sub-tabs. Optional —
   *  the sub-tab shows an honest "not available" note when the impl doesn't serve them. */
  orders?: OrderRow[];
  ordersAvailable?: boolean;
  deals?: DealRow[];
  dealsAvailable?: boolean;
  /** The History time-range filter — the SAME 7 presets as mobile (lifted to the shell so
   *  mobile and desktop share the selection); filtering is client-side over loaded rows. */
  period: Period;
  onPeriodChange: (p: Period) => void;
  journal: string[];
  onClose: (ticket: number) => void;
  /** Resting pending orders (the Orders section) + their actions. Optional — the
   *  section is hidden when the impl doesn't serve them. */
  pending?: PendingOrderRow[];
  pendingAvailable?: boolean;
  onModifyPosition?: (p: PositionRow) => void;
  onModifyPending?: (o: PendingOrderRow) => void;
  onCancelPending?: (ticket: string) => void;
  /** Connected accounts + active chart context — drive the Alerts tab's pickers. */
  accounts: ConnAcct[];
  activeId: string | null;
  activeSymbol: string | null;
  /** When false (a trade-disabled deployment), the position/pending rows render READ-ONLY —
   *  no close / modify / cancel affordances. The tables themselves still show. */
  canTrade?: boolean;
}) {
  const info = acct?.info ?? null;
  const positions = acct?.positions ?? [];
  const floating = positions.reduce((s, p) => s + p.profit, 0);
  // Equity/free-margin/margin-level are LIVE-derived (the WS account-update carries only balance,
  // so info.equity/freeMargin/marginLevel freeze at connect time). Recompute per tick (§MT5).
  const live = liveFinancials(info?.balance, info?.margin ?? 0, floating);

  // History → Positions / Orders / Deals sub-tab + the time-range filter. Filtering is
  // client-side over the loaded rows, identical to mobile (deps on `period`, not the live
  // range — the [from,to) window is recomputed inside, matching MobileHistory).
  const [histTab, setHistTab] = useState<'positions' | 'orders' | 'deals'>('positions');
  const histRows = useMemo(() => {
    const [from, to] = periodRange(period);
    return history.filter((r) => { const t = parseT(r.closeTime || r.openTime); return t >= from && t < to; });
  }, [history, period]);
  const ordRows = useMemo(() => {
    const [from, to] = periodRange(period);
    return orders.filter((o) => { const t = parseT(o.time); return t >= from && t < to; });
  }, [orders, period]);
  const dealRows = useMemo(() => {
    const [from, to] = periodRange(period);
    return deals.filter((d) => { const t = parseT(d.time); return t >= from && t < to; });
  }, [deals, period]);
  const histProfit = histRows.reduce((s, r) => s + (r.profit ?? 0), 0);

  return (
    <div className="toolbox">
      <div className="tb-tabs">
        {(['trade', 'history', 'journal', 'alerts'] as const).map((t) => (
          <button key={t} className={`tb-tab ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>
            {t === 'trade' ? 'Trade' : t === 'history' ? 'History' : t === 'journal' ? 'Journal' : 'Alerts'}
          </button>
        ))}
      </div>

      <div className="tb-body">
        {tab === 'trade' && (
          <>
            <div className="tb-acct">
              {info ? (
                <>
                  <Stat k="Balance" v={`${fmtMoney(info.balance)}${info.currency ? ' ' + info.currency : ''}`} />
                  <Stat k="Equity" v={fmtMoney(live.equity ?? undefined)} />
                  <Stat k="Margin" v={fmtMoney(info.margin)} />
                  <Stat k="Free margin" v={fmtMoney(live.freeMargin ?? undefined)} />
                  <Stat k="Margin level" v={live.marginLevel === null ? '—' : `${live.marginLevel.toFixed(1)}%`} />
                  <Stat k="Floating P/L" v={fmtMoney(floating)} cls={floating >= 0 ? 'up' : 'down'} />
                </>
              ) : <span className="muted tiny">Connect an account to see its balance.</span>}
            </div>
            <table className="tb-table tb-positions">
              <thead><tr><th>Symbol</th><th>Open time</th><th>Side</th><th className="num">Volume</th><th className="num">Open</th><th className="num">Current</th><th className="num">S/L</th><th className="num">T/P</th><th className="num">Profit</th><th /></tr></thead>
              <tbody>
                {positions.map((p) => (
                  <tr key={p.ticket}>
                    <td className="sym">{p.symbol}</td>
                    <td className="tiny">{fmtTradeTime(p.openTime)}</td>
                    <td className={p.side === 'BUY' ? 'up' : 'down'}>{p.side === 'BUY' ? 'buy' : 'sell'}</td>
                    <td className="num">{p.volume}</td>
                    <td className="num">{fmtPrice(p.entryPrice)}</td>
                    <td className="num">{fmtPrice(p.currentPrice)}</td>
                    <td className="num">{p.stopLoss ? fmtPrice(p.stopLoss) : '—'}</td>
                    <td className="num">{p.takeProfit ? fmtPrice(p.takeProfit) : '—'}</td>
                    <td className={`num ${p.profit >= 0 ? 'up' : 'down'}`}>{fmtMoney(p.profit)}</td>
                    <td className="x tb-rowacts">
                      {canTrade && onModifyPosition && <button className="rm" title="Modify S/L · T/P" onClick={() => onModifyPosition(p)}>✎</button>}
                      {canTrade && <button className="rm" title="Close position" onClick={() => onClose(p.ticket)}>×</button>}
                    </td>
                  </tr>
                ))}
                {positions.length === 0 && <tr><td colSpan={10} className="muted tiny" style={{ padding: '10px 8px' }}>No open positions.</td></tr>}
              </tbody>
            </table>

            {pendingAvailable && pending.length > 0 && (
              <table className="tb-table tb-pending">
                <thead><tr><th colSpan={7} className="tb-subhead">Pending orders</th></tr>
                  <tr><th>Symbol</th><th>Type</th><th className="num">Volume</th><th className="num">Price</th><th className="num">S/L</th><th className="num">T/P</th><th /></tr></thead>
                <tbody>
                  {pending.map((o) => (
                    <tr key={o.ticket}>
                      <td className="sym">{o.symbol}</td>
                      <td className={o.side === 'BUY' ? 'up' : 'down'}>{o.orderType}</td>
                      <td className="num">{o.volume}</td>
                      <td className="num">{fmtPrice(o.price)}</td>
                      <td className="num">{o.stopLoss ? fmtPrice(o.stopLoss) : '—'}</td>
                      <td className="num">{o.takeProfit ? fmtPrice(o.takeProfit) : '—'}</td>
                      <td className="x tb-rowacts">
                        {canTrade && onModifyPending && <button className="rm" title="Modify price · S/L · T/P" onClick={() => onModifyPending(o)}>✎</button>}
                        {canTrade && onCancelPending && <button className="rm" title="Cancel order" onClick={() => onCancelPending(o.ticket)}>×</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}

        {tab === 'history' && (
          <div className="tb-hist">
            {/* Positions / Orders / Deals sub-tabs (left) + the time-range filter (right),
                mirroring the mobile History view. */}
            <div className="tb-hist-bar">
              <div className="tb-hist-tabs">
                {(['positions', 'orders', 'deals'] as const).map((t) => (
                  <button key={t} className={histTab === t ? 'on' : ''} onClick={() => setHistTab(t)}>
                    {t === 'positions' ? 'Positions' : t === 'orders' ? 'Orders' : 'Deals'}
                  </button>
                ))}
              </div>
              <div className="tb-hist-right">
                {histTab === 'positions' && histRows.length > 0 && (
                  <span className="tb-hist-total">Profit: <b className={histProfit >= 0 ? 'up' : 'down'}>{fmtMoney(histProfit)}</b></span>
                )}
                <select className="tb-period" value={period} onChange={(e) => onPeriodChange(e.target.value as Period)}>
                  {PERIODS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </div>
            </div>

            {histTab === 'positions' && (
              <table className="tb-table">
                <thead><tr><th>Symbol</th><th>Side</th><th className="num">Volume</th><th className="num">Open</th><th className="num">Close</th><th>Close time</th><th className="num">Profit</th></tr></thead>
                <tbody>
                  {histRows.map((h) => (
                    <tr key={h.ticket}>
                      <td className="sym">{h.symbol}</td>
                      <td className={h.side === 'BUY' ? 'up' : 'down'}>{h.side === 'BUY' ? 'buy' : 'sell'}</td>
                      <td className="num">{h.volume}</td>
                      <td className="num">{fmtPrice(h.openPrice)}</td>
                      <td className="num">{fmtPrice(h.closePrice)}</td>
                      <td className="tiny">{fmtTradeTime(h.closeTime)}</td>
                      <td className={`num ${(h.profit ?? 0) >= 0 ? 'up' : 'down'}`}>{h.profit === null ? '—' : fmtMoney(h.profit)}</td>
                    </tr>
                  ))}
                  {histRows.length === 0 && <tr><td colSpan={7} className="muted tiny" style={{ padding: '10px 8px' }}>No closed trades for this period.</td></tr>}
                </tbody>
              </table>
            )}

            {histTab === 'orders' && (
              !ordersAvailable ? (
                <div className="tb-hist-empty muted tiny">Order history isn’t available on this account yet.</div>
              ) : (
                <table className="tb-table">
                  <thead><tr><th>Symbol</th><th>Type</th><th className="num">Volume</th><th className="num">Price</th><th>State</th><th>Time</th></tr></thead>
                  <tbody>
                    {ordRows.map((o) => (
                      <tr key={o.ticket}>
                        <td className="sym">{o.symbol}</td>
                        <td className={o.side === 'BUY' ? 'up' : 'down'}>{o.type}</td>
                        <td className="num">{o.volume}</td>
                        <td className="num">{fmtPrice(o.price)}</td>
                        <td className="tiny">{orderStateLabel(o.state)}</td>
                        <td className="tiny">{fmtTradeTime(o.time)}</td>
                      </tr>
                    ))}
                    {ordRows.length === 0 && <tr><td colSpan={6} className="muted tiny" style={{ padding: '10px 8px' }}>No orders for this period.</td></tr>}
                  </tbody>
                </table>
              )
            )}

            {histTab === 'deals' && (
              !dealsAvailable ? (
                <div className="tb-hist-empty muted tiny">Deal history isn’t available on this account yet.</div>
              ) : (
                <table className="tb-table">
                  <thead><tr><th>Symbol</th><th>Type</th><th className="num">Volume</th><th className="num">Price</th><th>Time</th></tr></thead>
                  <tbody>
                    {dealRows.map((d) => (
                      <tr key={d.ticket}>
                        <td className="sym">{d.symbol}</td>
                        <td className={d.side === 'BUY' ? 'up' : 'down'}>{d.type}</td>
                        <td className="num">{d.volume}</td>
                        <td className="num">{fmtPrice(d.price)}</td>
                        <td className="tiny">{fmtTradeTime(d.time)}</td>
                      </tr>
                    ))}
                    {dealRows.length === 0 && <tr><td colSpan={5} className="muted tiny" style={{ padding: '10px 8px' }}>No deals for this period.</td></tr>}
                  </tbody>
                </table>
              )
            )}
          </div>
        )}

        {tab === 'journal' && <div className="journal">{journal.length ? journal.join('\n') : 'No activity yet.'}</div>}

        {tab === 'alerts' && (
          <AlertsPanel accounts={accounts} defaultAccountId={activeId} defaultSymbol={activeSymbol} />
        )}
      </div>
    </div>
  );
}

function Stat({ k, v, cls }: { k: string; v: string; cls?: string }) {
  return <div className="stat"><span className="stat-k">{k}</span><span className={`stat-v ${cls ?? ''}`}>{v}</span></div>;
}
