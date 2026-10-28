/** Mobile symbol picker (≤600px) — a full-screen sheet with a search box over the
 *  broker's symbol list. Two modes:
 *    • 'add'    (Quotes header ＋): tapping a row adds it to the watchlist (and it drops
 *               out of the list). Stays open so you can add several, then ‹ closes.
 *    • 'switch' (tap the chart symbol): tapping a row CHARTS that symbol and closes —
 *               your watchlist shows first for a quick switch, with the current one ✓'d.
 *  Reuses the connected account's symbol list — the same data the desktop Market Watch uses. */
import { useMemo, useState } from 'react';

export function MobileSymbolPicker({
  symbols, watch, onAdd, onClose, mode = 'add', activeSymbol, onSelect,
}: {
  symbols: string[];
  watch: string[];
  onAdd: (symbol: string) => void;
  onClose: () => void;
  /** 'add' = add to watchlist (default); 'switch' = chart the picked symbol. */
  mode?: 'add' | 'switch';
  /** The currently-charted symbol (switch mode — gets a ✓). */
  activeSymbol?: string | null;
  /** Chart the picked symbol (switch mode). */
  onSelect?: (symbol: string) => void;
}) {
  const [filter, setFilter] = useState('');
  const inWatch = useMemo(() => new Set(watch), [watch]);

  const candidates = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const match = (s: string) => f === '' || s.toLowerCase().includes(f);
    if (mode === 'add') {
      // exclude already-watched; search over all symbols
      return symbols.filter((s) => !inWatch.has(s) && match(s)).slice(0, 300);
    }
    // switch: watchlist first (quick-switch), then the rest; all searchable
    const watched = watch.filter(match);
    const rest = symbols.filter((s) => !inWatch.has(s) && match(s));
    return [...watched, ...rest].slice(0, 300);
  }, [symbols, watch, inWatch, filter, mode]);

  const body = (
    <>
      <div className="m-pick-search">
        {/* No autoFocus: this picker is mobile-only (Terminal's mobile picker + OrderDialog's
            mobile block), and auto-focusing popped the on-screen keyboard + blocked the list.
            The user taps the search box when they want to filter. */}
        <input placeholder="Search symbols…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <div className="m-pick-list">
        {candidates.length === 0 ? (
          <div className="m-empty">{filter ? `No symbols match “${filter}”.` : (mode === 'add' ? 'All symbols are already in your watchlist.' : 'No symbols.')}</div>
        ) : candidates.map((s) => (
          <button
            key={s}
            className={`m-pick-row ${mode === 'switch' && s === activeSymbol ? 'on' : ''}`}
            onClick={() => { if (mode === 'switch') { onSelect?.(s); onClose(); } else { onAdd(s); } }}
          >
            <span className="m-pick-sym">{s}</span>
            <span className="m-pick-plus" aria-hidden="true">{mode === 'switch' ? (s === activeSymbol ? '✓' : '') : '＋'}</span>
          </button>
        ))}
      </div>
    </>
  );

  // switch = a compact bottom SHEET (a quick instrument swap shouldn't take the whole
  // screen); add = the full-screen sheet (a dedicated "manage your watchlist" task).
  if (mode === 'switch') {
    return (
      <div className="m-pick-back" onClick={onClose}>
        <div className="m-pick-sheet" onClick={(e) => e.stopPropagation()}>
          <div className="m-pick-sheet-h"><span>Symbol</span><button className="iconbtn" aria-label="Close" onClick={onClose}>×</button></div>
          {body}
        </div>
      </div>
    );
  }
  return (
    <div className="m-sheet m-pick">
      <header className="m-head">
        <button className="m-head-menu" aria-label="Back" onClick={onClose}>‹</button>
        <span className="m-head-title">Add symbol</span>
      </header>
      {body}
    </div>
  );
}
