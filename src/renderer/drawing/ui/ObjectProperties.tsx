/**
 * ObjectProperties — the themed properties editor for a SINGLE drawing, covering
 * EVERY kind. It is the answer to "how do I change my object's colour" (and size,
 * style, opacity, fill, text, font, and — for the position planner — entry/SL/TP +
 * risk %). It is opened from the right-click "Properties…" item and on double-click
 * of any non-text object (text keeps its inline editor for the text itself, but the
 * panel is still reachable for its full styling).
 *
 * It reads the live drawing from the DrawingStore via `useSyncExternalStore`, so it
 * reflects external edits (drag, undo) and re-renders as the user changes values.
 * Every change is written through `store.setStyle` (style fields) or `store.replace`
 * (the position planner's anchor prices) — both are undo-tracked.
 *
 * Theme-aware: all colours are CSS vars; styling lives in the injected drawingChrome
 * stylesheet (`.dprops*`). It mounts into the pane (position:absolute) like the
 * context menu, and clamps itself on-screen.
 */

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { DrawingStore } from '../DrawingStore';
import type { DrawingStyle, LineStyle } from '../types';
import { FILLABLE_KINDS, isTextKind, isPositionKind } from '../types';
import { TOOL_META_BY_KIND } from '../tools';

interface Props {
  store: DrawingStore;
  /** The drawing being edited. */
  id: string;
  /** Position in PANE-local px (anchored near the right-click / dbl-click). */
  x: number;
  y: number;
  /** Pane bounds so the panel flips/clamps to stay on-screen. */
  bounds: { width: number; height: number };
  onClose: () => void;
}

