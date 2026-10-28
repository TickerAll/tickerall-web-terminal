/**
 * Long / Short position — the TradingView "plan a trade on the chart" tool. A
 * position drawing carries THREE data anchors:
 *   - point[0] = ENTRY  (its time = the box's LEFT edge; its price = the entry)
 *   - point[1] = STOP   (its time = the box's RIGHT edge; its price = the SL)
 *   - point[2] = TARGET (its price = the TP; its time tracks point[1]'s right edge)
 *
 * It renders the classic two-zone box: a red RISK zone between entry and stop and a
 * green REWARD zone between entry and target, with labels for entry / SL / TP, the
 * price distances, the risk:reward ratio, and — when a trade context is supplied via
 * `env.trade` — the risk $ / reward $ and the position size in lots.
 *
 * The tool is placed with TWO clicks (entry, then stop); the overlay derives the
 * initial target as a 1:2 reward leg (see deriveInitialTarget) so a fresh position
 * already shows a sensible box. All three prices are then draggable handles. A long
 * and a short share all logic and differ only by which side is the reward.
 */

import {
  type DrawingTool, type HitResult, type ResolvedStyle, type RenderEnv, registerTool,
  drawHandle, dist2, roundRectPath, drawChip, HANDLE_GRAB,
} from './registry';
import type { PixelPoint, DataPoint } from '../CoordinateProjector';

/** Reward:risk used to seed the TARGET from the entry+stop on placement. */
export const DEFAULT_RR = 2;

/** Colours for the risk / reward zones (theme-independent — these reds/greens read
 *  the same on any chart background; alpha keeps candles visible underneath). */
const RISK_FILL = 'rgba(229,72,77,0.18)';
const RISK_LINE = 'rgba(229,72,77,0.9)';
const REWARD_FILL = 'rgba(48,164,108,0.18)';
const REWARD_LINE = 'rgba(48,164,108,0.9)';

/**
 * Given the placed entry + stop data points, derive the initial target so a freshly
 * placed long/short already shows a reward zone. For a long the target is above the
 * entry; for a short it's below — keyed off where the stop sits relative to entry.
 * Reward leg = DEFAULT_RR × the risk leg.
 */
export function deriveInitialTarget(entry: DataPoint, stop: DataPoint): DataPoint {
  const risk = entry.price - stop.price; // >0 when stop is below entry (a long)
  const targetPrice = entry.price + risk * DEFAULT_RR;
  return { time: stop.time, price: targetPrice };
}

/** Format a price to a sensible precision (more digits for sub-1 instruments). */
function fmtPrice(p: number): string {
  const abs = Math.abs(p);
  const digits = abs >= 100 ? 2 : abs >= 1 ? 3 : 5;
  return p.toFixed(digits);
}

/** The default risk fraction (1% of balance) when a drawing doesn't override it. */
export const DEFAULT_RISK_PCT = 0.01;

/** Compute the lots a trade would use given a per-point money value + the risk leg.
 *  Returns null when the context can't size it (no tickValue/point, zero risk).
 *  `riskPct` (fraction of balance, default 1%) comes from the drawing's style. */
function sizeLots(env: RenderEnv | undefined, entryPrice: number, stopPrice: number, riskPct: number): number | null {
  const t = env?.trade;
  if (!t || !t.tickValue || !t.point || !t.balance) return null;
  const points = Math.abs(entryPrice - stopPrice) / t.point;
  if (points <= 0) return null;
  // risk `riskPct` of balance → lots = riskMoney / (points × tickValue)
  const riskMoney = t.balance * riskPct;
  const perLot = points * t.tickValue;
  if (perLot <= 0) return null;
  return riskMoney / perLot;
}

/** Money risked/rewarded for `lots` over a price leg (|Δprice| / point × tickValue × lots). */
function legMoney(env: RenderEnv | undefined, fromPrice: number, toPrice: number, lots: number | null): number | null {
  const t = env?.trade;
  if (!t || !t.tickValue || !t.point || lots === null) return null;
  const points = Math.abs(toPrice - fromPrice) / t.point;
  return points * t.tickValue * lots;
}

