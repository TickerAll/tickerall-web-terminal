/**
 * ChartMosaic — a TradingView/golden-layout style DRAG-TO-DOCK split layout for charts.
 * It renders the pure split TREE from `mosaic.ts` (a recursive nesting of `split` nodes
 * and `leaf` charts) and drives the tree's pure ops on two gestures:
 *   - drag a DIVIDER between a split's two children → resize that split (setSplit by path);
 *   - drag a chart's HEADER (or a symbol TAB from the tab bar) onto another chart's EDGE
 *     → dock it there, splitting the target on that side (moveLeaf).
 *
 * It owns NO layout state: the shell (Terminal) holds the tree and passes `onChange` with
 * the NEW tree after every drop/resize; ChartMosaic only computes the next tree via the
 * pure ops and hands it back. The gestures use input systems chosen to be reliable:
 *   - the divider resize uses pointer events (pointer drag → setSplit);
 *   - the chart HEADER dock uses ONE custom pointer-drag flow for BOTH mouse and touch
 *     (a drag past a small threshold sets `dragSourceId`; an effect then lights the dock
 *     zones, tracks the pointer via elementFromPoint, and commits moveLeaf on release).
 *     Native HTML5 DnD is NOT used for the header: on desktop its drop phase proved
 *     unreliable over the chart canvas (dragstart fired but the drop never committed), and
 *     on touch it never commits at all — the custom flow behaves identically on both.
 *   - the strip TAB (in the toolbar, outside the mosaic) still uses HTML5 DnD on desktop
 *     (the shared `application/x-chart-tab` payload the leaf drop handler reads), and the
 *     same custom pointer-drag on touch.
 *
 * Chrome reuses the themed `.chart-cell*` classes from index.html (shared with ChartGrid);
 * only the NEW mosaic structural classes are injected once into <head> (mirroring
 * chartChromeStyle.ensureChartChromeStyle). Everything is theme-`--var` driven.
 */

import { useEffect, useRef, useState } from 'react';
import { TF_LABEL } from '../../shared/types';
import type { ChartTab } from './ChartTabs';
import { moveLeaf, moveLeafToRoot, setSplit, type MosaicLayout, type MosaicNode, type Side } from './mosaic';

/** The drag payload key the header (here) AND the symbol tab bar both set, so a tab
 *  dragged out of the strip docks through the same drop handler as a chart header. */
const DND_KEY = 'application/x-chart-tab';

// ── injected CSS (once) ─────────────────────────────────────────────────────────────
// Only the NEW mosaic structural classes; the `.chart-cell*` chrome lives in index.html.
const STYLE_ID = 'chart-mosaic';
const CSS = `
.mosaic { position:relative; flex:1 1 0; min-width:0; min-height:0; display:flex; background:var(--bg); }
.mosaic-split { display:flex; flex:1 1 0; min-width:0; min-height:0; }
.mosaic-split.row { flex-direction:row; }
.mosaic-split.col { flex-direction:column; }
.mosaic-pane { display:flex; min-width:0; min-height:0; }
.mosaic-leaf { position:relative; flex:1 1 0; min-width:0; min-height:0; display:flex; }
/* A maximized leaf fills the whole mosaic (covering the rest) WITHOUT unmounting any pane —
   so a chart keeps its state across maximize (#11). */
.mosaic-leaf.maxed { position:absolute; inset:0; z-index:20; background:var(--bg); }
/* The draggable separator between a split's two children (native mouse drag → setSplit). */
.mosaic-divider { flex:none; z-index:6; background:var(--line); touch-action:none; }
.mosaic-divider.row { width:6px; margin:0 -3px; cursor:col-resize; }
.mosaic-divider.col { height:6px; margin:-3px 0; cursor:row-resize; }
.mosaic-divider:hover { background:var(--accent); }
/* The translucent dock hint painted over the half/edge a drop would land on. */
.mosaic-drop { position:absolute; z-index:7; background:var(--accent); opacity:.25; pointer-events:none; }
/* OUTER dock zones: catch a drag near an edge of the WHOLE mosaic → dock there as a full-span
   strip across EVERY chart. Present only during an in-flight chart/tab drag (above the panes). */
.mosaic-rootzones { position:absolute; inset:0; z-index:8; pointer-events:none; }
.mosaic-rootzone { position:absolute; pointer-events:auto; }
.mosaic-rootzone.top { top:0; left:0; right:0; height:14%; }
.mosaic-rootzone.bottom { bottom:0; left:0; right:0; height:14%; }
.mosaic-rootzone.left { left:0; top:14%; bottom:14%; width:9%; }
.mosaic-rootzone.right { right:0; top:14%; bottom:14%; width:9%; }
/* The full-span hint band the docked chart would fill (full width for top/bottom, full height
   for left/right) — makes the snap read as spanning ALL charts, not one pane. */
.mosaic-roothint { position:absolute; z-index:8; background:var(--accent); opacity:.28; border:2px dashed var(--accent); box-sizing:border-box; pointer-events:none; }
`;

