import { useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { ConnAcct, QuoteVal } from '../types';
import { fmtPrice } from '../format';
import { MobileSymbolPicker } from './MobileSymbolPicker';
import { MicroTickChart, TICK_MIN_H, TICK_MAX_H, TICK_DEFAULT_H } from './MicroTickChart';

type OrdType = 'market' | 'limit' | 'stop';

/** New Order ticket — MT5's order dialog. Pick the order type (Market / Limit / Stop),
 *  symbol, volume, an entry price for pending orders (+ optional SL/TP), then Sell or Buy.
 *  Market fills at the live bid/ask; Limit/Stop rest at the entered price until triggered. */
export function OrderDialog({
  acct, symbol, quote, quotesBySymbol, busy, mobile = false, onPlace, onClose,
}: {
  acct: ConnAcct;
  symbol: string;
  quote: QuoteVal | undefined;
  /** Live quotes for the account keyed by symbol — lets the dialog (and its micro tick
   *  chart) follow the CURRENTLY-selected symbol if the user changes it mid-ticket. */
  quotesBySymbol?: Record<string, QuoteVal>;
  busy: boolean;
  /** Mobile tier — render the symbol field as a button that opens a searchable picker. */
  mobile?: boolean;
  onPlace: (req: { symbol: string; side: 'BUY' | 'SELL'; type: OrdType; volume: number; price?: number; stopLoss?: number; takeProfit?: number; comment?: string }) => void;
  onClose: () => void;
}) {
  const [sym, setSym] = useState(symbol);
  // Tick-chart height (px) — drag the grip below the chart to resize it (continuous, no
  // presets); persisted so the chosen height sticks across dialogs/sessions.
  const [tickH, setTickH] = useState<number>(() => {
    const n = Number(localStorage.getItem('ta.microTickH'));
    return Number.isFinite(n) && n >= TICK_MIN_H && n <= TICK_MAX_H ? n : TICK_DEFAULT_H;
  });
  // Pointer-drag the grip: track the delta from the press point, clamp, persist on release.
  // Works for mouse + touch (one unified pointer path); window listeners so the drag survives
  // the pointer leaving the thin handle.
  const startResize = (e: ReactPointerEvent) => {
    e.preventDefault();
    const startY = e.clientY, startH = tickH;
    let lastH = startH;
    const onMove = (ev: PointerEvent) => {
      lastH = Math.max(TICK_MIN_H, Math.min(TICK_MAX_H, startH + (ev.clientY - startY)));
      setTickH(lastH);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      localStorage.setItem('ta.microTickH', String(Math.round(lastH)));
    };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
  };
  const [pickOpen, setPickOpen] = useState(false); // mobile: searchable symbol picker
  const [type, setType] = useState<OrdType>('market');
  const [volume, setVolume] = useState(0.1);
  const [price, setPrice] = useState('');
  const [sl, setSl] = useState('');
  const [tp, setTp] = useState('');
  const [comment, setComment] = useState('');

  const step = (d: number) => setVolume((v) => Math.max(0.01, Math.round((v + d) * 100) / 100));

  const isPending = type !== 'market';
  const priceNum = price.trim() ? Number(price) : NaN;
  const priceValid = !isPending || (Number.isFinite(priceNum) && priceNum > 0);
  const verb = type === 'limit' ? 'Limit' : type === 'stop' ? 'Stop' : 'Market';

  // The live quote for the CURRENTLY-selected symbol (follows a mid-ticket symbol change);
  // falls back to the quote the dialog opened with. The micro chart tracks its mid price.
  const liveQ = (quotesBySymbol && quotesBySymbol[sym]) || (sym === symbol ? quote : undefined);
  const livePrice = liveQ && Number.isFinite(liveQ.bid)
    ? (Number.isFinite(liveQ.ask) ? (liveQ.bid + liveQ.ask) / 2 : liveQ.bid)
    : null;

  const place = (side: 'BUY' | 'SELL') => {
    if (busy || !priceValid) return;
    onPlace({
      symbol: sym, side, type, volume,
      price: isPending ? priceNum : undefined,
      stopLoss: sl.trim() ? Number(sl) : undefined,
      takeProfit: tp.trim() ? Number(tp) : undefined,
      comment: comment.trim() || undefined,
    });
  };

  return (
    <>
    <div className="modal-backdrop" onClick={onClose}>
      <div className="order-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="panel-h"><span>New Order</span><button className="iconbtn" onClick={onClose}>×</button></div>

        <label>Symbol</label>
        {mobile ? (
          // Mobile: a searchable picker (the native <select> can't search the broker's
          // long symbol list). Reuses the chart/Quotes symbol picker.
          <button type="button" className="ord-sym-btn" onClick={() => setPickOpen(true)}>
            <span>{sym}</span><span className="ord-sym-caret">▾</span>
          </button>
        ) : (
          <select value={sym} onChange={(e) => setSym(e.target.value)}>
            {acct.symbols.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}

        {/* Live tick mini-chart (#7/#16/#20): the recent ticks for the selected symbol with
            price (y) + time (x) axes, autoscaled tight. Drag the grip below it to resize —
            continuous height, no presets, persisted. */}
        <div className="micro-tick-head">
          <span className="micro-tick-title">Live ticks</span>
        </div>
        <MicroTickChart symbol={sym} price={livePrice} height={tickH} />
        <div
          className="micro-tick-resize"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Drag to resize the tick chart"
          title="Drag to resize"
          onPointerDown={startResize}
        >
          <span className="micro-tick-grip" />
        </div>

        <label>Order type</label>
        <div className="ord-types">
          {(['market', 'limit', 'stop'] as OrdType[]).map((t) => (
            <button
              key={t}
              type="button"
              className={`ord-type${type === t ? ' active' : ''}`}
              onClick={() => setType(t)}
            >
              {t === 'market' ? 'Market' : t === 'limit' ? 'Limit' : 'Stop'}
            </button>
          ))}
        </div>

        <label>Volume (lots)</label>
        <div className="vol">
          <button className="stepbtn" onClick={() => step(-0.01)}>−</button>
          <input type="number" step="0.01" min="0.01" value={volume} onChange={(e) => setVolume(Math.max(0.01, Number(e.target.value) || 0.01))} />
          <button className="stepbtn" onClick={() => step(0.01)}>+</button>
        </div>

        {isPending && (
          <>
            <label>Entry price</label>
            <input type="number" step="any" value={price} onChange={(e) => setPrice(e.target.value)} placeholder={fmtPrice(liveQ?.ask) || 'price to trigger at'} />
          </>
        )}

        <div className="row">
          <div><label>Stop Loss</label><input placeholder="—" value={sl} onChange={(e) => setSl(e.target.value)} /></div>
          <div><label>Take Profit</label><input placeholder="—" value={tp} onChange={(e) => setTp(e.target.value)} /></div>
        </div>

        <label>Comment</label>
        <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="optional" />

        <div className="order-btns">
          <button className="sell" disabled={busy || !priceValid} onClick={() => place('SELL')}>
            <span>{isPending ? `Sell ${verb}` : 'Sell by Market'}</span>
            <b>{fmtPrice(isPending ? (priceValid ? priceNum : undefined) : liveQ?.bid)}</b>
          </button>
          <button className="buy" disabled={busy || !priceValid} onClick={() => place('BUY')}>
            <span>{isPending ? `Buy ${verb}` : 'Buy by Market'}</span>
            <b>{fmtPrice(isPending ? (priceValid ? priceNum : undefined) : liveQ?.ask)}</b>
          </button>
        </div>
        {isPending && !priceValid && (
          <div className="muted tiny" style={{ textAlign: 'center', marginTop: 6 }}>Enter an entry price for the pending order.</div>
        )}
        {busy && <div className="muted tiny" style={{ textAlign: 'center', marginTop: 8 }}>Sending order…</div>}
      </div>
    </div>
    {mobile && pickOpen && (
      <MobileSymbolPicker
        mode="switch" symbols={acct.symbols} watch={acct.watch} activeSymbol={sym}
        onSelect={(s) => setSym(s)} onAdd={() => {}} onClose={() => setPickOpen(false)}
      />
    )}
    </>
  );
}
