/**
 * Magnet (snap-to-OHLC) — when the user places or drags a point near a bar's open /
 * high / low / close, snap the anchor onto that exact price+time. This is what makes
 * a trendline land cleanly on a candle wick instead of a fraction of a pixel off.
 *
 * It's a PURE function of (pixel point, projector, bars, radius): it projects the
 * candidate bars' O/H/L/C to pixels, finds the nearest within `radius` px of the
 * cursor, and returns that data point — or null when nothing is close (the caller
 * then uses the raw unprojected point). Kept out of the overlay so it's unit-tested
 * against a synthetic projector with no chart.
 *
 * Performance: only the handful of bars whose x is within ~`radius` of the cursor
 * are considered (found by binary-searching the cursor's logical index), so this is
 * cheap even on a deep history buffer.
 */

import type { ChartBar } from '../../shared/types';
import type { CoordinateProjector, DataPoint, PixelPoint } from './CoordinateProjector';

/** A magnet candidate: the snapped data point + which field it came from + its
 *  pixel + the pixel distance to the cursor (for the caller / tests). */
export interface MagnetHit {
  point: DataPoint;
  field: 'open' | 'high' | 'low' | 'close';
  pixel: PixelPoint;
  dist: number;
}

/**
 * Find the nearest O/H/L/C anchor within `radius` px of `cursor`. Returns the
 * snapped data point (time = the bar's time, price = the field's price) or null.
 */
export function snapToOHLC(
  cursor: PixelPoint,
  projector: CoordinateProjector,
  bars: ChartBar[],
  radius: number,
): MagnetHit | null {
  if (bars.length === 0 || radius <= 0) return null;

  // Which bars are near the cursor's x? Convert the cursor x → logical index via the
  // projector's unproject (time) then back to an index, and scan a small window.
  const at = projector.unproject(cursor);
  if (!at) return null;
  const centreIdx = projector.timeToLogical(at.time);
  if (centreIdx === null) return null;

  // A window of bars around the cursor. The window need only be a few bars wide —
  // anything whose x is > radius away can't snap. Use a generous ±4 plus a radius-
  // derived span so a zoomed-out chart (many bars/px) still catches neighbours.
  const span = Math.max(4, Math.ceil(radius));
  const lo = Math.max(0, Math.floor(centreIdx) - span);
  const hi = Math.min(bars.length - 1, Math.ceil(centreIdx) + span);

  let best: MagnetHit | null = null;
  const r2 = radius * radius;
  const FIELDS: MagnetHit['field'][] = ['open', 'high', 'low', 'close'];
  for (let i = lo; i <= hi; i++) {
    const bar = bars[i]!;
    for (const field of FIELDS) {
      const price = bar[field];
      const pr = projector.project({ time: bar.time, price });
      if (!pr) continue;
      const dx = pr.x - cursor.x;
      const dy = pr.y - cursor.y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= r2 && (best === null || d2 < best.dist * best.dist)) {
        best = { point: { time: bar.time, price }, field, pixel: { x: pr.x, y: pr.y }, dist: Math.sqrt(d2) };
      }
    }
  }
  return best;
}