let injected = false;
/** Inject the mosaic <style> once (idempotent). Mirrors ensureChartChromeStyle. */
function ensureMosaicStyle(): void {
  if (injected || typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) { injected = true; return; }
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
  injected = true;
}

/** Inset for the `.mosaic-drop` hint covering `side`'s half of a leaf (top/left = 0). */
function dropStyle(side: Side): React.CSSProperties {
  switch (side) {
    case 'left': return { top: 0, bottom: 0, left: 0, width: '50%' };
    case 'right': return { top: 0, bottom: 0, right: 0, width: '50%' };
    case 'top': return { left: 0, right: 0, top: 0, height: '50%' };
    case 'bottom': return { left: 0, right: 0, bottom: 0, height: '50%' };
  }
}

/** The translucent strip the dock-across-all hint fills — full WIDTH for top/bottom, full
 *  HEIGHT for left/right, sized to the docked chart's ~1/3 share (matches moveLeafToRoot). */
function rootHintStyle(side: Side): React.CSSProperties {
  switch (side) {
    case 'top': return { top: 0, left: 0, right: 0, height: '33%' };
    case 'bottom': return { bottom: 0, left: 0, right: 0, height: '33%' };
    case 'left': return { left: 0, top: 0, bottom: 0, width: '33%' };
    case 'right': return { right: 0, top: 0, bottom: 0, width: '33%' };
  }
}

/** The dock sides the chosen layout permits, so each layout button means something
 *  distinct: 'cols' (Side by side) docks only left/right (row splits); 'rows' (Stacked)
 *  only top/bottom (col splits); 'grid' is free 2D (all four). */
function allowedSides(layout: MosaicLayout): Side[] {
  if (layout === 'cols') return ['left', 'right'];
  if (layout === 'rows') return ['top', 'bottom'];
  return ['left', 'right', 'top', 'bottom'];
}

/** Pick the dock side from a pointer position within a rect: the NEAREST PERMITTED edge
 *  (by normalised distance). Constraining `allowed` to one axis makes 'Side by side' snap
 *  only horizontally and 'Stacked' only vertically. */
function pickSide(rect: DOMRect, clientX: number, clientY: number, allowed: Side[]): Side {
  const x = (clientX - rect.left) / (rect.width || 1);
  const y = (clientY - rect.top) / (rect.height || 1);
  const dist: Record<Side, number> = { left: x, right: 1 - x, top: y, bottom: 1 - y };
  return allowed.reduce((m, c) => (dist[c] < dist[m] ? c : m), allowed[0]!);
}

