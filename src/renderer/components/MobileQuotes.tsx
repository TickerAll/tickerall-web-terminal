/** MT5-style mobile QUOTES view (≤600px): the watchlist as rows — symbol + last-update
 *  time on the left, large Bid / Ask on the right, coloured by the last tick direction.
 *  Tapping a row charts that symbol; swiping a row LEFT reveals a red Remove (MT5-faithful,
 *  matches the position-row swipe) → drops it from the watchlist. (MT5 also shows a daily %,
 *  which the quote stream doesn't carry — omitted rather than faked.) */
import { useRef, useState } from 'react';
import type { QuoteVal } from '../types';
import { px } from './mobileFmt';

const hhmmss = (t: number) => {
  if (!t) return '';
  const d = new Date(t > 1e12 ? t : t * 1000);
  return d.toTimeString().slice(0, 8);
};

const REVEAL = 84; // px the row slides left to expose the Remove action

/** One watchlist row with swipe-left-to-remove. Tap charts the symbol; a horizontal swipe
 *  reveals/hides Remove; a vertical drag is left to the list to scroll. */
function QuoteRow({ symbol, q, active, onSelect, onRemove }: {
  symbol: string;
  q: QuoteVal | undefined;
  active: boolean;
  onSelect: (s: string) => void;
  onRemove: (s: string) => void;
}) {
  const [dx, setDx] = useState(0);
  const dxRef = useRef(0);
  const setDx2 = (v: number) => { dxRef.current = v; setDx(v); };
  const open = useRef(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);
  const horiz = useRef(false);

  const reset = () => { open.current = false; setDx2(0); };

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0]!;
    start.current = { x: t.clientX, y: t.clientY };
    moved.current = false; horiz.current = false;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (!start.current) return;
    const t = e.touches[0]!;
    const ddx = t.clientX - start.current.x;
    const ddy = t.clientY - start.current.y;
    if (!moved.current && (Math.abs(ddx) > 8 || Math.abs(ddy) > 8)) {
      moved.current = true;
      horiz.current = Math.abs(ddx) > Math.abs(ddy);
    }
    if (horiz.current) {
      const base = open.current ? -REVEAL : 0;
      setDx2(Math.max(-REVEAL, Math.min(0, base + ddx))); // left-swipe only, clamped
    }
  };
  const onTouchEnd = () => {
    const wasMoved = moved.current, wasH = horiz.current;
    start.current = null;
    if (!wasMoved) { if (open.current) reset(); else onSelect(symbol); return; } // tap
    if (wasH) { const o = dxRef.current < -REVEAL / 2; open.current = o; setDx2(o ? -REVEAL : 0); } // snap open/closed
  };

  const dir = q?.dir ?? 'flat';
  return (
    <div className="m-q-row">
      <button className="m-q-del" aria-label={`Remove ${symbol}`} tabIndex={dx < 0 ? 0 : -1}
        style={{ opacity: dx < 0 ? 1 : 0 }}
        onClick={(e) => { e.stopPropagation(); reset(); onRemove(symbol); }}>🗑 Remove</button>
      <div className={`m-q ${active ? 'on' : ''}`} style={{ transform: `translateX(${dx}px)` }}
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
        <div className="m-q-l">
          <div className="m-q-sym">{symbol}</div>
          <div className="m-q-time">{q ? hhmmss(q.time) : '—'}</div>
        </div>
        <div className="m-q-r">
          <div className={`m-q-px m-q-bid ${dir}`}>{q ? px(q.bid) : '—'}</div>
          <div className={`m-q-px m-q-ask ${dir}`}>{q ? px(q.ask) : '—'}</div>
        </div>
      </div>
    </div>
  );
}

export function MobileQuotes({ watch, quotes, activeSymbol, onSelect, onRemove }: {
  watch: string[];
  quotes: Record<string, QuoteVal>;
  activeSymbol: string | null;
  onSelect: (symbol: string) => void;
  /** Drop a symbol from the watchlist (api.unwatch + persisted). Swipe a row left to reveal it. */
  onRemove: (symbol: string) => void;
}) {
  if (watch.length === 0) {
    return <div className="m-empty">Your watchlist is empty. Tap ＋ in the header to add symbols.</div>;
  }
  return (
    <div className="m-quotes">
      {watch.map((s) => (
        <QuoteRow key={s} symbol={s} q={quotes[s]} active={activeSymbol === s} onSelect={onSelect} onRemove={onRemove} />
      ))}
    </div>
  );
}
