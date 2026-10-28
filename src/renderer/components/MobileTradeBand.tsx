/** MT5-style one-tap SELL/BUY band for the mobile chart view (≤600px). Pinned at the
 *  bottom of the chart, above the nav: a big SELL button (the bid) on the left, a volume
 *  control in the middle (− / a directly-editable lot field / +), a big BUY button (the
 *  ask) on the right. Tapping SELL/BUY places a MARKET order at the shown volume. The lot
 *  field is typeable; the shell clamps it to the symbol's volumeMin/step before sending. */
import { useState } from 'react';
import { px } from './mobileFmt';

export function MobileTradeBand({ bid, ask, volume, onStep, onSetVolume, onSell, onBuy, disabled }: {
  bid: number | null;
  ask: number | null;
  volume: number;
  onStep: (dir: 1 | -1) => void;
  /** Commit a directly-typed lot size (the shell validates it against volumeMin/step). */
  onSetVolume: (v: number) => void;
  onSell: () => void;
  onBuy: () => void;
  disabled: boolean;
}) {
  // While focused, hold the raw typed string so partial entries ("0.", "1.2") aren't fought
  // by the controlled value; commit (validate + clamp) on blur / Enter.
  const [edit, setEdit] = useState<string | null>(null);
  const commit = () => {
    if (edit != null) { const v = Number(edit); if (Number.isFinite(v) && v > 0) onSetVolume(v); setEdit(null); }
  };

  return (
    <div className="m-band">
      <button className="m-band-side m-band-sell" disabled={disabled || bid == null} onClick={onSell}>
        <span className="m-band-lbl">SELL</span>
        <span className="m-band-px">{bid != null ? px(bid) : '—'}</span>
      </button>
      <div className="m-band-vol">
        <button className="m-band-step" aria-label="Decrease volume" disabled={disabled} onClick={() => onStep(-1)}>⌄</button>
        <input
          className="m-band-volinput"
          type="number" inputMode="decimal" step="any" min="0" aria-label="Volume (lots)"
          value={edit ?? volume.toFixed(2)}
          disabled={disabled}
          onFocus={(e) => { setEdit(volume.toFixed(2)); e.currentTarget.select(); }}
          onChange={(e) => setEdit(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        />
        <button className="m-band-step" aria-label="Increase volume" disabled={disabled} onClick={() => onStep(1)}>⌃</button>
      </div>
      <button className="m-band-side m-band-buy" disabled={disabled || ask == null} onClick={onBuy}>
        <span className="m-band-lbl">BUY</span>
        <span className="m-band-px">{ask != null ? px(ask) : '—'}</span>
      </button>
    </div>
  );
}
