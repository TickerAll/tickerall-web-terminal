/** The mobile bottom-tab bar (web terminal, ≤600px) — modelled on the real MT5 mobile
 *  shell: Quotes / Charts / Trade / History. (MT5's 5th tab is Messages, which we don't
 *  have; our secondary surfaces — Settings, Journal, accounts — live in the
 *  ☰ side-drawer, exactly like MT5's hamburger menu.) Each tab routes to an existing
 *  panel; no feature is added or removed. Rendered only when tier==='mobile'.
 *
 *  A partner host that embeds the terminal inside its OWN mobile shell can inject extra
 *  entries here (`platform.mobileNavItems`) so the user sees ONE unified bottom bar instead
 *  of ours plus a second host bar. Injected entries are ACTIONS, not MobileViews: they run a
 *  host closure (or navigate) and never take the `.on` active state, because what they select
 *  lives outside the terminal. They inherit the bar's `currentColor` styling, so they tint
 *  identically to the built-in tabs (including a host-stamped `data-brand-accent`).
 *  Absent → the bar is byte-unchanged. */

import type { HostNavItem } from '../../shared/types';
import { getMobileNavItems } from '../capabilities';

export type MobileView = 'quotes' | 'chart' | 'trade' | 'history';

interface NavTab { id: MobileView; label: string; icon: JSX.Element }

const I = {
  /** Quotes — up/down arrows (MT5's quotes glyph). */
  quotes: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 21V5M8 5 5 8M8 5l3 3" /><path d="M16 3v16M16 19l3-3M16 19l-3-3" />
    </svg>
  ),
  /** Charts — candlesticks. */
  chart: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 3v4M7 15v4" /><rect x="4.5" y="7" width="5" height="8" rx="1" fill="currentColor" stroke="none" />
      <path d="M17 4v4M17 16v4" /><rect x="14.5" y="8" width="5" height="8" rx="1" />
    </svg>
  ),
  /** Trade — line chart with nodes (MT5's trade glyph). */
  trade: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 16l5-5 4 3 6-7" />
      <circle cx="3" cy="16" r="1.7" fill="currentColor" stroke="none" /><circle cx="8" cy="11" r="1.7" fill="currentColor" stroke="none" />
      <circle cx="12" cy="14" r="1.7" fill="currentColor" stroke="none" /><circle cx="18" cy="7" r="1.7" fill="currentColor" stroke="none" />
    </svg>
  ),
  /** History — clock with a rewind arrow. */
  history: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 3-6.9L3 8" /><path d="M3 3v5h5" /><path d="M12 8v4l3 2" />
    </svg>
  ),
};

const TABS: NavTab[] = [
  { id: 'quotes', label: 'Quotes', icon: I.quotes },
  { id: 'chart', label: 'Charts', icon: I.chart },
  { id: 'trade', label: 'Trade', icon: I.trade },
  { id: 'history', label: 'History', icon: I.history },
];

/** Paint a host-supplied glyph: a `data:` URI as an <img>, an inline `<svg>` string as markup.
 *  `resolveMobileNavItems` has already vetted the string down to those two shapes. */
function HostIcon({ item }: { item: HostNavItem }) {
  if (item.icon.startsWith('data:image/')) {
    return <span className="m-nav-ico" aria-hidden="true"><img src={item.icon} alt="" width={22} height={22} /></span>;
  }
  return <span className="m-nav-ico" aria-hidden="true" dangerouslySetInnerHTML={{ __html: item.icon }} />;
}

/** One host-injected entry. Runs the host closure, else navigates `href`; a no-op if neither
 *  was supplied. No `role="tab"`/`aria-selected` — it isn't one of the bar's views. */
function HostNavButton({ item }: { item: HostNavItem }) {
  const activate = () => {
    if (item.onSelect) item.onSelect();
    else if (item.href) window.location.assign(item.href);
  };
  return (
    <button type="button" aria-label={item.label} onClick={activate}>
      <HostIcon item={item} />
      <span className="m-nav-lbl">{item.label}</span>
    </button>
  );
}

export function MobileNav({ view, onSelect }: { view: MobileView; onSelect: (v: MobileView) => void }) {
  const injected = getMobileNavItems();
  const before = injected.filter((i) => i.position === 'start');
  const after = injected.filter((i) => i.position !== 'start');
  return (
    <nav className="m-nav" role="tablist" aria-label="Sections">
      {before.map((i) => <HostNavButton key={i.id} item={i} />)}
      {TABS.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={view === t.id}
          className={view === t.id ? 'on' : ''}
          onClick={() => onSelect(t.id)}
        >
          <span className="m-nav-ico" aria-hidden="true">{t.icon}</span>
          <span className="m-nav-lbl">{t.label}</span>
        </button>
      ))}
      {after.map((i) => <HostNavButton key={i.id} item={i} />)}
    </nav>
  );
}
