/**
 * The open/close transition core behind the trade cues, kept free of `api` / settings
 * imports so it unit-tests under plain Node.
 *
 * WHY ACCOUNTS ARE SEEDED (): the TickerAll API replays every currently-open position as
 * `opened` on each positions subscribe (the server `the initial-positions replay`). Connecting
 * an account with open trades therefore looked like N fresh opens and chimed on launch.
 * An account stays silent until the terminal seeds it with its connect snapshot; pushes
 * before that are recorded without a cue. After seeding, a key we have not seen → open
 * cue, a known key going away → close cue. The main process subscribes BEFORE the
 * connect call resolves, so the replay usually lands pre-seed; a replay that lands after
 * is already in the snapshot and stays silent too.
 */

import type { PositionPush } from '../../shared/types';

export type TradeCue = 'trade-open' | 'trade-close';

export interface TradeSoundCore {
  handle(p: PositionPush): void;
  /** Mark the account's snapshot as known; cues start from here. */
  seed(accountId: string, tickets: number[]): void;
  /** Forget the account (disconnect); it is silent again until re-seeded. */
  reset(accountId: string): void;
}

export function createTradeSoundCore(play: (cue: TradeCue) => void): TradeSoundCore {
  // Keyed per account: MT5 tickets are per trade server and collide across accounts.
  const open = new Map<string, Set<number>>();
  const seeded = new Set<string>();
  const setFor = (id: string): Set<number> => {
    let s = open.get(id);
    if (!s) open.set(id, (s = new Set()));
    return s;
  };

  return {
    handle(p) {
      const ticket = p.position?.ticket;
      if (typeof ticket !== 'number' || !Number.isFinite(ticket)) return;
      const set = setFor(p.accountId);
      const live = seeded.has(p.accountId);
      if (p.event === 'position-closed') {
        if (set.delete(ticket) && live) play('trade-close');
        return;
      }
      // opened / updated: a partial close is an update of a known ticket → silent.
      if (!set.has(ticket)) {
        set.add(ticket);
        if (live) play('trade-open');
      }
    },
    seed(accountId, tickets) {
      const set = setFor(accountId);
      for (const t of tickets) set.add(t);
      seeded.add(accountId);
    },
    reset(accountId) {
      open.delete(accountId);
      seeded.delete(accountId);
    },
  };
}
