/** MT5-style mobile HISTORY view (≤600px): a period filter (Today / Last week / … ),
 *  POSITIONS / ORDERS / DEALS sub-tabs, a dotted-leader summary
 *  (Profit / Deposit / Swap / Commission / Balance) and the closed-trade rows
 *  (SYMBOL, dir vol / open → close / time + coloured P&L). Period filtering is applied
 *  client-side over the loaded rows. We only carry closed-position rows, so Profit and
 *  Balance are computed and the swap/commission/deposit lines read "—" (not faked). */
import { useMemo, useState } from 'react';
import type { HistoryRow, OrderRow, DealRow } from '../../shared/types';
import { px, pnl } from './mobileFmt';
import { orderStateLabel } from '../format';
import { type Period, parseT, periodRange } from './historyFilter';

export function MobileHistory({ rows, period, orders = [], ordersAvailable = false, deals = [], dealsAvailable = false }: {
  rows: HistoryRow[];
  /** The active period — controlled by the History header's dropdown (lifted to the shell). */
  period: Period;
  orders?: OrderRow[];
  ordersAvailable?: boolean;
  deals?: DealRow[];
  dealsAvailable?: boolean;
}) {
  const [tab, setTab] = useState<'positions' | 'orders' | 'deals'>('positions');

  const filtered = useMemo(() => {
    const [from, to] = periodRange(period);
    return rows.filter((r) => { const t = parseT(r.closeTime || r.openTime); return t >= from && t < to; });
  }, [rows, period]);
  const filteredOrders = useMemo(() => {
    const [from, to] = periodRange(period);
    return orders.filter((o) => { const t = parseT(o.time); return t >= from && t < to; });
  }, [orders, period]);
  const filteredDeals = useMemo(() => {
    const [from, to] = periodRange(period);
    return deals.filter((d) => { const t = parseT(d.time); return t >= from && t < to; });
  }, [deals, period]);
  const profit = filtered.reduce((s, r) => s + (r.profit ?? 0), 0);

  const summary: [string, string, boolean][] = [
    ['Profit', pnl(profit), true],
    ['Deposit', '—', false],
    ['Swap', '—', false],
    ['Commission', '—', false],
    ['Balance', pnl(profit), true],
  ];

  return (
    <div className="m-hist">
      <div className="m-hist-tabs">
        {(['positions', 'orders', 'deals'] as const).map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {t === 'positions' ? 'POSITIONS' : t === 'orders' ? 'ORDERS' : 'DEALS'}
          </button>
        ))}
      </div>

      <div className="m-acct m-hist-sum">
        {summary.map(([k, v, colour]) => (
          <div className="m-acct-row" key={k}>
            <span className="m-acct-k">{k}:</span>
            <span className="m-acct-led" aria-hidden="true" />
            <span className={`m-acct-v ${colour ? (profit >= 0 ? 'm-up' : 'm-down') : ''}`}>{v}</span>
          </div>
        ))}
      </div>

      {tab === 'positions' ? (
        filtered.length === 0 ? (
          <div className="m-empty">No history for this period.</div>
        ) : filtered.map((r) => (
          <div className="m-row m-deal" key={r.ticket}>
            <div className="m-row-main">
              <div className="m-row-top"><b>{r.symbol},</b>{' '}
                <span className={r.side === 'BUY' ? 'm-buy' : 'm-sell'}>{r.side === 'BUY' ? 'buy' : 'sell'} {r.volume}</span>
              </div>
              <div className="m-row-sub">{px(r.openPrice)} → {px(r.closePrice)}</div>
            </div>
            <div className="m-row-right">
              <div className="m-row-time">{r.closeTime || r.openTime}</div>
              <div className={`m-row-pnl ${(r.profit ?? 0) >= 0 ? 'm-up' : 'm-down'}`}>{pnl(r.profit ?? 0)}</div>
            </div>
          </div>
        ))
      ) : tab === 'orders' ? (
        !ordersAvailable ? (
          <div className="m-empty">Order history isn’t available on the web terminal yet.</div>
        ) : filteredOrders.length === 0 ? (
          <div className="m-empty">No orders for this period.</div>
        ) : filteredOrders.map((o) => (
          <div className="m-row" key={o.ticket}>
            <div className="m-row-main">
              <div className="m-row-top"><b>{o.symbol},</b>{' '}
                <span className={o.side === 'BUY' ? 'm-buy' : 'm-sell'}>{o.type} {o.volume}</span>
              </div>
              <div className="m-row-sub">@ {px(o.price)}{o.state ? ` · ${orderStateLabel(o.state)}` : ''}</div>
            </div>
            <div className="m-row-right">
              <div className="m-row-time">{o.time}</div>
            </div>
          </div>
        ))
      ) : !dealsAvailable ? (
        <div className="m-empty">Deal history isn’t available on the web terminal yet.</div>
      ) : filteredDeals.length === 0 ? (
        <div className="m-empty">No deals for this period.</div>
      ) : filteredDeals.map((d) => (
        <div className="m-row" key={d.ticket}>
          <div className="m-row-main">
            <div className="m-row-top"><b>{d.symbol},</b>{' '}
              <span className={d.side === 'BUY' ? 'm-buy' : 'm-sell'}>{d.type} {d.volume}</span>
            </div>
            <div className="m-row-sub">@ {px(d.price)}</div>
          </div>
          <div className="m-row-right">
            <div className="m-row-time">{d.time}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
