/**
 * MicroTickChart (#7, #16) — a small LIVE tick mini-chart for the New Order dialog. It
 * accumulates the live price (re-rendered per tick via the quote prop) into a short rolling
 * buffer of {price, time} and paints it on a canvas as a proper mini-chart: an autoscaled
 * line + a PRICE axis (y, right) + a TIME axis (x, bottom), so you can read the micro-
 * structure you're about to trade into. Real ticks only; nothing smoothed.
 *
 * Hand-rolled canvas (not lightweight-charts): ~240 points, one stroke + faint fill + a few
 * axis labels, redrawn per tick — far lighter than a full chart instance. Height is a
 * continuous px value (the dialog's drag-to-resize grip sets + persists it). Clears when the
 * symbol changes.
 */

import { useEffect, useRef } from 'react';

const CAP = 240; // rolling buffer length

// Drag-resize bounds (px) for the chart height; the dialog persists the chosen value.
export const TICK_MIN_H = 56;
export const TICK_MAX_H = 280;
export const TICK_DEFAULT_H = 96;

/** Read a theme CSS var off the element, with a fallback. */
function cssVar(el: HTMLElement, name: string, fallback: string): string {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}

/** Compact price for a y-axis label — digits scale with magnitude. */
function fmtAxisPrice(p: number): string {
  const a = Math.abs(p);
  const d = a >= 1000 ? 2 : a >= 1 ? 4 : 5;
  return p.toFixed(d);
}

/** HH:MM:SS for an x-axis time label. */
function fmtAxisTime(ms: number): string {
  const dt = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(dt.getHours())}:${p(dt.getMinutes())}:${p(dt.getSeconds())}`;
}

export function MicroTickChart({ symbol, price, height = TICK_DEFAULT_H }: {
  symbol: string;
  price: number | null;
  /** Continuous chart height in px (set by the dialog's drag-to-resize grip). */
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const buf = useRef<{ p: number; t: number }[]>([]);

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (w === 0 || h === 0) return; // not laid out yet — the next tick repaints
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const b = buf.current;
    if (b.length < 2) return;

    // Plot area, leaving gutters for the axis labels (price right, time bottom).
    const padL = 5, padT = 6, padR = 52, padB = 15;
    const plotW = w - padL - padR, plotH = h - padT - padB;
    if (plotW <= 4 || plotH <= 4) return;

    // Price autoscale: pad the data band so the line nearly fills the height (micro-moves big).
    let dMin = Infinity, dMax = -Infinity;
    for (const pt of b) { if (pt.p < dMin) dMin = pt.p; if (pt.p > dMax) dMax = pt.p; }
    const span = dMax - dMin;
    const pad = span > 0 ? span * 0.14 : (Math.abs(dMax) * 1e-5 || 1);
    const min = dMin - pad, max = dMax + pad, range = max - min || 1;
    // x is index-based (a smooth step per tick); the x-axis labels carry the real times.
    const px = (i: number) => padL + (i / (b.length - 1)) * plotW;
    const py = (p: number) => padT + (1 - (p - min) / range) * plotH;

    const fg = cssVar(canvas, '--fg', '#cccccc');
    const muted = cssVar(canvas, '--muted', '#888888');
    const lineC = cssVar(canvas, '--line', '#222222');
    const up = b[b.length - 1]!.p >= b[0]!.p;
    const color = up ? cssVar(canvas, '--up', '#26a69a') : cssVar(canvas, '--down', '#ef5350');

    // Horizontal gridlines at the plot's top / mid / bottom.
    ctx.strokeStyle = lineC; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    for (const f of [0, 0.5, 1]) { const yy = Math.round(padT + f * plotH) + 0.5; ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(padL + plotW, yy); ctx.stroke(); }
    // Vertical axis line at the right of the plot.
    ctx.beginPath(); ctx.moveTo(padL + plotW + 0.5, padT); ctx.lineTo(padL + plotW + 0.5, padT + plotH); ctx.stroke();
    ctx.setLineDash([]);

    // Area fill under the line.
    ctx.beginPath();
    ctx.moveTo(px(0), py(b[0]!.p));
    for (let i = 1; i < b.length; i++) ctx.lineTo(px(i), py(b[i]!.p));
    ctx.lineTo(px(b.length - 1), padT + plotH); ctx.lineTo(px(0), padT + plotH); ctx.closePath();
    ctx.globalAlpha = 0.08; ctx.fillStyle = color; ctx.fill(); ctx.globalAlpha = 1;

    // The line.
    ctx.beginPath();
    ctx.moveTo(px(0), py(b[0]!.p));
    for (let i = 1; i < b.length; i++) ctx.lineTo(px(i), py(b[i]!.p));
    ctx.lineWidth = 1.5; ctx.strokeStyle = color; ctx.lineJoin = 'round'; ctx.stroke();

    // Last-price dot.
    const last = b[b.length - 1]!;
    ctx.beginPath(); ctx.arc(px(b.length - 1), py(last.p), 2.4, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();

    // ── axis labels ──────────────────────────────────────────────────────────────
    ctx.font = '9px ui-monospace, "SF Mono", Menlo, monospace';
    ctx.textAlign = 'left';
    // Price (y): data max at the top, data min at the bottom, + the live price by the dot.
    ctx.fillStyle = muted; ctx.textBaseline = 'top';
    ctx.fillText(fmtAxisPrice(dMax), padL + plotW + 5, padT);
    ctx.textBaseline = 'bottom';
    ctx.fillText(fmtAxisPrice(dMin), padL + plotW + 5, padT + plotH);
    ctx.fillStyle = color; ctx.textBaseline = 'middle';
    const lastY = Math.max(padT + 6, Math.min(padT + plotH - 6, py(last.p)));
    ctx.fillText(fmtAxisPrice(last.p), padL + plotW + 5, lastY);
    // Time (x): first tick time at the left, last at the right.
    ctx.fillStyle = muted; ctx.textBaseline = 'bottom';
    ctx.textAlign = 'left'; ctx.fillText(fmtAxisTime(b[0]!.t), padL, h - 2);
    ctx.textAlign = 'right'; ctx.fillText(fmtAxisTime(last.t), padL + plotW, h - 2);
    // (mid time only when the chart is tall enough to have room.)
    if (height >= 130 && b.length > 4) {
      const midI = Math.floor((b.length - 1) / 2);
      ctx.textAlign = 'center'; ctx.fillText(fmtAxisTime(b[midI]!.t), padL + plotW / 2, h - 2);
    }
    void fg;
  };

  // New symbol → fresh buffer (never mix two symbols' prices).
  useEffect(() => { buf.current = []; draw(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [symbol]);

  // Each new price (a tick) → append {price, now} + repaint. The effect only fires when
  // `price` actually changes value, so repeated-identical prices don't add flat points.
  useEffect(() => {
    if (price == null || !Number.isFinite(price)) return;
    const b = buf.current;
    b.push({ p: price, t: Date.now() });
    if (b.length > CAP) b.splice(0, b.length - CAP);
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [price]);

  // Repaint on a height change (the canvas box resizes; redraw to the new dimensions).
  useEffect(() => { draw(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [height]);

  return (
    <div className="micro-tick-wrap" style={{ height }}>
      <canvas ref={canvasRef} className="micro-tick" />
      {price == null && <span className="micro-tick-empty">waiting for ticks…</span>}
    </div>
  );
}
