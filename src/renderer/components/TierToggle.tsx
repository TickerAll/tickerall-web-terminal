import React from 'react';
import { tierOverride, type Tier } from './useViewport';

/** Layout-tier preview control (WEB only). Forces the layout tier — mobile / tablet /
 *  desktop — regardless of the real viewport, or 'Auto' to follow the device. Writes
 *  localStorage `ta.tier` (read by useViewport) and fires a resize so the layout reflows
 *  without a reload.
 *
 *    • variant="bar"  — inline segmented icon group, for the desktop/tablet toolbar.
 *    • variant="menu" — a drawer menu row (matches Chart layout), for the mobile ☰ drawer.
 *
 *  Labelled "Screen size" (not "layout") so it isn't confused with the adjacent Chart
 *  layout control in the mobile drawer. */
const ICON: Record<'auto' | Tier, React.ReactNode> = {
  // Auto = double-arrow "resolve automatically / reset".
  auto: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" /><path d="M3 21v-5h5" />
    </svg>
  ),
  mobile: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="7" y="2" width="10" height="20" rx="2" /><line x1="10.5" y1="18.5" x2="13.5" y2="18.5" />
    </svg>
  ),
  tablet: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="3" width="16" height="18" rx="2" /><line x1="10.5" y1="18" x2="13.5" y2="18" />
    </svg>
  ),
  desktop: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="13" rx="2" /><path d="M8 21h8M12 17v4" />
    </svg>
  ),
};

const OPTS: Array<['auto' | Tier, Tier | null, string]> = [
  ['auto', null, 'Auto (match this device)'],
  ['mobile', 'mobile', 'Mobile layout'],
  ['tablet', 'tablet', 'Tablet layout'],
  ['desktop', 'desktop', 'Desktop layout'],
];

function useTier(): [Tier | null, (t: Tier | null) => void] {
  const [cur, setCur] = React.useState<Tier | null>(() => tierOverride());
  const set = (t: Tier | null) => {
    try { if (t) localStorage.setItem('ta.tier', t); else localStorage.removeItem('ta.tier'); } catch { /* private mode */ }
    setCur(t);
    window.dispatchEvent(new Event('resize')); // nudge useViewport to re-resolve + reflow
  };
  return [cur, set];
}

export function TierToggle({ variant = 'bar' }: { variant?: 'bar' | 'menu' }) {
  const [cur, set] = useTier();

  // Drawer row (mobile ☰): label + icon picker, matching the Chart-layout control.
  if (variant === 'menu') {
    return (
      <div className="m-menu-item m-menu-layout" role="group" aria-label="Preview screen size">
        <span>Screen size</span>
        <div className="m-layout-pick">
          {OPTS.map(([icon, t, label]) => (
            <button
              key={icon}
              className={`m-layout-btn ${cur === t ? 'on' : ''}`}
              title={label}
              aria-label={label}
              aria-pressed={cur === t}
              onClick={() => set(t)}
            >{ICON[icon]}</button>
          ))}
        </div>
      </div>
    );
  }

  // Toolbar (desktop/tablet): inline segmented icon group.
  return (
    <div className="tier-seg" role="group" aria-label="Preview screen size">
      {OPTS.map(([icon, t, label]) => (
        <button
          key={icon}
          className={`tier-seg-btn ${cur === t ? 'on' : ''}`}
          onClick={() => set(t)}
          title={label}
          aria-label={label}
          aria-pressed={cur === t}
        >{ICON[icon]}</button>
      ))}
    </div>
  );
}
