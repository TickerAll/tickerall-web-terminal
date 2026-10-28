/**
 * tradeSounds — plays the trade-OPEN / trade-CLOSE cues off the live position stream
 * (TERMINAL-ROADMAP area I). `useTradeSounds()` adds a listener on `api.onPosition`
 * (additive `ipcRenderer.on` in the preload) and routes each real transition through
 * `soundManager.playGated`, so the live `sounds.*` settings apply.
 *
 * Transitions come from a per-account set of open tickets, not the event label: a
 * partial close arrives as `position-updated` for the same ticket, and the TickerAll API replays
 * every open position as `opened` on subscribe. The terminal must call
 * `seedTradeSounds` with the connect snapshot and `resetTradeSounds` on disconnect;
 * until an account is seeded it makes no sound (see tradeSoundCore, ).
 */

import { useEffect } from 'react';
import { api } from '../api';
import type { PositionRow } from '../../shared/types';
import { soundManager } from './SoundManager';
import { createTradeSoundCore } from './tradeSoundCore';

// Module-level so re-renders never reset it and Terminal can seed it directly.
const core = createTradeSoundCore((cue) => { soundManager.playGated(cue); });

export function seedTradeSounds(accountId: string, positions: PositionRow[]): void {
  core.seed(accountId, positions.map((p) => p.ticket));
}

export function resetTradeSounds(accountId: string): void {
  core.reset(accountId);
}

/** Subscribe the cues to the position stream. Call once, high in the tree. */
export function useTradeSounds(): void {
  useEffect(() => {
    // `api.onPosition` returns void; the listener lives for the app's lifetime.
    api.onPosition(core.handle);
  }, []);
}