export function ChartMosaic({
  tree, tabs, activeTabId, layout, onChange, onActivate, onClose, onMaximize, renderPane, dragSourceId, onStartDock, onDockEnd, maximizedId,
}: {
  tree: MosaicNode;
  tabs: ChartTab[];
  activeTabId: string | null;
  /** The chosen layout — constrains the dock direction: 'cols' snaps only left/right,
   *  'rows' only top/bottom, 'grid' is free 2D. Keeps the layout buttons distinct. */
  layout: MosaicLayout;
  onChange: (tree: MosaicNode) => void;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onMaximize: (id: string) => void;
  renderPane: (tab: ChartTab, active: boolean) => React.ReactNode;
  /** The leaf id maximized over the rest (#11) — that leaf fills the mosaic via CSS while every
   *  pane stays mounted. The head's ⤢ toggles it (onMaximize(id) again restores). */
  maximizedId?: string;
  /** A tab/leaf id being dock-dragged from OUTSIDE the mosaic (the top tab strip, on touch).
   *  When set, the mosaic lights its zones + tracks the finger + commits the dock itself
   *  (HTML5 DnD is dead on touch). Cleared via onDockEnd. */
  dragSourceId?: string | null;
  /** Start a touch dock-drag from a cell HEADER (the chart title) — sets dragSourceId, same
   *  as the strip tab's onStartTabDock. */
  onStartDock?: (id: string) => void;
  onDockEnd?: () => void;
}) {
  ensureMosaicStyle();
  // The dock sides this layout permits — threaded into every pickSide + the root zones so
  // 'Side by side' snaps only horizontally, 'Stacked' only vertically, 'Grid' both.
  const sides = allowedSides(layout);

  // Which leaf is showing a dock hint, and on which side (during an in-flight HTML5 drag).
  const [drop, setDrop] = useState<{ id: string; side: Side } | null>(null);
  // The split DOM element being resized (measured at drag start) so the divider can map a
  // pointer delta → a new fraction; keyed alongside the path so onChange targets the node.
  const splitRefs = useRef(new Map<string, HTMLDivElement>());
  // Latest tree, read at pointerup commit time (the dock effect closes over it once).
  const treeRef = useRef(tree); treeRef.current = tree;

  // Outer dock: while a chart/tab is being dragged we surface full-span drop zones on the four
  // edges of the WHOLE mosaic, so a drop docks across ALL charts (not into one pane). `dragging`
  // is driven by window drag events so the zones also light up for a drag out of the tab bar.
  const [dragging, setDragging] = useState(false);
  const [rootDrop, setRootDrop] = useState<Side | null>(null);
  useEffect(() => {
    const onStart = (e: DragEvent) => {
      // Bubble phase → the source's onDragStart (which calls setData) has already run.
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes(DND_KEY)) setDragging(true);
    };
    const onEnd = () => { setDragging(false); setRootDrop(null); };
    window.addEventListener('dragstart', onStart);
    window.addEventListener('dragend', onEnd);
    window.addEventListener('drop', onEnd);
    return () => {
      window.removeEventListener('dragstart', onStart);
      window.removeEventListener('dragend', onEnd);
      window.removeEventListener('drop', onEnd);
    };
  }, []);

  // Begin a divider drag: measure the split's own rect now, then track the pointer and
  // push setSplit(path, fraction) where fraction = a-child's size / split size along the axis.
  // External (top-strip-tab) TOUCH dock: ChartTabs starts a pointer-drag and sets dragSourceId
  // (the dragged tab/leaf id). HTML5 DnD doesn't commit on touch, so the mosaic tracks the
  // finger HERE: light the zones, hit-test the leaf/root-zone under the finger via
  // elementFromPoint, and on release commit the SAME moveLeaf / moveLeafToRoot the desktop
  // onDrop runs — then onDockEnd clears the source. The window listeners fire even though the
  // strip tab captured the pointer (capture redirects to the tab but events still bubble to
  // window; elementFromPoint hit-tests freely).
  useEffect(() => {
    if (!dragSourceId) return;
    setDragging(true);
    let last: { kind: 'leaf'; id: string; side: Side } | { kind: 'root'; side: Side } | null = null;
    const onMove = (ev: PointerEvent) => {
      const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
      const rootZone = el?.closest('.mosaic-rootzone') as HTMLElement | null;
      if (rootZone?.dataset.side) { const side = rootZone.dataset.side as Side; setRootDrop(side); setDrop(null); last = { kind: 'root', side }; return; }
      const leaf = el?.closest('.mosaic-leaf') as HTMLElement | null;
      const leafId = leaf?.dataset.leafId;
      if (leaf && leafId && leafId !== dragSourceId) { const side = pickSide(leaf.getBoundingClientRect(), ev.clientX, ev.clientY, sides); setDrop({ id: leafId, side }); setRootDrop(null); last = { kind: 'leaf', id: leafId, side }; return; }
      setDrop(null); setRootDrop(null); last = null;
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setDrop(null); setRootDrop(null); setDragging(false);
      if (last?.kind === 'root') onChange(moveLeafToRoot(treeRef.current, dragSourceId, last.side));
      else if (last?.kind === 'leaf') onChange(moveLeaf(treeRef.current, dragSourceId, last.id, last.side));
      onDockEnd?.();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragSourceId]);

  // Pointer events (not mouse) so a FINGER can resize too — pointermove/up fire for touch,
  // mouse, and pen alike. The divider has touch-action:none (CSS) so the browser doesn't
  // scroll/zoom mid-drag.
  const startDividerDrag = (path: ('a' | 'b')[], dir: 'row' | 'col', key: string) =>
    (e: React.PointerEvent) => {
      e.preventDefault(); e.stopPropagation();
      const el = splitRefs.current.get(key);
      const rect = el?.getBoundingClientRect();
      if (!rect) return;
      const onMove = (ev: PointerEvent) => {
        const frac = dir === 'row'
          ? (ev.clientX - rect.left) / (rect.width || 1)
          : (ev.clientY - rect.top) / (rect.height || 1);
        onChange(setSplit(tree, path, frac)); // setSplit clamps to [0.05, 0.95]
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        document.body.style.cursor = '';
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      document.body.style.cursor = dir === 'row' ? 'col-resize' : 'row-resize';
    };

  // Dock-drag for the chart-cell HEADER (the "chart title"), UNIFIED across mouse AND touch onto
  // the proven custom pointer flow the top strip tab uses on touch: a drag past a small threshold
  // sets dragSourceId (via onStartDock), and the dragSourceId effect above lights the zones, tracks
  // the pointer — mouse or finger, pointer events fire alike — via elementFromPoint, and commits
  // moveLeaf/moveLeafToRoot on release. We DON'T use native HTML5 DnD here: on desktop its drop
  // phase proved unreliable over the chart canvas (dragstart fired but the drop never committed),
  // and on touch it never commits at all — so the header behaves identically on both platforms.
  // setPointerCapture stops the chart panning under the drag.
  const startCellDock = (e: React.PointerEvent, draggedId: string) => {
    if (e.button !== 0) return; // only the primary (left) button initiates a dock
    if ((e.target as HTMLElement).closest('button')) return; // a tap/click on max/close is not a drag
    const sx = e.clientX, sy = e.clientY, pid = e.pointerId, el = e.currentTarget as HTMLElement;
    let started = false;
    const onMove = (ev: PointerEvent) => {
      if (started) return;
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) <= 8) return; // a tap/click shouldn't flash the zones
      started = true;
      window.removeEventListener('pointermove', onMove);
      try { el.setPointerCapture(pid); } catch { /* unsupported */ }
      onStartDock?.(draggedId);
    };
    const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Render a node, threading the PATH (sequence of 'a'/'b' from the root) so a divider
  // inside knows which split to resize. `key` is the path joined ('' = root) — also the
  // splitRefs map key and a stable React key.
  const render = (n: MosaicNode, path: ('a' | 'b')[]): React.ReactNode => {
    const key = path.join('') || 'root';

    if (n.t === 'split') {
      const cls = n.dir; // 'row' | 'col' → flex-direction via .mosaic-split.row/.col
      return (
        <div
          key={key}
          className={`mosaic-split ${cls}`}
          ref={(el) => { if (el) splitRefs.current.set(key, el); else splitRefs.current.delete(key); }}
        >
          {/* child A gets `split`, child B gets the rest; flexBasis:0 so both honour the ratio. */}
          <div className="mosaic-pane" style={{ flexGrow: n.split, flexBasis: 0, display: 'flex' }}>
            {render(n.a, [...path, 'a'])}
          </div>
          <div
            className={`mosaic-divider ${cls}`}
            onPointerDown={startDividerDrag(path, n.dir, key)}
            title="Drag to resize"
          />
          <div className="mosaic-pane" style={{ flexGrow: 1 - n.split, flexBasis: 0, display: 'flex' }}>
            {render(n.b, [...path, 'b'])}
          </div>
        </div>
      );
    }

    // Leaf — one chart cell. Reuse the shared `.chart-cell*` chrome (themed in index.html).
    const id = n.id;
    const tab = tabs.find((t) => t.id === id);
    const active = id === activeTabId;
    const hint = drop && drop.id === id ? drop.side : null;
    const maxed = maximizedId != null && id === maximizedId; // filling the mosaic over the rest (#11)

    if (!tab) {
      // The tree references a tab that's gone (transient until the shell re-syncs) — show an
      // empty cell rather than crash, but keep it a valid drop target so a dock still lands.
      return (
        <div key={key} className="mosaic-leaf chart-cell">
          {hint ? <div className="mosaic-drop" style={dropStyle(hint)} /> : null}
        </div>
      );
    }

    return (
      // pointerdown-capture so a click ANYWHERE in the cell activates it (matches ChartGrid).
      <div
        key={key}
        className={`mosaic-leaf chart-cell ${active ? 'active' : ''} ${maxed ? 'maxed' : ''}`}
        data-leaf-id={id}
        onPointerDownCapture={(e) => {
          // Activating on pointerdown re-renders this leaf, which ABORTS the HTML5 dragstart of
          // the title bar — that's why the chart-title drag was dead on BOTH platforms (the strip
          // tab has no such capture handler, so it works). So DON'T activate synchronously when the
          // press starts on the draggable header: a chart-BODY press still activates immediately,
          // and a header CLICK (not a drag) activates via the header's onClick below.
          if ((e.target as HTMLElement).closest('.chart-cell-head')) return;
          onActivate(id);
        }}
        // Drop target: while a header/tab hovers, paint the side it would dock; on drop,
        // relocate the dragged leaf there via moveLeaf. preventDefault keeps the drop allowed.
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          const side = pickSide(e.currentTarget.getBoundingClientRect(), e.clientX, e.clientY, sides);
          setDrop((d) => (d && d.id === id && d.side === side ? d : { id, side }));
        }}
        onDragLeave={(e) => {
          // Ignore leaves into descendant elements (the header/buttons) — only clear when the
          // pointer actually exits this cell.
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
          setDrop((d) => (d && d.id === id ? null : d));
        }}
        onDrop={(e) => {
          e.preventDefault();
          const dragged = e.dataTransfer.getData(DND_KEY) || e.dataTransfer.getData('text/plain');
          const side = pickSide(e.currentTarget.getBoundingClientRect(), e.clientX, e.clientY, sides);
          setDrop(null);
          if (dragged && dragged !== id) onChange(moveLeaf(tree, dragged, id, side));
        }}
      >
        <div
          className="chart-cell-head"
          // Dock source: ONE custom pointer-drag for mouse AND touch (no native HTML5 DnD — its
          // desktop drop phase over the chart canvas never committed). startCellDock arms the
          // dragSourceId flow past an 8px threshold; the effect tracks the pointer + commits.
          onPointerDown={(e) => startCellDock(e, id)}
          onClick={() => onActivate(id)} // a header CLICK (not a drag) still activates the pane
          title="Drag onto another chart's edge to dock"
        >
          <span className="chart-cell-sym">{tab.symbol}</span>
          <span className="chart-cell-tf">{TF_LABEL[tab.timeframe] ?? ''}</span>
          <button className="chart-cell-max" title={maxed ? 'Restore' : 'Maximize (keeps the layout)'} onClick={(e) => { e.stopPropagation(); onMaximize(id); }}>{maxed ? '⤡' : '⤢'}</button>
          <button className="chart-cell-x" title="Remove from layout (keeps the tab)" onClick={(e) => { e.stopPropagation(); onClose(id); }}>×</button>
        </div>
        <div className="chart-cell-body">{renderPane(tab, active)}</div>
        {/* The dock hint sits above the body (pointer-events:none) so it never eats the drag. */}
        {hint ? <div className="mosaic-drop" style={dropStyle(hint)} /> : null}
      </div>
    );
  };

  return (
    <div className="mosaic">
      {render(tree, [])}
      {/* Outer dock zones (only during a drag): the four edges of the whole mosaic. A drop on
          one docks the dragged chart as a full-span strip across every chart via moveLeafToRoot. */}
      {dragging ? (
        <div className="mosaic-rootzones">
          {rootDrop ? <div className="mosaic-roothint" style={rootHintStyle(rootDrop)} /> : null}
          {(['top', 'bottom', 'left', 'right'] as Side[]).filter((s) => sides.includes(s)).map((side) => (
            <div
              key={side}
              className={`mosaic-rootzone ${side}`}
              data-side={side}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setRootDrop((s) => (s === side ? s : side)); }}
              onDragLeave={(e) => { if (e.currentTarget.contains(e.relatedTarget as Node | null)) return; setRootDrop((s) => (s === side ? null : s)); }}
              onDrop={(e) => {
                e.preventDefault();
                const dragged = e.dataTransfer.getData(DND_KEY) || e.dataTransfer.getData('text/plain');
                setRootDrop(null); setDragging(false);
                if (dragged) onChange(moveLeafToRoot(tree, dragged, side));
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
