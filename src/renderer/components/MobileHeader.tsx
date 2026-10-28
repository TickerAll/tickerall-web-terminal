/** The mobile contextual header (web terminal, ≤600px). Replaces the persistent desktop
 *  toolbar — like real MT5 mobile, each bottom-nav view gets its OWN header:
 *    • Charts  — ☰ + symbol (tap → symbol selector) + TF label + indicators (icon) + New Order
 *    • Quotes  — ☰ + "Quotes" + add (＋)
 *    • Trade   — ☰ + "Trade" + total floating P&L (coloured) + add (＋)
 *    • History — ☰ + "History" / "All symbols"
 *  The ☰ opens the side-drawer (accounts + Settings/Journal/Theme/sign-out),
 *  mirroring MT5's hamburger menu. The chart timeframe is changed by TAPPING the chart
 *  (MT5-style) — the old header TF dropdown is gone; the header shows the current TF as a
 *  muted label next to the symbol. */
import { useState } from 'react';
import { TF_LABEL } from '../../shared/types';
import type { MobileView } from './MobileNav';
import { PERIODS, type Period } from './historyFilter';

interface Props {
  view: MobileView;
  activeSymbol: string | null;
  timeframe: number;
  floatingPnl: number;
  hasConnection: boolean;
  onMenu: () => void;
  onNewOrder: () => void;
  /** Opens the chart symbol selector (tap the symbol) — chart header only. */
  onPickSymbol?: () => void;
  /** Opens the add-symbol picker — Quotes header only. */
  onAddSymbol?: () => void;
  /** History period + its change handler — the period dropdown lives IN the History header. */
  period?: Period;
  onPeriodChange?: (p: Period) => void;
  /** The <IndicatorMenu> element (wired up by the shell) — chart header only. */
  indicatorSlot?: React.ReactNode;
  /** When false, the New Order affordances are hidden (a trade-disabled deployment). */
  canTrade?: boolean;
}

// P&L label is the signed number only — no currency suffix (implied by the account).
const fmtPnl = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(2)}`;

export function MobileHeader({
  view, activeSymbol, timeframe, floatingPnl, hasConnection, onMenu, onNewOrder, onPickSymbol, onAddSymbol, period, onPeriodChange, indicatorSlot, canTrade = true,
}: Props) {
  const [periodOpen, setPeriodOpen] = useState(false); // History header period dropdown
  const menuBtn = <button className="m-head-menu" aria-label="Menu" onClick={onMenu}>☰</button>;

  if (view === 'chart') {
    return (
      <header className="m-head m-head-chart">
        {menuBtn}
        <button className="m-head-sym" disabled={!hasConnection} onClick={onPickSymbol} title="Change symbol">
          {activeSymbol ?? '—'} <span className="m-head-caret">▾</span>
        </button>
        {activeSymbol && <span className="m-head-tf">{TF_LABEL[timeframe]}</span>}
        <div className="m-head-spacer" />
        {indicatorSlot}
        {canTrade && <button className="neworder" disabled={!hasConnection || !activeSymbol} onClick={onNewOrder}>New Order</button>}
      </header>
    );
  }

  if (view === 'trade') {
    return (
      <header className="m-head">
        {menuBtn}
        <div className="m-head-titlewrap">
          <span className="m-head-title">Trade</span>
          <span className={`m-head-sub ${floatingPnl >= 0 ? 'up' : 'down'}`}>{fmtPnl(floatingPnl)}</span>
        </div>
        {canTrade && <button className="m-head-add" aria-label="New order" disabled={!hasConnection || !activeSymbol} onClick={onNewOrder}>＋</button>}
      </header>
    );
  }

  if (view === 'history') {
    return (
      <header className="m-head">
        {menuBtn}
        <span className="m-head-title">History</span>
        <div className="m-head-period">
          <button className="m-head-pbtn" onClick={() => setPeriodOpen((v) => !v)}>
            {PERIODS.find((p) => p.id === period)?.label ?? 'All history'} <span className="m-head-caret">▾</span>
          </button>
          {periodOpen && (
            <div className="m-head-pmenu">
              {PERIODS.map((p) => (
                <button key={p.id} className={p.id === period ? 'on' : ''}
                  onClick={() => { onPeriodChange?.(p.id); setPeriodOpen(false); }}>{p.label}</button>
              ))}
            </div>
          )}
        </div>
      </header>
    );
  }

  // quotes
  return (
    <header className="m-head">
      {menuBtn}
      <span className="m-head-title">Quotes</span>
      <button className="m-head-add" aria-label="Add symbol" disabled={!hasConnection} onClick={onAddSymbol}>＋</button>
    </header>
  );
}
