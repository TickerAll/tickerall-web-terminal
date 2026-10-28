/**
 * UserMenu — the toolbar account control: a circular INITIALS avatar that opens a
 * dropdown with the signed-in identity + actions (Settings / Home / Sign out). Replaces
 * the old "<email> · sign out" text.
 *
 * No avatar IMAGE yet: the TickerAll sign-in session user (AuthUser) carries no picture claim, so
 * initials are the safe default (first+last initial of the display name, else the first
 * two of the email). If a real Google picture is wanted later, surface a `picture` field
 * on AuthUser and render an <img> with this initials block as the fallback.
 */

import { useEffect, useRef, useState } from 'react';
import type { AuthUser } from '../../shared/types';
import { getBranding } from '../branding';

/** Avatar initials: two from a display name (first + last word), else the first two of
 *  the email local part, else '?'. */
export function userInitials(user?: AuthUser): string {
  const name = user?.displayName?.trim();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }
  const email = user?.email?.trim();
  if (email) return email.slice(0, 2).toUpperCase();
  return '?';
}

export function UserMenu({ user, onSettings, onHome, isWeb, onLogout }: {
  user?: AuthUser;
  onSettings: () => void;
  /** Leave to the TickerAll site root (web only — see Terminal.goHome). */
  onHome: () => void;
  isWeb: boolean;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // Close on outside pointer or Escape while open.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onEsc);
    return () => { window.removeEventListener('pointerdown', onDown); window.removeEventListener('keydown', onEsc); };
  }, [open]);

  const label = user?.displayName?.trim() || user?.email || 'Account';
  return (
    <div className="usermenu" ref={ref}>
      <button
        className="usermenu-avatar"
        title={label}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account: ${label}`}
      >{userInitials(user)}</button>
      {open && (
        <div className="usermenu-pop" role="menu">
          {(user?.displayName || user?.email) && (
            <div className="usermenu-id">
              {user?.displayName && <div className="usermenu-name">{user.displayName}</div>}
              {user?.email && <div className="usermenu-email" title={user.email}>{user.email}</div>}
            </div>
          )}
          <button className="usermenu-item" role="menuitem" onClick={() => { setOpen(false); onSettings(); }}>⚙ Settings</button>
          {isWeb && <button className="usermenu-item" role="menuitem" onClick={() => { setOpen(false); onHome(); }}>⌂ {getBranding().productName} Home</button>}
          <div className="usermenu-div" />
          <button className="usermenu-item usermenu-danger" role="menuitem" onClick={() => { setOpen(false); onLogout(); }}>⎋ Sign out</button>
        </div>
      )}
    </div>
  );
}
