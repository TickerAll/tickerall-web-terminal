import { useState } from 'react';
import type { PositionRow, PendingOrderRow } from '../../shared/types';
import { fmtPrice } from '../format';

/** The thing being modified: an open position (SL/TP only) or a resting pending order
 *  (trigger price + SL/TP). */
export type ModifyTarget =
  | { kind: 'position'; position: PositionRow }
  | { kind: 'pending'; order: PendingOrderRow };

/** Modify ticket — MT5's "Modify position / order" dialog. Positions edit Stop Loss /
 *  Take Profit; pending orders also edit the trigger price. It is a deliberate, typed
 *  action (no silent one-tap modify — the founding real-money rule): you enter the
 *  levels and press Modify. An empty SL/TP field clears that level (MT5: 0 = none). */
export function ModifyDialog({
  target, busy, onSubmit, onClose,
}: {
  target: ModifyTarget;
  busy: boolean;
  /** price is undefined for a position (SL/TP only); 0 for SL/TP clears that level. */
  onSubmit: (vals: { price?: number; stopLoss: number; takeProfit: number }) => void;
  onClose: () => void;
}) {
  const isPending = target.kind === 'pending';
  const row = isPending ? target.order : target.position;
  const ticket = row.ticket;
  const symbol = row.symbol;
  const side = row.side;
  const volume = row.volume;
  const typeLabel = isPending ? target.order.orderType : (side === 'BUY' ? 'buy' : 'sell');

  const [price, setPrice] = useState(isPending ? String(target.order.price ?? '') : '');
  const [sl, setSl] = useState(row.stopLoss ? String(row.stopLoss) : '');
  const [tp, setTp] = useState(row.takeProfit ? String(row.takeProfit) : '');

  // A pending order needs a positive trigger price; SL/TP are optional (blank = none).
  const priceNum = price.trim() ? Number(price) : NaN;
  const priceValid = !isPending || (Number.isFinite(priceNum) && priceNum > 0);

  const submit = () => {
    if (busy || !priceValid) return;
    onSubmit({
      price: isPending ? priceNum : undefined,
      stopLoss: sl.trim() ? Number(sl) : 0,
      takeProfit: tp.trim() ? Number(tp) : 0,
    });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="order-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="panel-h">
          <span>Modify {isPending ? 'order' : 'position'} #{ticket}</span>
          <button className="iconbtn" onClick={onClose}>×</button>
        </div>

        <label>Position</label>
        <div className="modify-sum">
          <b>{symbol}</b>{' '}
          <span className={side === 'BUY' ? 'up' : 'down'}>{typeLabel} {volume}</span>
        </div>

        {isPending && (
          <>
            <label>Trigger price</label>
            <input type="number" step="any" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="price to trigger at" />
          </>
        )}

        <div className="row">
          <div><label>Stop Loss</label><input type="number" step="any" placeholder="none" value={sl} onChange={(e) => setSl(e.target.value)} /></div>
          <div><label>Take Profit</label><input type="number" step="any" placeholder="none" value={tp} onChange={(e) => setTp(e.target.value)} /></div>
        </div>

        <div className="order-btns">
          <button className="modify-go" disabled={busy || !priceValid} onClick={submit}>
            <span>Modify {isPending ? 'order' : 'position'}</span>
            {isPending && <b>{fmtPrice(priceValid ? priceNum : undefined)}</b>}
          </button>
        </div>
        {isPending && !priceValid && (
          <div className="muted tiny" style={{ textAlign: 'center', marginTop: 6 }}>Enter a trigger price.</div>
        )}
        <div className="muted tiny" style={{ textAlign: 'center', marginTop: 8 }}>
          {busy ? 'Sending…' : 'Leave a level blank to remove it.'}
        </div>
      </div>
    </div>
  );
}
