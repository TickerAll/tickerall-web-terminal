/** MT5-style mobile ACCOUNT view (≤600px) — a focused, full-screen sheet for the active
 *  account: name, full login number, broker server, platform, demo/real, a per-state live
 *  status dot, and the financials. The financials update LIVE: balance from the account
 *  push, equity/free-margin/margin-level recomputed per tick the MT5-faithful way from the
 *  balance + the open positions' floating P&L (the same sum that drives the live P&L
 *  elsewhere). Reached from the ☰ drawer. */
import type { AccountInfo, BrokerAccount } from '../../shared/types';
import { money } from './mobileFmt';
import { liveFinancials } from './accountMath';

const platformLabel = (b?: string) => (b === 'mt5' ? 'MetaTrader 5' : b === 'mt4' ? 'MetaTrader 4' : (b ?? '—'));

export function MobileAccountView({ info, broker, connecting = false, floatingPnl = 0, onClose }: {
  info: AccountInfo | null;
  broker: BrokerAccount | null;
  /** True while the account is mid-(re)connect → amber dot. */
  connecting?: boolean;
  /** Σ open-position floating P&L (live, per tick) — drives live equity/free-margin/level. */
  floatingPnl?: number;
  onClose: () => void;
}) {
  // Status dot: green = hot/connected, amber = connecting, red = cold.
  const state: 'connected' | 'connecting' | 'cold' = connecting ? 'connecting' : (broker?.hot ? 'connected' : 'cold');
  const stateLabel = state === 'connected' ? 'Connected' : state === 'connecting' ? 'Connecting…' : 'Cold';

  // Live financials (MT5-faithful, shared with Toolbox + MobileTrade via liveFinancials):
  // equity = balance + Σ floating P&L; freeMargin = equity − margin; marginLevel = margin>0 ?
  // equity/margin×100 : null. Balance comes live from the account push; margin is the snapshot.
  const margin = info?.margin ?? 0;
  const { equity, freeMargin, marginLevel } = liveFinancials(info?.balance, margin, floatingPnl);

  const details: [string, string][] = [
    ['Name', info?.name || '—'],
    ['Account', info?.login != null ? String(info.login) : (broker?.accountNumber ?? '—')],
    ['Server', broker?.server ?? '—'],
    ['Platform', platformLabel(broker?.broker)],
    ['Type', broker ? (broker.isDemo ? 'Demo' : 'Real') : '—'],
    ['Status', stateLabel],
    ['Currency', info?.currency || '—'],
    ['Leverage', info?.leverage ? `1:${info.leverage}` : '—'],
  ];
  const financials: [string, string][] = info ? [
    ['Balance', `${money(info.balance)}${info.currency ? ' ' + info.currency : ''}`],
    ['Equity', equity != null ? money(equity) : '—'],
    ['Margin', money(margin)],
    ['Free margin', freeMargin != null ? money(freeMargin) : '—'],
    ['Margin level', marginLevel != null ? `${marginLevel.toFixed(2)}%` : '—'],
  ] : [];

  return (
    <div className="m-sheet">
      <header className="m-head">
        <button className="m-head-menu" aria-label="Back" onClick={onClose}>‹</button>
        <span className="m-head-title">Account</span>
      </header>
      <div className="m-acctview">
        <div className="m-acctview-hero">
          <div className="m-acctview-name">{info?.name || broker?.server || 'Account'}</div>
          <div className="m-acctview-sub">
            {info?.login != null ? `#${info.login}` : (broker?.accountNumber ?? '')}
            {broker ? ` · ${broker.isDemo ? 'Demo' : 'Real'}` : ''}
            <span className={`m-acctview-dot m-acctview-dot-${state}`} aria-hidden="true" />{stateLabel}
          </div>
        </div>
        <div className="m-acctview-sec">Details</div>
        {details.map(([k, v]) => (
          <div className="m-acctview-row" key={k}><span className="m-acctview-k">{k}</span><span className="m-acctview-v">{v}</span></div>
        ))}
        {financials.length > 0 && <div className="m-acctview-sec">Financials</div>}
        {financials.map(([k, v]) => (
          <div className="m-acctview-row" key={k}><span className="m-acctview-k">{k}</span><span className="m-acctview-v">{v}</span></div>
        ))}
      </div>
    </div>
  );
}
