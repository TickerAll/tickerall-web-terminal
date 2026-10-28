/**
 * DrawingToolbar — the vertical, theme-aware tool picker that replaces the slice's
 * temporary "Trendline" chip. It arms a tool (via `setActiveTool`), exposes a
 * Select/Escape mode (the cursor), a dedicated Measure tool, a magnet toggle,
 * undo/redo, and (when something is selected) a compact style row that writes the
 * selected drawings' DrawingStyle. It can also collapse to a small floating "show
 * tools" button (state persisted in localStorage).
 *
 * It is theme-aware: every colour comes from a CSS var so it re-skins with the
 * terminal theme. It owns NO drawing state — it reads/writes the shared DrawingStore
 * and reports the armed tool + active style up to its parent (DrawingLayer).
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DrawingStore } from '../DrawingStore';
import type { DrawingKind, DrawingStyle, LineStyle } from '../types';
import { FILLABLE_KINDS } from '../types';
import { TOOL_META } from '../tools';
import { useSelectedSet, useHistoryState, useDrawingList } from './useDrawings';
import { StyleRow } from './StyleRow';
import { ensureDrawingChrome } from './drawingChrome';
import { useToolbarPosition } from './useToolbarPosition';

interface Props {
  store: DrawingStore;
  /** The pane the toolbar lives in — used to clamp the drag within the chart. */
  paneRef: React.RefObject<HTMLDivElement | null>;
  /** The currently-armed tool (null = select mode). */
  activeTool: DrawingKind | null;
  setActiveTool: (k: DrawingKind | null) => void;
  /** The style new drawings take; the style row writes here AND onto the selection. */
  style: DrawingStyle;
  setStyle: (s: DrawingStyle) => void;
  /** Magnet (snap-to-OHLC) on/off. */
  magnet: boolean;
  setMagnet: (v: boolean) => void;
  /** Toggle the object-manager panel. */
  managerOpen: boolean;
  setManagerOpen: (v: boolean) => void;
}

/** localStorage key for the collapsed (hidden) toolbar state (Task 3). */
const COLLAPSE_KEY = 'tat.drawingToolbar.collapsed';

function readCollapsed(): boolean {
  try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
}
function writeCollapsed(v: boolean): void {
  try { localStorage.setItem(COLLAPSE_KEY, v ? '1' : '0'); } catch { /* ignore */ }
}

/** The emoji-picker palette — shown when the emoji tool is armed. A compact set of
 *  trading-relevant reactions/markers; clicking one sets the glyph the next placement
 *  stamps (and restyles any selected emoji). */
const EMOJI_PALETTE = ['🚀', '🔥', '💎', '📈', '📉', '💰', '🐂', '🐻', '🎯', '⭐', '⚠️', '✅', '❌', '❗', '🔔', '👀', '🤔', '😎', '😱', '🤑', '💡', '🛑', '⏰', '🙏'];

