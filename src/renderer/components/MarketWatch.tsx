import { useMemo, useState } from 'react';
import type { ConnAcct, QuoteVal } from '../types';
import { fmtPrice } from '../format';

/**
 * Market Watch — the connected account's symbols with live bid/ask. Scoped per
 * broker account (the tabs switch which account's watch + chart is active), the
 * MT5 way. Click a symbol to chart it; the active chart symbol is highlighted.
 */
export function MarketWatch({
  accts, activeId, onSetActive, acct, quotes, activeSymbol, onSelect, onAdd, onRemove, onNewOrder, onMaximize, maximized,
}: {
  accts: ConnAcct[];
  activeId: string;
  onSetActive: (id: string) => void;
  acct: ConnAcct;
  quotes: Record<string, QuoteVal>;
  activeSymbol: string | null;
  onSelect: (s: string) => void;
  onAdd: (s: string) => void;
  onRemove: (s: string) => void;
  onNewOrder: (s: string) => void;
  /** Maximize/restore the left sidebar (optional — shown when provided). */
  onMaximize?: () => void;
  maximized?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState('');

  const candidates = useMemo(() => {
    if (!adding) return [];
    const inWatch = new Set(acct.watch);
    const f = filter.trim().toUpperCase();
    return acct.symbols
      .filter((s) => !inWatch.has(s) && (f === '' || s.toUpperCase().includes(f)))
      .slice(0, 60);
  }, [adding, filter, acct.symbols, acct.watch]);

  return (
    <div className="mw">
      <div className="panel-h">
        <span>Market Watch</span>
        <span className="panel-h-actions">
          {onMaximize && (
            <button className="iconbtn" title={maximized ? 'Restore panel' : 'Maximize panel'} onClick={onMaximize}>{maximized ? '⤡' : '⤢'}</button>
          )}
          <button className="iconbtn" title="Add symbol" onClick={() => setAdding((v) => !v)}>{adding ? '×' : '+'}</button>
        </span>
      </div>

      {accts.length > 1 && (
        <div className="mw-acct">
          <select
            className="mw-acct-select"
            value={activeId}
            onChange={(e) => onSetActive(e.target.value)}
            title="Switch account"
            aria-label="Account"
          >
            {accts.map((a) => (
              <option key={a.id} value={a.id}>{a.label}</option>
            ))}
          </select>
        </div>
      )}

      {adding && (
        <div className="mw-add">
          <input autoFocus placeholder="Search symbols…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <div className="mw-cands">
            {candidates.length === 0 && <div className="muted tiny" style={{ padding: '6px 8px' }}>no matches</div>}
            {candidates.map((s) => (
              <div key={s} className="mw-cand" onClick={() => { onAdd(s); setFilter(''); }}>{s}</div>
            ))}
          </div>
        </div>
      )}

      <table className="mw-table">
        <thead><tr><th>Symbol</th><th className="num">Bid</th><th className="num">Ask</th><th /></tr></thead>
        <tbody>
          {acct.watch.map((s) => {
            const q = quotes[s] as QuoteVal | undefined;
            const cls = q ? (q.dir === 'up' ? 'up' : q.dir === 'down' ? 'down' : '') : '';
            return (
              <tr key={s} className={activeSymbol === s ? 'sel' : ''} onClick={() => onSelect(s)} onDoubleClick={() => onNewOrder(s)}>
                <td className="sym">{s}</td>
                <td className={`num ${cls}`}>{fmtPrice(q?.bid)}</td>
                <td className={`num ${cls}`}>{fmtPrice(q?.ask)}</td>
                <td className="x"><button className="rm" title="Remove" onClick={(e) => { e.stopPropagation(); onRemove(s); }}>×</button></td>
              </tr>
            );
          })}
          {acct.watch.length === 0 && (
            <tr><td colSpan={4} className="muted tiny" style={{ padding: '10px 8px' }}>No symbols — add some with +</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
