/**
 * AlertsEngine — watches the live tick stream and fires price alerts exactly ONCE per
 * crossing (TERMINAL-ROADMAP area I). It subscribes to `tickBus.onAny` (every tick,
 * for every watched symbol + account), and for each enabled, not-yet-triggered alert
 * whose `(accountId, symbol)` matches the tick, checks whether the bid has CROSSED the
 * threshold from the correct side. On a cross it: marks the alert triggered (so it
 * won't re-fire until re-armed), plays the ALERT cue, raises an in-app toast, and —
 * if `alerts.osNotifications` is on — a desktop notification.
 *
 * CROSS-ONCE SEMANTICS (the load-bearing bit)
 *   - `op:'above'` fires on a transition from `bid < price` to `bid >= price`.
 *   - `op:'below'` fires on a transition from `bid > price` to `bid <= price`.
 *   To detect a *transition* (not merely "currently past the line"), the engine keeps
 *   the previous bid per `(accountId, symbol)`. With a previous bid, it fires only
 *   when the previous bid was on the un-triggered side and the new bid is on/over the
 *   line — a true crossing. With NO previous bid (the first tick after arming), it
 *   fires if the alert was placed on the *far* side of the current price, i.e. the
 *   condition is already satisfied by the very first observation (you set an alert
 *   below market → it's already below → fire now). This "arm already-satisfied" rule
 *   is intentional and matches MT5: an alert you create already-true triggers at once.
 *   Either way `triggeredAt` makes it fire AT MOST once; re-arming clears it.
 *
 *   Hysteresis against tick jitter: because we require an actual side change (prev on
 *   the inactive side, now on the active side), a bid that merely wobbles around the
 *   line after firing does nothing — the alert is already `triggeredAt`. After a
 *   re-arm, the prev-bid baseline is whatever the next tick is, so a single re-cross
 *   is needed to fire again.
 *
 * Self-contained: `startAlertsEngine()` is idempotent and wires everything (it also
 * calls `tickBus.start()`, which is itself idempotent). It reads alerts from the
 * alerts store and settings live, so toggling an alert / changing the OS-notification
 * pref takes effect without a restart. Nothing here throws into the tick path.
 */

import { tickBus } from '../chart/tickBus';
import type { Quote } from '../../shared/types';
import type { PriceAlert } from '../../shared/settingsSchema';
import { getSetting } from '../settings/store';
import { getAlerts, markTriggered } from './store';
import { soundManager } from '../sound/SoundManager';
import { pushToast } from '../components/Toasts';
import { notify } from './notify';

/** Last seen bid per `${accountId}:${symbol}` — for crossing (transition) detection. */
const lastBid = new Map<string, number>();

let started = false;
let unsub: (() => void) | null = null;

/** Does `bid` satisfy the alert's directional condition right now? */
function satisfied(a: PriceAlert, bid: number): boolean {
  return a.op === 'above' ? bid >= a.price : bid <= a.price;
}

/**
 * Decide whether this tick is a firing CROSS for the alert.
 *   - prev known  → fire iff prev was NOT satisfied and now IS (a real crossing).
 *   - prev unknown → fire iff the very first observed bid already satisfies it
 *     (an alert armed on the far side of price is already-true).
 */
function isCrossing(a: PriceAlert, prev: number | undefined, bid: number): boolean {
  const now = satisfied(a, bid);
  if (!now) return false;
  if (prev === undefined) return true; // armed already-satisfied
  return !satisfied(a, prev); // crossed in this tick (was on the other side)
}

function onTick(q: Quote): void {
  if (!Number.isFinite(q.bid)) return;
  const key = `${q.accountId}:${q.symbol}`;
  const prev = lastBid.get(key);

  // Evaluate every matching, enabled, un-triggered alert against this tick.
  for (const a of getAlerts()) {
    if (!a.enabled || a.triggeredAt != null) continue;
    if (a.accountId !== q.accountId || a.symbol !== q.symbol) continue;
    if (isCrossing(a, prev, q.bid)) fire(a, q.bid);
  }

  // Record AFTER evaluating, so the first tick uses the "armed already-satisfied"
  // branch (prev=undefined) rather than comparing a bid to itself.
  lastBid.set(key, q.bid);
}

/** Fire one alert: mark it (prevents re-fire), play the cue, toast + OS notify. */
function fire(a: PriceAlert, bid: number): void {
  markTriggered(a.id);
  // The sound is gated on sounds.enabled + sounds.alert + volume inside playGated.
  soundManager.playGated('alert');

  const arrow = a.op === 'above' ? '↑' : '↓';
  const title = `${a.symbol} ${arrow} ${trimNum(a.price)}`;
  const body = `Bid ${trimNum(bid)} crossed ${a.op} ${trimNum(a.price)}`;
  pushToast({ kind: 'alert', title, body, ttlMs: 8000 });

  if (getSetting<boolean>('alerts.osNotifications') !== false) {
    notify(title, body, `alert-${a.id}`);
  }
}

/** Compact a price for display (drop trailing zeros; cap to a sane precision). */
function trimNum(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  // up to 6 dp, then strip trailing zeros + a dangling dot.
  return n.toFixed(6).replace(/\.?0+$/, '');
}

/** Start the engine (idempotent). Begins the tick subscription + the bus. */
export function startAlertsEngine(): void {
  if (started) return;
  started = true;
  tickBus.start();
  unsub = tickBus.onAny(onTick);
}

/** Stop + reset (mainly for tests / teardown). */
export function stopAlertsEngine(): void {
  if (unsub) unsub();
  unsub = null;
  started = false;
  lastBid.clear();
}

/** Test-only seam: feed a synthetic tick through the engine's evaluation without the
 *  bus. Exposed so a probe / unit test can verify cross-once without real audio or a
 *  broker. NOT used by production code. */
export function __evaluateTickForTest(q: Quote): void {
  onTick(q);
}
