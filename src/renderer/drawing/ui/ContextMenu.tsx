/**
 * ContextMenu — a themed, positioned popup for the drawing engine's right-click
 * menu. It is intentionally dumb: it renders an array of items (label + action, or a
 * separator) at a screen position and closes on any outside click / Escape / item
 * pick. The CanvasOverlay builds the item list (object actions vs chart actions) and
 * owns when/where it opens; this component just paints + dismisses.
 *
 * It mounts into the pane (position:absolute within `.chart-pane`), so it scrolls /
 * clips with the chart and inherits the theme CSS vars. Styling lives in the injected
 * drawingChrome stylesheet (`.dctx*`).
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/** One menu entry: an actionable item, or a visual separator. */
export type ContextMenuItem =
  | { kind: 'item'; label: string; icon?: string; onClick: () => void; danger?: boolean; disabled?: boolean }
  | { kind: 'sep' };

interface Props {
  /** Position in PANE-local px (the overlay converts the click to this). */
  x: number;
  y: number;
  /** Pane bounds so the menu flips/clamps to stay on-screen. */
  bounds: { width: number; height: number };
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, bounds, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: x, top: y });

  // Clamp/flip after layout so the menu never spills past the pane edges.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = x;
    let top = y;
    if (left + w > bounds.width) left = Math.max(2, x - w);
    if (top + h > bounds.height) top = Math.max(2, bounds.height - h - 2);
    setPos({ left, top });
  }, [x, y, bounds.width, bounds.height]);

  // Dismiss on outside pointerdown / Escape / scroll-wheel (any chart interaction).
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onWheel = () => onClose();
    // capture so we see it before the canvas/chart handlers.
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('wheel', onWheel, true);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('wheel', onWheel, true);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="dctx"
      style={{ left: pos.left, top: pos.top }}
      role="menu"
      // Stop the menu's own clicks from bubbling to the pane (which would deselect / re-open).
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) =>
        it.kind === 'sep' ? (
          <div className="dctx-sep" key={`s${i}`} />
        ) : (
          <button
            key={`i${i}`}
            type="button"
            role="menuitem"
            className={`dctx-item ${it.danger ? 'danger' : ''}`}
            disabled={it.disabled}
            onClick={() => { if (!it.disabled) { it.onClick(); onClose(); } }}
          >
            <span className="dctx-ico">{it.icon ?? ''}</span>
            <span className="dctx-label">{it.label}</span>
          </button>
        ),
      )}
    </div>
  );
}