/** Quick-pick stroke colours (literal hexes; `var(--accent)` first as theme default). */
const SWATCHES = ['var(--accent)', '#e5484d', '#30a46c', '#f5a623', '#a259ff', '#3aa6ff', '#e8e8ea', '#888c94'];
const WIDTHS = [1, 2, 3, 4, 6];
const LINE_STYLES: { v: LineStyle; label: string }[] = [
  { v: 'solid', label: 'Solid' },
  { v: 'dashed', label: 'Dashed' },
  { v: 'dotted', label: 'Dotted' },
];
/** A small curated font list for text labels. */
const FONTS: { v: string; label: string }[] = [
  { v: 'system-ui, sans-serif', label: 'System' },
  { v: 'Georgia, "Times New Roman", serif', label: 'Serif' },
  { v: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace', label: 'Monospace' },
  { v: 'Arial, Helvetica, sans-serif', label: 'Arial' },
  { v: '"Courier New", monospace', label: 'Courier' },
];
const FONT_SIZES = [10, 11, 13, 16, 20, 28, 40];

/** Resolve `var(--token)` → a literal hex for the native <input type=color>. */
function colorValue(c: string): string {
  const m = /^var\((--[a-z0-9-]+)\)$/i.exec(c.trim());
  if (!m) {
    if (/^#[0-9a-f]{6}$/i.test(c)) return c;
    return toHex(c);
  }
  if (typeof document !== 'undefined') {
    const v = getComputedStyle(document.documentElement).getPropertyValue(m[1]!).trim();
    if (v) return toHex(v);
  }
  return '#2f81f7';
}

/** Best-effort rgb()/#rgb/named → #rrggbb (the colour input needs a 6-digit hex). */
function toHex(c: string): string {
  const t = c.trim();
  if (/^#[0-9a-f]{6}$/i.test(t)) return t;
  const short = /^#([0-9a-f]{3})$/i.exec(t);
  if (short) { const h = short[1]!; return `#${h.split('').map((ch) => ch + ch).join('')}`; }
  const m = /^rgba?\(([^)]+)\)$/i.exec(t);
  if (m) {
    const [r, g, b] = m[1]!.split(',').map((s) => parseInt(s.trim(), 10));
    const h = (n: number) => Math.max(0, Math.min(255, n | 0)).toString(16).padStart(2, '0');
    return `#${h(r!)}${h(g!)}${h(b!)}`;
  }
  return '#2f81f7';
}

/** Format a price for the position inputs (digits scale with magnitude). */
function fmtPrice(p: number): string {
  const abs = Math.abs(p);
  const digits = abs >= 100 ? 2 : abs >= 1 ? 4 : 6;
  return Number(p.toFixed(digits)).toString();
}

export function ObjectProperties({ store, id, x, y, bounds, onClose }: Props) {
  // Live drawing — re-renders on any store mutation (our own edits + external).
  const drawing = useSyncExternalStore(store.subscribe, () => store.get(id));
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: x, top: y });

  // Clamp/flip after layout so the panel never spills past the pane edges.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = x;
    let top = y;
    if (left + w > bounds.width) left = Math.max(2, bounds.width - w - 2);
    if (top + h > bounds.height) top = Math.max(2, bounds.height - h - 2);
    if (left < 2) left = 2;
    if (top < 2) top = 2;
    setPos({ left, top });
  }, [x, y, bounds.width, bounds.height, drawing?.kind]);

  // Dismiss on Escape / outside pointer-down (but keep clicks inside, incl. the
  // native colour popups, alive).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onDown, true);
    };
  }, [onClose]);

  // The drawing vanished (deleted while open) → close.
  useEffect(() => { if (!drawing) onClose(); }, [drawing, onClose]);
  if (!drawing) return null;

  const d = drawing;
  const style = d.style;
  const meta = TOOL_META_BY_KIND[d.kind];
  const fillable = FILLABLE_KINDS.has(d.kind);
  const isText = isTextKind(d.kind);
  const isPos = isPositionKind(d.kind);

  // ── writers (all undo-tracked) ───────────────────────────────────────────────
  const setStyle = (patch: Partial<DrawingStyle>) => store.setStyle(id, { ...style, ...patch });
  /** Replace one anchor's price (position planner). Time is preserved. */
  const setPointPrice = (index: number, price: number) => {
    if (!Number.isFinite(price)) return;
    const points = d.points.map((p, i) => (i === index ? { ...p, price } : p));
    store.replace({ ...d, points });
  };

  const lineStyle = style.lineStyle ?? 'solid';
  const opacityPct = Math.round((style.opacity ?? 1) * 100);
  const fillOn = !!style.fill;
  const fillOpacityPct = Math.round((style.fillOpacity ?? 1) * 100);

  const title = isText
    ? (style.text && style.text.length ? `Text — ${style.text.slice(0, 18)}` : 'Text')
    : (meta?.label ?? d.kind);

  // Drag the panel by its header (clamped to the pane). Captured at grab for a clean
  // delta; the layout-clamp effect doesn't fire during a drag (x/y/bounds unchanged).
  const startDrag = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.dprops-x')) return; // not from the × button
    e.preventDefault();
    e.stopPropagation();
    const el = ref.current;
    const w = el?.offsetWidth ?? 0;
    const h = el?.offsetHeight ?? 0;
    const ox = pos.left, oy = pos.top, sx = e.clientX, sy = e.clientY;
    const onMove = (ev: MouseEvent) => {
      const left = Math.max(2, Math.min(ox + (ev.clientX - sx), bounds.width - w - 2));
      const top = Math.max(2, Math.min(oy + (ev.clientY - sy), bounds.height - h - 2));
      setPos({ left, top });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('mouseup', onUp, true);
      document.body.style.cursor = '';
    };
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('mouseup', onUp, true);
    document.body.style.cursor = 'grabbing';
  };

  return (
    <div
      ref={ref}
      className="dprops"
      style={{ left: pos.left, top: pos.top }}
      role="dialog"
      aria-label="Object properties"
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="dprops-head" onMouseDown={startDrag} style={{ cursor: 'grab' }}>
        <span className="dprops-ico" style={{ color: style.color.startsWith('var(') ? 'var(--accent)' : style.color }}>{meta?.icon ?? '•'}</span>
        <span className="dprops-title" title={title}>{title}</span>
        <button type="button" className="dprops-x" title="Close (Esc)" onClick={onClose}>✕</button>
      </div>

      <div className="dprops-body">
        {/* ── stroke colour (every kind) ─────────────────────────────────────── */}
        <Field label={isText ? 'Text colour' : 'Colour'}>
          <Swatches value={style.color} onPick={(c) => setStyle({ color: c })} />
        </Field>

        {/* ── line width (every kind) ────────────────────────────────────────── */}
        <Field label="Width">
          <div className="dprops-segs">
            {WIDTHS.map((w) => (
              <button
                key={w}
                type="button"
                className={`dprops-seg ${style.width === w ? 'on' : ''}`}
                title={`${w}px`}
                onClick={() => setStyle({ width: w })}
              ><span className="dprops-wbar" style={{ height: `${Math.min(w, 8)}px` }} /></button>
            ))}
          </div>
        </Field>

        {/* ── line style (every kind) ────────────────────────────────────────── */}
        <Field label="Line">
          <div className="dprops-segs">
            {LINE_STYLES.map((ls) => (
              <button
                key={ls.v}
                type="button"
                className={`dprops-seg dprops-seg-wide ${lineStyle === ls.v ? 'on' : ''}`}
                onClick={() => setStyle({ lineStyle: ls.v })}
              >{ls.label}</button>
            ))}
          </div>
        </Field>

        {/* ── opacity (every kind) ───────────────────────────────────────────── */}
        <Field label={`Opacity ${opacityPct}%`}>
          <input
            type="range" min={5} max={100} step={5} value={opacityPct}
            className="dprops-range"
            onChange={(e) => setStyle({ opacity: Number(e.target.value) / 100 })}
          />
        </Field>

        {/* ── fill (closed shapes + text background) ──────────────────────────── */}
        {fillable && (
          <>
            <div className="dprops-divider" />
            <Field label={isText ? 'Background' : 'Fill'}>
              <label className="dprops-toggle">
                <input
                  type="checkbox"
                  checked={fillOn}
                  onChange={(e) => setStyle({ fill: e.target.checked ? defaultFill(style.color) : undefined })}
                />
                <span>{fillOn ? 'On' : 'Off'}</span>
              </label>
            </Field>
            {fillOn && (
              <>
                <Field label="Fill colour">
                  <Swatches value={style.fill ?? 'var(--accent)'} onPick={(c) => setStyle({ fill: c })} />
                </Field>
                <Field label={`Fill opacity ${fillOpacityPct}%`}>
                  <input
                    type="range" min={0} max={100} step={5} value={fillOpacityPct}
                    className="dprops-range"
                    onChange={(e) => setStyle({ fillOpacity: Number(e.target.value) / 100 })}
                  />
                </Field>
              </>
            )}
          </>
        )}

        {/* ── text content + font (text/callout) ─────────────────────────────── */}
        {isText && (
          <>
            <div className="dprops-divider" />
            <Field label="Text">
              <textarea
                className="dprops-text"
                value={style.text ?? ''}
                placeholder="Label text…"
                rows={2}
                onChange={(e) => setStyle({ text: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } e.stopPropagation(); }}
              />
            </Field>
            <Field label="Font">
              <select
                className="dprops-select"
                value={matchFont(style.fontFamily)}
                onChange={(e) => setStyle({ fontFamily: e.target.value })}
              >
                {FONTS.map((f) => <option key={f.v} value={f.v}>{f.label}</option>)}
              </select>
            </Field>
            <Field label="Font size">
              <div className="dprops-row">
                <select
                  className="dprops-select dprops-select-sm"
                  value={FONT_SIZES.includes(style.fontSize ?? 13) ? (style.fontSize ?? 13) : 0}
                  onChange={(e) => { const v = Number(e.target.value); if (v) setStyle({ fontSize: v }); }}
                >
                  {!FONT_SIZES.includes(style.fontSize ?? 13) && <option value={0}>{style.fontSize ?? 13}px</option>}
                  {FONT_SIZES.map((s) => <option key={s} value={s}>{s}px</option>)}
                </select>
                <input
                  type="number" min={6} max={200} step={1}
                  className="dprops-num"
                  value={style.fontSize ?? 13}
                  onChange={(e) => { const v = Number(e.target.value); if (v >= 6) setStyle({ fontSize: v }); }}
                />
              </div>
            </Field>
          </>
        )}

        {/* ── position planner: entry / SL / TP + risk% ───────────────────────── */}
        {isPos && d.points.length >= 3 && (
          <>
            <div className="dprops-divider" />
            <PriceField label="Entry" value={d.points[0]!.price} onCommit={(v) => setPointPrice(0, v)} />
            <PriceField label="Stop loss" value={d.points[1]!.price} onCommit={(v) => setPointPrice(1, v)} />
            <PriceField label="Take profit" value={d.points[2]!.price} onCommit={(v) => setPointPrice(2, v)} />
            <Field label="Risk %">
              <input
                type="number" min={0.1} max={100} step={0.1}
                className="dprops-num"
                value={Number((((style.riskPct ?? 0.01) * 100)).toFixed(2))}
                onChange={(e) => { const v = Number(e.target.value); if (v > 0) setStyle({ riskPct: v / 100 }); }}
              />
            </Field>
          </>
        )}

        {/* ── lock / hide (every kind) ───────────────────────────────────────── */}
        <div className="dprops-divider" />
        <div className="dprops-flags">
          <label className="dprops-toggle">
            <input type="checkbox" checked={!!d.locked} onChange={(e) => store.setLocked(id, e.target.checked)} />
            <span>🔒 Locked</span>
          </label>
          <label className="dprops-toggle">
            <input type="checkbox" checked={!!d.hidden} onChange={(e) => store.setHidden(id, e.target.checked)} />
            <span>🚫 Hidden</span>
          </label>
        </div>
      </div>
    </div>
  );
}

