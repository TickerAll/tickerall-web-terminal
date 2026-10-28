/**
 * BigPrice — a large current-price readout shown as a DRAGGABLE on-chart overlay
 * (TradingView-style), rather than a strip that shrinks the chart. The big number is
 * the live bid, coloured by the last tick direction; bid/ask sit beneath. The card's
 * position is draggable and persisted.
 */

import { useState } from 'react';
import type { QuoteVal } from '../types';
import { fmtPrice } from '../format';

function loadPos(): { x: number; y: number } {
  try {
    const p = JSON.parse(localStorage.getItem('ta.bigPricePos') ?? '');
    if (p && typeof p.x === 'number' && typeof p.y === 'number') return p;
  } catch { /* fall through to default */ }
  return { x: 14, y: 14 };
}

export function BigPrice({ symbol, quote, onClose }: { symbol: string | null; quote?: QuoteVal; onClose?: () => void }) {
  const [pos, setPos] = useState(loadPos);
  if (!symbol) return null;
  const dir = quote?.dir ?? 'flat';

  const onDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.bp-x')) return; // not from the × button
    e.preventDefault();
    const ox = pos.x, oy = pos.y, sx = e.clientX, sy = e.clientY;
    const onMove = (ev: MouseEvent) => setPos({ x: Math.max(0, ox + (ev.clientX - sx)), y: Math.max(0, oy + (ev.clientY - sy)) });
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setPos((p) => { localStorage.setItem('ta.bigPricePos', JSON.stringify(p)); return p; });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div className={`big-price ${dir}`} style={{ left: pos.x, top: pos.y }} onMouseDown={onDown}>
      <div className="bp-head">
        <span className="bp-sym">{symbol}</span>
        {onClose && <button className="bp-x" title="Hide big price" onClick={onClose}>×</button>}
      </div>
      <div className="bp-main">{quote ? fmtPrice(quote.bid) : '—'}</div>
      <div className="bp-side">
        <span><span className="bp-k">Bid</span>{fmtPrice(quote?.bid)}</span>
        <span><span className="bp-k">Ask</span>{fmtPrice(quote?.ask)}</span>
      </div>
    </div>
  );
}
