/**
 * Pure candle-countdown maths — the "time to close of the forming bar" logic, shared
 * by the footer (StatusBar) and the in-chart countdown badge (CandleCountdown) so the
 * two never drift. No React, no DOM; pure functions + a tiny formatter.
 *
 * The bar PHASE is bucketed exactly like the forming bar (`formBar` / `buildBarsFromTicks`):
 *
 *   serverNow = localNow + offsetSec     (offset = broker − local, frozen at the last
 *                                          tick's arrival so the clock keeps advancing
 *                                          during tick silence — ticks are bursty)
 *   tfSec     = TF_SECONDS[tf] ?? 3600
 *   barStart  = floor(serverNow / tfSec) * tfSec   (broker grid; intraday TFs are
 *                                                   epoch-aligned, same as the forming bar)
 *   barEnd    = barStart + tfSec
 *   remain    = barEnd − serverNow        (counts down each second; rolls to tfSec at
 *                                          the boundary)
 *
 * `offsetSec = 0` (no tick learned yet) makes serverNow == local UTC — a safe fallback.
 */

import { TF_SECONDS } from './chartData';

/** The broker `serverNow` and the seconds `remain`ing to the next bar, given the local
 *  wall clock (s), the HELD broker offset (broker − local) and the timeframe. */
export function computeBarPhase(localNowSec: number, offsetSec: number, timeframe: number): {
  serverNow: number; remain: number; tfSec: number; barEnd: number;
} {
  const off = Number.isFinite(offsetSec) ? offsetSec : 0;
  const serverNow = localNowSec + off;
  const tfSec = TF_SECONDS[timeframe] ?? 3600;
  const barStart = Math.floor(serverNow / tfSec) * tfSec;
  const barEnd = barStart + tfSec;
  return { serverNow, remain: barEnd - serverNow, tfSec, barEnd };
}

/** mm:ss (or h:mm:ss past an hour) for the candle countdown. Never blanks: a value of
 *  0 renders "00:00", a negative (just-rolled / clock skew) clamps to 0. */
export function fmtCountdown(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${pad(m)}:${pad(ss)}`;
}
