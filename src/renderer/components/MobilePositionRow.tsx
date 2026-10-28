/** A Trade-view OPEN-POSITION row with mobile touch affordances (≤600px):
 *   • swipe the row LEFT → reveal a ✎ Modify action (the ✕ Close stays always visible);
 *   • long-press → open a fuller action menu (onMenu — Modify / Close / Chart);
 *   • a plain tap charts the symbol; a tap on an already-revealed row closes the reveal.
 *  The gestures are disambiguated like the chart's (tap vs long-press vs drag), and a
 *  vertical drag is left to the list to scroll. */
import { useRef, useState } from 'react';

const REVEAL = 58; // px the row slides left to expose the Modify action

export function MobilePositionRow({ onTap, onModify, onClose, onMenu, children, canTrade = true }: {
  onTap: () => void;
  onModify: () => void;
  onClose: () => void;
  onMenu: () => void;
  children: React.ReactNode;
  /** When false the row is READ-ONLY: tap-to-view only — no swipe reveal, long-press menu,
   *  ✎ Modify or ✕ Close (a trade-disabled deployment). */
  canTrade?: boolean;
}) {
  const [dx, setDx] = useState(0);
  const dxRef = useRef(0);
  const setDx2 = (v: number) => { dxRef.current = v; setDx(v); };
  const open = useRef(false);     // is the Modify action currently revealed?
  const start = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);
  const horiz = useRef(false);
  const lp = useRef(0);
  const lpFired = useRef(false);

  const reset = () => { open.current = false; setDx2(0); };

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    start.current = { x: t.clientX, y: t.clientY };
    moved.current = false; horiz.current = false; lpFired.current = false;
    window.clearTimeout(lp.current);
    if (canTrade) lp.current = window.setTimeout(() => { lpFired.current = true; reset(); onMenu(); }, 500);
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (!start.current) return;
    const t = e.touches[0];
    const ddx = t.clientX - start.current.x;
    const ddy = t.clientY - start.current.y;
    if (!moved.current && (Math.abs(ddx) > 8 || Math.abs(ddy) > 8)) {
      moved.current = true;
      horiz.current = Math.abs(ddx) > Math.abs(ddy);
      window.clearTimeout(lp.current); // a drag cancels the long-press
    }
    if (horiz.current && canTrade) {
      const base = open.current ? -REVEAL : 0;
      setDx2(Math.max(-REVEAL, Math.min(0, base + ddx))); // left-swipe only, clamped
    }
  };
  const onTouchEnd = () => {
    window.clearTimeout(lp.current);
    const wasMoved = moved.current, wasLp = lpFired.current, wasH = horiz.current;
    start.current = null;
    if (wasLp) return;                                  // long-press already handled
    if (!wasMoved) { if (open.current) reset(); else onTap(); return; } // tap
    if (wasH) { const o = dxRef.current < -REVEAL / 2; open.current = o; setDx2(o ? -REVEAL : 0); } // snap
  };

  return (
    <div className="m-posrow">
      <div className="m-posrow-swipe">
        {canTrade && <button className="m-posrow-modify" aria-label="Modify position" tabIndex={dx < 0 ? 0 : -1}
          style={{ opacity: dx < 0 ? 1 : 0 }}
          onClick={(e) => { e.stopPropagation(); reset(); onModify(); }}>✎</button>}
        <div className="m-posrow-track" style={{ transform: `translateX(${dx}px)` }}
          onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
          {children}
        </div>
      </div>
      {canTrade && <button className="m-posrow-x" aria-label="Close position" onClick={(e) => { e.stopPropagation(); onClose(); }}>✕</button>}
    </div>
  );
}