function makePositionTool(kind: 'long-position' | 'short-position'): DrawingTool {
  return {
    kind,
    pointCount: 2, // placed with 2 clicks; the overlay appends the derived target

    render(ctx, pixels, style: ResolvedStyle, selected, env) {
      if (pixels.length < 3) return; // need entry+stop+target to draw the box
      const [entry, stop, target] = pixels as [PixelPoint, PixelPoint, PixelPoint];
      const xL = Math.min(entry.x, stop.x);
      const xR = Math.max(entry.x, stop.x);
      const w = Math.max(2, xR - xL);
      ctx.save();
      ctx.globalAlpha = style.opacity ?? 1;

      // Risk zone (entry → stop) and reward zone (entry → target).
      ctx.fillStyle = RISK_FILL;
      ctx.fillRect(xL, Math.min(entry.y, stop.y), w, Math.abs(stop.y - entry.y));
      ctx.fillStyle = REWARD_FILL;
      ctx.fillRect(xL, Math.min(entry.y, target.y), w, Math.abs(target.y - entry.y));

      // Borders for the three price lines.
      ctx.lineWidth = Math.max(1, style.width);
      ctx.setLineDash([]);
      const hline = (y: number, color: string) => { ctx.strokeStyle = color; ctx.beginPath(); ctx.moveTo(xL, y); ctx.lineTo(xR, y); ctx.stroke(); };
      hline(entry.y, style.color);
      hline(stop.y, RISK_LINE);
      hline(target.y, REWARD_LINE);
      // The outer box outline.
      ctx.strokeStyle = style.color;
      ctx.setLineDash([3, 3]);
      const top = Math.min(entry.y, stop.y, target.y);
      const bot = Math.max(entry.y, stop.y, target.y);
      roundRectPath(ctx, xL, top, w, bot - top, 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // ── labels ──────────────────────────────────────────────────────────────
      // Prices come from env (handle y → price); null when there's no projector
      // (e.g. a unit test rendering from bare pixels), in which case the labels
      // show just the field name and the R:R (derived from the pixel legs).
      const priceOf = (px: PixelPoint): number | null => (env?.priceAt ? env.priceAt(px.y) : null);
      const entryP = priceOf(entry);
      const stopP = priceOf(stop);
      const targetP = priceOf(target);

      const riskPct = (style.riskPct && style.riskPct > 0) ? style.riskPct : DEFAULT_RISK_PCT;
      const lots = (entryP !== null && stopP !== null) ? sizeLots(env, entryP, stopP, riskPct) : null;
      const riskMoney = (entryP !== null && stopP !== null) ? legMoney(env, entryP, stopP, lots) : null;
      const rewardMoney = (entryP !== null && targetP !== null) ? legMoney(env, entryP, targetP, lots) : null;

      // R:R from the pixel legs (works even without a projector — pixels are linear in price).
      const riskPx = Math.abs(stop.y - entry.y) || 1;
      const rewardPx = Math.abs(target.y - entry.y);
      const rr = rewardPx / riskPx;

      const at = (px: PixelPoint, text: string, color: string) =>
        drawChip(ctx, xL + 4, px.y, text, { bg: color, fg: '#ffffff', align: 'left', vAlign: 'middle', font: 10 });

      at(entry, entryP !== null ? `Entry ${fmtPrice(entryP)}` : 'Entry', style.color);
      at(target, targetP !== null ? `TP ${fmtPrice(targetP)}` : 'TP', REWARD_LINE);
      at(stop, stopP !== null ? `SL ${fmtPrice(stopP)}` : 'SL', RISK_LINE);

      // Summary chip (R:R + risk% + money + lots) centred at the box's right edge.
      const parts: string[] = [`R:R ${rr.toFixed(2)}`];
      parts.push(`${(riskPct * 100).toFixed(riskPct * 100 % 1 ? 1 : 0)}% risk`);
      if (lots !== null) parts.push(`${lots.toFixed(2)} lots`);
      if (riskMoney !== null && rewardMoney !== null) parts.push(`-$${riskMoney.toFixed(0)} / +$${rewardMoney.toFixed(0)}`);
      drawChip(ctx, xR - 4, top - 4, parts.join('  •  '), {
        bg: kind === 'long-position' ? REWARD_LINE : RISK_LINE, fg: '#ffffff', align: 'right', vAlign: 'bottom', font: 10,
      });

      if (selected) for (const p of [entry, stop, target]) drawHandle(ctx, p, style.color);
    },

    /** All three prices are draggable, plus the right-edge time via the stop handle. */
    handles(pixels) {
      return pixels.slice(0, 3);
    },

    hitTest(pixels, mouse, tol): HitResult {
      if (pixels.length < 3) return null;
      const grab2 = (HANDLE_GRAB + tol) * (HANDLE_GRAB + tol);
      for (let i = 0; i < 3; i++) if (dist2(mouse, pixels[i]!) <= grab2) return { kind: 'handle', index: i };
      const [entry, stop, target] = pixels as [PixelPoint, PixelPoint, PixelPoint];
      const xL = Math.min(entry.x, stop.x);
      const xR = Math.max(entry.x, stop.x);
      const top = Math.min(entry.y, stop.y, target.y);
      const bot = Math.max(entry.y, stop.y, target.y);
      // body = anywhere inside the box (it's a control surface, grab it to move).
      if (mouse.x >= xL - tol && mouse.x <= xR + tol && mouse.y >= top - tol && mouse.y <= bot + tol) return { kind: 'body' };
      return null;
    },
  };
}

export const longPositionTool = makePositionTool('long-position');
export const shortPositionTool = makePositionTool('short-position');

registerTool(longPositionTool);
registerTool(shortPositionTool);
