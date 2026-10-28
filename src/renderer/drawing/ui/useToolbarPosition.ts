/**
 * useToolbarPosition — a tiny controlled-position + drag hook for the drawing
 * toolbar. The toolbar ships pinned at left-centre (index.html: `top:50%; left:8px;
 * transform:translateY(-50%)`). Once the user drags it, we switch to an explicit
 * `left/top` (and drop the centring transform), clamp it inside the chart pane, and
 * persist it in localStorage so it restores on next mount.
 *
 * Returns:
 *   - `pos`        — the custom `{left, top}` (px, pane-local) or null (use the CSS
 *                    default — left-centre);
 *   - `dragging`   — true while a drag is in flight (for the `.dragging` affordance);
 *   - `onGripDown` — a mousedown handler to wire onto the drag grip.
 *
 * It re-clamps on pane resize so the bar can't end up off-screen after a window
 * resize. All reads/writes are defensive (localStorage / JSON can throw).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface ToolbarPos { left: number; top: number; }

const STORAGE_KEY = 'ta.drawingToolbar.pos';
/** Keep at least this many px of the toolbar inside the pane on every edge. */
const EDGE_MARGIN = 4;

function readStored(): ToolbarPos | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<ToolbarPos>;
    if (typeof p?.left === 'number' && typeof p?.top === 'number' && Number.isFinite(p.left) && Number.isFinite(p.top)) {
      return { left: p.left, top: p.top };
    }
  } catch { /* corrupt / unavailable → fall back to the default position */ }
  return null;
}

function writeStored(pos: ToolbarPos): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(pos)); } catch { /* quota / unavailable — non-fatal */ }
}

/** Clamp a desired position so the toolbar stays inside the pane bounds. */
function clamp(pos: ToolbarPos, pane: HTMLElement | null, el: HTMLElement | null): ToolbarPos {
  if (!pane) return pos;
  const pw = pane.clientWidth;
  const ph = pane.clientHeight;
  const tw = el?.offsetWidth ?? 0;
  const th = el?.offsetHeight ?? 0;
  const maxLeft = Math.max(EDGE_MARGIN, pw - tw - EDGE_MARGIN);
  const maxTop = Math.max(EDGE_MARGIN, ph - th - EDGE_MARGIN);
  return {
    left: Math.min(Math.max(EDGE_MARGIN, pos.left), maxLeft),
    top: Math.min(Math.max(EDGE_MARGIN, pos.top), maxTop),
  };
}

export function useToolbarPosition(
  paneRef: React.RefObject<HTMLDivElement | null>,
  toolbarRef: React.RefObject<HTMLDivElement | null>,
  /** Ignore (and never persist) the stored drag position — used on the mobile tier, where
   *  the toolbar is pinned to its on-screen CSS default and there's no drag grip. Without
   *  this, a position dragged at tablet/desktop width strands the bar off a narrow phone. */
  ignoreStored = false,
): { pos: ToolbarPos | null; dragging: boolean; onGripDown: (e: React.MouseEvent) => void } {
  const [pos, setPos] = useState<ToolbarPos | null>(() => (ignoreStored ? null : readStored()));
  const [dragging, setDragging] = useState(false);
  // The grab offset (pointer → toolbar top-left) captured at mousedown.
  const grab = useRef<{ dx: number; dy: number } | null>(null);

  // Re-clamp on pane resize so a stored position can't strand the bar off-screen.
  useEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;
    const ro = new ResizeObserver(() => {
      setPos((cur) => (cur ? clamp(cur, paneRef.current, toolbarRef.current) : cur));
    });
    ro.observe(pane);
    return () => ro.disconnect();
  }, [paneRef, toolbarRef]);

  const onGripDown = useCallback((e: React.MouseEvent) => {
    if (ignoreStored || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const pane = paneRef.current;
    const el = toolbarRef.current;
    if (!pane || !el) return;
    const paneRect = pane.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    // pointer position relative to the toolbar's top-left
    grab.current = { dx: e.clientX - elRect.left, dy: e.clientY - elRect.top };
    setDragging(true);

    const onMove = (me: MouseEvent) => {
      if (!grab.current) return;
      const desired: ToolbarPos = {
        left: me.clientX - paneRect.left - grab.current.dx,
        top: me.clientY - paneRect.top - grab.current.dy,
      };
      setPos(clamp(desired, paneRef.current, toolbarRef.current));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('mouseup', onUp, true);
      grab.current = null;
      setDragging(false);
      setPos((cur) => { if (cur) writeStored(cur); return cur; });
    };
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('mouseup', onUp, true);
  }, [paneRef, toolbarRef, ignoreStored]);

  return { pos, dragging, onGripDown };
}