/** A labelled row. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="dprops-field">
      <span className="dprops-flabel">{label}</span>
      <div className="dprops-fctl">{children}</div>
    </div>
  );
}

/** A colour swatch strip + a native colour input for arbitrary colours. */
function Swatches({ value, onPick }: { value: string; onPick: (c: string) => void }) {
  return (
    <div className="dprops-swatches">
      {SWATCHES.map((c) => (
        <button
          key={c}
          type="button"
          className={`dprops-swatch ${value === c ? 'on' : ''}`}
          style={{ background: c }}
          title={c.startsWith('var(') ? 'Theme accent' : c}
          onClick={() => onPick(c)}
        />
      ))}
      <label className="dprops-swatch dprops-swatch-custom" title="Custom colour…">
        <input type="color" value={colorValue(value)} onChange={(e) => onPick(e.target.value)} />
      </label>
    </div>
  );
}

/** A price input that commits on blur / Enter (so partially-typed values don't churn
 *  the drawing each keystroke). Seeds from `value`; re-seeds when `value` changes
 *  externally (e.g. a drag) and the field isn't focused. */
function PriceField({ label, value, onCommit }: { label: string; value: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(() => fmtPrice(value));
  const focused = useRef(false);
  // Re-seed from the live value when not actively editing (drag / undo updates it).
  useEffect(() => { if (!focused.current) setText(fmtPrice(value)); }, [value]);
  const commit = () => {
    const v = parseFloat(text);
    if (Number.isFinite(v)) onCommit(v);
    else setText(fmtPrice(value));
  };
  return (
    <Field label={label}>
      <input
        type="number"
        step="any"
        className="dprops-num dprops-num-wide"
        value={text}
        onFocus={() => { focused.current = true; }}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => { focused.current = false; commit(); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          else if (e.key === 'Escape') { e.preventDefault(); setText(fmtPrice(value)); (e.target as HTMLInputElement).blur(); }
          e.stopPropagation();
        }}
      />
    </Field>
  );
}

/** A sensible default fill (a translucent version of the stroke colour, falling back
 *  to a translucent accent). Used when the user flips Fill on. */
function defaultFill(strokeColor: string): string {
  if (strokeColor.startsWith('var(')) return 'rgba(47,129,247,0.18)';
  const hex = toHex(strokeColor);
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},0.18)`;
}

/** Map a stored fontFamily back to one of the curated options (so the <select> shows
 *  the right entry); unknown families fall back to the first (System). */
function matchFont(family?: string): string {
  if (!family) return FONTS[0]!.v;
  const hit = FONTS.find((f) => f.v === family);
  return hit ? hit.v : FONTS[0]!.v;
}
