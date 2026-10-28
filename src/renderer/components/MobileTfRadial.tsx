/** Mobile on-chart RADIAL timeframe selector (≤600px) — MT5-mobile-style circular dial.
 *  Toggled by a tap on the chart. The timeframes are arranged round a ring with the current
 *  one in the hub; pick one to switch + dismiss, tap the backdrop to close. Centered over the
 *  chart so it never clips. The ring pops IN on open and eases OUT on dismiss (the dial owns
 *  its close timing via a `closing` state so the exit animation can play before unmount). */
import { useState } from 'react';
import { TIMEFRAMES, TF_LABEL } from '../../shared/types';

export function MobileTfRadial({ timeframe, onPick, onClose }: {
  timeframe: number;
  onPick: (id: number) => void;
  onClose: () => void;
}) {
  const [closing, setClosing] = useState(false);
  const requestClose = () => { if (closing) return; setClosing(true); window.setTimeout(onClose, 150); }; // let the exit anim play
  const N = TIMEFRAMES.length;
  const R = 98; // ring radius (px)
  return (
    <div className={`m-tfradial-back ${closing ? 'closing' : ''}`} onClick={requestClose}>
      <div className={`m-tfradial ${closing ? 'closing' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="m-tfradial-hub">{TF_LABEL[timeframe] ?? '—'}</div>
        {TIMEFRAMES.map((t, i) => {
          const a = (i / N) * 2 * Math.PI - Math.PI / 2; // start at the top, go clockwise
          const x = Math.cos(a) * R;
          const y = Math.sin(a) * R;
          return (
            <button
              key={t.id}
              className={`m-tfradial-btn ${t.id === timeframe ? 'on' : ''}`}
              style={{ left: `calc(50% + ${x.toFixed(1)}px)`, top: `calc(50% + ${y.toFixed(1)}px)` }}
              onClick={() => { onPick(t.id); requestClose(); }}
            >{t.label}</button>
          );
        })}
      </div>
    </div>
  );
}