export function DrawingToolbar({
  store, paneRef, activeTool, setActiveTool, style, setStyle, magnet, setMagnet, managerOpen, setManagerOpen,
}: Props) {
  const selected = useSelectedSet(store);
  const { canUndo, canRedo } = useHistoryState(store);
  const list = useDrawingList(store);
  const hasSelection = selected.size > 0;

  // On the mobile tier the toolbar is revealed by a press-and-hold and dismissed by the
  // ✓ Done button — there is no collapse affordance or drag grip (both hidden in CSS).
  // So on mobile we IGNORE the persisted collapsed/position state entirely: otherwise a
  // prior collapse (the floating ✎) or a tablet/desktop-width drag would hide the bar or
  // strand it off a narrow phone with no way back (the reported "tap pencil → gone" bug).
  const isMobile = typeof document !== 'undefined'
    && document.getElementById('mt5')?.getAttribute('data-tier') === 'mobile';

  // Collapsed (hidden) state — persisted so it survives reloads (Task 3). Forced off on mobile.
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed);
  const toggleCollapsed = (v: boolean) => { setCollapsed(v); writeCollapsed(v); };

  // Inject the chrome override (bigger icons + grip styling) once, on first mount.
  useEffect(() => { ensureDrawingChrome(); }, []);

  // Draggable position (persisted in localStorage). `pos === null` → the CSS default
  // (left-centre). A custom pos drops the centring transform via an inline style.
  const toolbarRef = useRef<HTMLDivElement>(null);
  const { pos, dragging, onGripDown } = useToolbarPosition(paneRef, toolbarRef, isMobile);

  // Emoji picker as its OWN flyout SUBMENU (not stacked in the vertical toolbar). The
  // toolbar's overflow-y:auto forces overflow-x to compute as auto too, which would clip an
  // in-toolbar flyout — so we render it `position:fixed` (viewport-anchored, escapes the
  // overflow) next to the emoji button, recomputed when armed / the toolbar moves.
  const emojiBtnRef = useRef<HTMLButtonElement>(null);
  const [emojiFlyout, setEmojiFlyout] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (activeTool !== 'emoji') { setEmojiFlyout(null); return; }
    const b = emojiBtnRef.current;
    if (!b) return;
    const r = b.getBoundingClientRect();
    setEmojiFlyout({ left: r.right + 8, top: r.top });
  }, [activeTool, pos, dragging, collapsed]);

  // Whether the WHOLE selection is locked — drives the toolbar lock toggle's state.
  const allLocked = hasSelection && [...selected].every((id) => !!store.get(id)?.locked);

  // Group the tools for subtle separators (lines / shapes / patterns / fib / trade / text).
  const groups = useMemo(() => {
    const out: { group: string; tools: typeof TOOL_META }[] = [];
    for (const m of TOOL_META) {
      const last = out[out.length - 1];
      if (last && last.group === m.group) last.tools.push(m);
      else out.push({ group: m.group, tools: [m] });
    }
    return out;
  }, []);

  // Apply a style change to every selected drawing AND make it the new default.
  const applyStyle = (next: DrawingStyle) => {
    setStyle(next);
    for (const id of selected) store.setStyle(id, next);
  };

  // When a custom position is set, switch to explicit left/top and cancel the
  // default vertical centring (index.html's `top:50%; transform:translateY(-50%)`).
  const posStyle: React.CSSProperties | undefined = pos
    ? { left: pos.left, top: pos.top, transform: 'none' }
    : undefined;

  // Collapsed → render only a small floating "show tools" button (Task 3). It sits
  // where the toolbar's grip would be (top-left of the pane) so it's predictable.
  // Never on mobile (the floating ✎ is hidden there and would strand the toolbar).
  if (collapsed && !isMobile) {
    return (
      <button
        type="button"
        className="dtb-show"
        title="Show drawing tools"
        aria-label="Show drawing tools"
        onClick={() => toggleCollapsed(false)}
      >
        <span className="dtb-show-ico">✎</span>
        <span className="dtb-show-chev">›</span>
      </button>
    );
  }

  return (
    <>
    <div
      ref={toolbarRef}
      className={`dtb ${dragging ? 'dragging' : ''}`}
      style={posStyle}
      role="toolbar"
      aria-label="Drawing tools"
    >
      {/* header: drag grip (grab to reposition) + collapse chevron (Task 3) */}
      <div className="dtb-head">
        <div className="dtb-grip" title="Drag to move toolbar" onMouseDown={onGripDown} aria-label="Move toolbar">⋮⋮</div>
        <button
          type="button"
          className="dtb-collapse"
          title="Hide drawing tools"
          aria-label="Hide drawing tools"
          onClick={() => toggleCollapsed(true)}
        >‹</button>
      </div>

      {/* ── Select + Measure: the cursor modes, made obvious + first (Tasks 10, 11) ── */}
      <button
        type="button"
        className={`dtb-btn ${activeTool === null ? 'on' : ''}`}
        title="Select / move objects — the default cursor (Esc)"
        aria-label="Select"
        onClick={() => setActiveTool(null)}
      >
        <span className="dtb-ico dtb-ico-cursor" aria-hidden>↖</span>
      </button>
      <button
        type="button"
        className={`dtb-btn ${activeTool === 'measure' ? 'on' : ''}`}
        title="Measure — drag to read Δprice / % / bars / position size"
        aria-label="Measure"
        onClick={() => setActiveTool(activeTool === 'measure' ? null : 'measure')}
      >
        <span className="dtb-ico" aria-hidden>📏</span>
      </button>
      <div className="dtb-sep" />

      {groups.map((g, gi) => (
        <div className={`dtb-group dtb-group-${g.group}`} key={g.group}>
          {g.tools.map((m) => (
            <button
              key={m.kind}
              ref={m.kind === 'emoji' ? emojiBtnRef : undefined}
              type="button"
              className={`dtb-btn dtb-btn-${m.kind} ${activeTool === m.kind ? 'on' : ''}`}
              title={`${m.label}${m.hotkey ? ` (${m.hotkey.toUpperCase()})` : ''}`}
              aria-label={m.label}
              onClick={() => setActiveTool(activeTool === m.kind ? null : m.kind)}
            >
              <span className="dtb-ico" aria-hidden>{m.icon}</span>
            </button>
          ))}
          {gi < groups.length - 1 && <div className="dtb-sep" />}
        </div>
      ))}

      <div className="dtb-sep" />
      {/* magnet toggle */}
      <button
        type="button"
        className={`dtb-btn ${magnet ? 'on' : ''}`}
        title={`Magnet: snap to candle O/H/L/C — ${magnet ? 'on' : 'off'}`}
        onClick={() => setMagnet(!magnet)}
      >
        <span className="dtb-ico">🧲</span>
      </button>
      {/* object manager toggle */}
      <button
        type="button"
        className={`dtb-btn ${managerOpen ? 'on' : ''}`}
        title="Objects (manager)"
        onClick={() => setManagerOpen(!managerOpen)}
      >
        <span className="dtb-ico">☰</span>
      </button>
      {/* lock / unlock the current selection (frozen geometry — can't drag or delete) */}
      {hasSelection && (
        <button
          type="button"
          className={`dtb-btn ${allLocked ? 'on' : ''}`}
          title={allLocked ? 'Unlock selection' : 'Lock selection'}
          onClick={() => { const lock = !allLocked; for (const id of selected) store.setLocked(id, lock); }}
        >
          <span className="dtb-ico">{allLocked ? '🔒' : '🔓'}</span>
        </button>
      )}

      <div className="dtb-sep" />
      {/* undo / redo */}
      <button type="button" className="dtb-btn" title="Undo (Ctrl/Cmd+Z)" disabled={!canUndo} onClick={() => store.undo()}>
        <span className="dtb-ico">↶</span>
      </button>
      <button type="button" className="dtb-btn" title="Redo (Shift+Ctrl/Cmd+Z)" disabled={!canRedo} onClick={() => store.redo()}>
        <span className="dtb-ico">↷</span>
      </button>
      {/* delete selection / all */}
      <button
        type="button"
        className="dtb-btn"
        title={hasSelection ? 'Delete selected (Del)' : 'Delete all drawings'}
        disabled={list.length === 0}
        onClick={() => (hasSelection ? store.removeMany([...selected]) : store.clear())}
      >
        <span className="dtb-ico">🗑</span>
      </button>

      {/* style row — appears when a tool is armed OR something is selected, so you can
          set the colour/width/line-style before drawing or restyle the selection. */}
      {(activeTool !== null || hasSelection) && (
        <StyleRow
          style={style}
          onChange={applyStyle}
          showFill={styleHasFill(activeTool, store, selected)}
        />
      )}
    </div>

    {/* Emoji palette — its OWN flyout SUBMENU, rendered OUTSIDE the toolbar div (so the
        toolbar's overflow + transform never clip it), position:fixed beside the emoji button. */}
    {activeTool === 'emoji' && emojiFlyout && (
      <div
        className="dtb-emoji-flyout"
        role="menu"
        aria-label="Emoji palette"
        style={{
          position: 'fixed', left: emojiFlyout.left, top: emojiFlyout.top, zIndex: 30,
          display: 'flex', flexWrap: 'wrap', gap: 3, width: 188, padding: 7,
          background: 'var(--panel)', border: '1px solid var(--line2)', borderRadius: 9,
          boxShadow: '0 10px 30px var(--shadow)',
        }}
      >
        {EMOJI_PALETTE.map((ch) => (
          <button
            key={ch}
            type="button"
            title={`Place ${ch}`}
            onClick={() => applyStyle({ ...style, emoji: ch })}
            style={{
              width: 28, height: 28, fontSize: 17, lineHeight: '26px', padding: 0, cursor: 'pointer',
              borderRadius: 6,
              background: style.emoji === ch ? 'var(--hover)' : 'transparent',
              border: style.emoji === ch ? '1px solid var(--accent)' : '1px solid var(--line)',
            }}
          >{ch}</button>
        ))}
      </div>
    )}
    </>
  );
}

/** Whether the style row should expose a fill control. Only the kinds whose renderer
 *  actually reads `style.fill` (the truly closed shapes) qualify — fib bands + the
 *  pattern polylines draw with the stroke colour, not a fill. */
export function styleHasFill(activeTool: DrawingKind | null, store: DrawingStore, selected: Set<string>): boolean {
  if (activeTool && FILLABLE_KINDS.has(activeTool)) return true;
  for (const id of selected) { const k = store.get(id)?.kind; if (k && FILLABLE_KINDS.has(k)) return true; }
  return false;
}

/** Re-export for callers that want the named line styles. */
export type { LineStyle };
