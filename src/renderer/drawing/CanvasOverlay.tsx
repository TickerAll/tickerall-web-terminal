/**
 * CanvasOverlay — the absolutely-positioned, HiDPI canvas the drawing engine paints
 * on, plus the pointer FSM that places / selects / multi-selects / drags drawings.
 * It is the proof-of-architecture for the whole tool family (TERMINAL-ROADMAP area
 * G); the fan-out adds tools to the registry (see ./tools), not code here.
 *
 * It NEVER touches the chart pipeline — it only consumes the additive ChartHandle
 * accessors (project/unproject, view-change subscription, bars snapshot) exposed by
 * ChartPane. A drawing's anchors are (time, price); every frame the overlay
 * re-projects them to pixels via CoordinateProjector, so a drawing stays glued to
 * its bars through pan / zoom / live-append.
 *
 * ── Repaint scheduling ────────────────────────────────────────────────────────
 * A single rAF coalescer (`schedule()`); many triggers in one frame → one paint:
 *   - `chart.onViewChange(...)` — pan / zoom;
 *   - a polling rAF tick that detects the live forming-bar append + auto-follow AND
 *     a same-bucket close-price re-scale (the chart has no "data changed" event);
 *   - the DrawingStore subscription — add / move / select / delete;
 *   - pointer moves during an interaction;
 *   - a ResizeObserver on the pane (HiDPI re-fit on resize).
 *
 * ── Pointer-events discipline (risk #11) ──────────────────────────────────────
 * The chart MUST still scroll / zoom / crosshair when we're not drawing. So the
 * canvas defaults to `pointer-events:none`. We listen for moves on the PANE (the
 * parent — it sees every move bubbling up from the chart canvas below), hit-test on
 * each move, and flip the canvas to `pointer-events:auto` ONLY when a tool is armed
 * or the pointer is over a drawing/handle. Off any object with no tool armed, the
 * canvas is transparent to events → mousedown / drag / wheel all reach the chart.
 *
 * ── New in the fan-out (vs the slice) ─────────────────────────────────────────
 *   - the full tool family (lines/shapes/fib/text) via the registry barrel;
 *   - the freshly-placed drawing takes the toolbar's CURRENT style (prop);
 *   - magnet: new points + dragged handles snap to the nearest bar O/H/L/C;
 *   - multi-select: shift-click toggles; a marquee drag on empty space box-selects;
 *     a body-drag moves the whole selection together;
 *   - keyboard is scoped to the FOCUSED/HOVERED pane (not every overlay's window
 *     listener) via a tiny module-level "active overlay" token — fixes the slice's
 *     "window keydown hits every pane";
 *   - Ctrl/Cmd+Z / Shift+Ctrl/Cmd+Z drive the store's undo/redo.
 */

import { useEffect, useRef, useState } from 'react';
import { useSyncExternalStore } from 'react';
import type { ChartBar } from '../../shared/types';
import { CoordinateProjector, type ProjectorAdapter, type DataPoint, type PixelPoint } from './CoordinateProjector';
import type { DrawingStore } from './DrawingStore';
import { nextDrawingId } from './DrawingStore';
import { snapToOHLC } from './magnet';
import { applyAlpha } from './colors';
import type { Drawing, DrawingKind, DrawingMode, DrawingStyle } from './types';
import { POINT_COUNT, isFreehandKind } from './types';
import { getTool, type ResolvedStyle, type RenderEnv, type TradeContext } from './tools/registry';
import { deriveInitialTarget } from './tools/position';
import { ContextMenu, type ContextMenuItem } from './ui/ContextMenu';
import { markDrawTapConsumed } from './tapSignal';
import { ObjectProperties } from './ui/ObjectProperties';
import { computeMeasure, measureColors, type MeasureState } from './MeasureGesture';
import './tools'; // registers the whole core tool family (lines, shapes, patterns, fib, position, text)

/** Callbacks the engine invokes for chart/shell actions from the right-click menu.
 *  All optional — an absent callback simply hides that menu item. Wired by ChartPane
 *  via DrawingLayer's `actions` prop. */
export interface DrawingActions {
  /** "New order here" at the right-clicked price. */
  onNewOrder?: (price: number) => void;
  /** "Add indicator" (opens the host's indicator picker). */
  onAddIndicator?: () => void;
  /** "Settings" (opens the host's chart settings). */
  onOpenSettings?: () => void;
  /** "Reset zoom" (fit the chart back to its default view). */
  onResetZoom?: () => void;
  /** "Take screenshot" of the chart. */
  onScreenshot?: () => void;
}

/** A trade plan emitted by the position tool's "Place this trade" menu action. */
export interface PositionTradePlan {
  side: 'long' | 'short';
  entry: number;
  sl: number;
  tp: number;
  lots: number;
}

/** The chart surface the overlay needs — a subset of ChartHandle. ChartPane wires
 *  these from its internal chartRef (additive; no pipeline change). */
export interface OverlayChart {
  priceToCoordinate(price: number): number | null;
  coordinateToPrice(y: number): number | null;
  timeToCoordinate(time: number): number | null;
  coordinateToTime(x: number): number | null;
  getVisibleLogicalRange(): { from: number; to: number } | null;
  getBarsSnapshot(): ChartBar[];
  onViewChange(cb: () => void): () => void;
}

interface Props {
  /** The pane element the overlay sizes itself to (`.chart-pane`, position:relative). */
  paneRef: React.RefObject<HTMLDivElement | null>;
  /** Live chart accessors (a subset of ChartHandle). */
  chart: OverlayChart | null;
  /** The drawings model. */
  store: DrawingStore;
  /** The armed tool, or null when the pointer is the plain select/drag cursor. */
  activeTool: DrawingKind | null;
  /** The style a freshly-placed drawing takes (from the toolbar's style row). */
  defaultStyle?: DrawingStyle;
  /** Snap new points + dragged handles to the nearest bar O/H/L/C (default on). */
  magnet?: boolean;
  /** Called after a placement completes (so the toolbar can disarm). */
  onPlaced?: (id: string) => void;
  /** Per-symbol trade context — sizes the position tool + enables "New order here".
   *  All fields optional; absent → ratio-only labels and no money/lots readout. */
  trade?: TradeContext;
  /** Chart/shell actions for the right-click empty-chart menu (all optional). */
  actions?: DrawingActions;
  /** Place the trade a position-tool drawing describes (from the menu). */
  onPlaceOrder?: (plan: PositionTradePlan) => void;
  /** Mobile tier — surfaces a touch selection toolbar (Edit / Delete) when an object is
   *  selected, since mobile lacks right-click / Delete-key / the object manager (#9). */
  isMobile?: boolean;
}

/** Fallback style for a freshly-placed drawing — theme-aware via a CSS var. */
const FALLBACK_STYLE: DrawingStyle = { color: 'var(--accent)', width: 2 };
/** Magnet snap radius in CSS px. */
const MAGNET_RADIUS = 8;
/** Drag threshold (px) before an empty-space mousedown becomes a marquee. */
const MARQUEE_MIN = 3;
/** Minimum pointer travel (px) between sampled freehand-brush points. */
const FREEHAND_SAMPLE_PX = 3;
/** Extra pick radius (px) for a FINGER tap, so thin lines/handles are easy to grab on
 *  mobile (#9). The mouse uses 0 (pixel-precise hover). */
const TOUCH_HIT_SLOP = 11;

/** Resolve a colour that may be `var(--token)` against the element's computed style. */
function resolveColor(el: HTMLElement, color: string): string {
  const m = /^var\((--[a-z0-9-]+)\)$/i.exec(color.trim());
  if (!m) return color;
  const v = getComputedStyle(el).getPropertyValue(m[1]!).trim();
  return v || '#2f81f7';
}

function resolveStyle(el: HTMLElement, style: DrawingStyle): ResolvedStyle {
  let fill = style.fill ? resolveColor(el, style.fill) : undefined;
  // Bake the fill-opacity into the resolved fill alpha so every closed-shape tool
  // honours it (they only read `style.fill`).
  if (fill && style.fillOpacity !== undefined) fill = applyAlpha(fill, style.fillOpacity);
  return { ...style, color: resolveColor(el, style.color), width: style.width, fill };
}

/** Format a price for a menu label (digits scale with magnitude). */
function fmtMenuPrice(p: number): string {
  const abs = Math.abs(p);
  const digits = abs >= 100 ? 2 : abs >= 1 ? 3 : 5;
  return p.toFixed(digits);
}

// ── pane-scoped keyboard: a module-level "active overlay" token. The last pane the
// pointer entered owns the keyboard, so Delete/Escape/undo hit ONE chart, not all of
// them. Each overlay registers a unique token + a handler; the active token's handler
// is the only one that acts. (A single window listener would fire every overlay.)
let activeOverlayToken: symbol | null = null;
const keyHandlers = new Map<symbol, (e: KeyboardEvent) => void>();
let windowKeyBound = false;
function ensureWindowKey(): void {
  if (windowKeyBound) return;
  windowKeyBound = true;
  window.addEventListener('keydown', (e) => {
    if (activeOverlayToken === null) return;
    const h = keyHandlers.get(activeOverlayToken);
    if (h) h(e);
  });
}

export function CanvasOverlay({ paneRef, chart, store, activeTool, defaultStyle, magnet, onPlaced, trade, actions, onPlaceOrder, isMobile }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Subscribe so a store change re-renders this component (re-runs the paint effect's
  // schedule via the deps below); the actual paint is the rAF coalescer.
  const drawings = useSyncExternalStore(store.subscribe, store.list);
  const selectedId = useSyncExternalStore(store.subscribe, store.selectedId);

  // Mutable refs for values the rAF/event loop reads without re-binding listeners.
  const chartRef = useRef<OverlayChart | null>(chart);
  chartRef.current = chart;
  const toolRef = useRef<DrawingKind | null>(activeTool);
  toolRef.current = activeTool;
  const drawingsRef = useRef<Drawing[]>(drawings);
  drawingsRef.current = drawings;
  const onPlacedRef = useRef(onPlaced);
  onPlacedRef.current = onPlaced;
  const styleRef = useRef<DrawingStyle | undefined>(defaultStyle);
  styleRef.current = defaultStyle;
  const magnetRef = useRef<boolean>(magnet !== false);
  magnetRef.current = magnet !== false;
  const tradeRef = useRef<TradeContext | undefined>(trade);
  tradeRef.current = trade;
  const actionsRef = useRef<DrawingActions | undefined>(actions);
  actionsRef.current = actions;
  const onPlaceOrderRef = useRef(onPlaceOrder);
  onPlaceOrderRef.current = onPlaceOrder;

  // ── text inline editor + context menu (React-owned UI over the canvas) ─────────
  // Editing a text/callout: an absolutely-positioned textarea over the anchor. `isNew`
  // lets Escape REMOVE a brand-new empty label (vs just cancel an edit of an old one).
  const [editor, setEditor] = useState<{ id: string; left: number; top: number; value: string; isNew: boolean } | null>(null);
  // The open right-click menu (position in pane-local px + the item list).
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  // The open object-properties panel (the selected drawing's full editor); null = closed.
  const [propsPanel, setPropsPanel] = useState<{ id: string; x: number; y: number } | null>(null);
  // The live measure-gesture box (shift+drag ruler); null when not measuring.
  const [measure, setMeasure] = useState<MeasureState | null>(null);
  // Refs so the long-lived effect closure reads the latest setter/opener.
  const openEditorRef = useRef<((id: string, isNew: boolean) => void) | null>(null);
  const openMenuRef = useRef<((clientX: number, clientY: number, overId: string | null, dataPrice: number | null) => void) | null>(null);
  // Opener for the properties panel (clientX/Y → pane-local), read by the effect closure.
  const openPropsRef = useRef<((id: string, clientX: number, clientY: number) => void) | null>(null);

  // Interaction state (the pointer FSM) + the in-progress placement preview.
  const mode = useRef<DrawingMode>({ type: 'idle' });
  // The live mouse position in canvas-local px (for the placement rubber-band).
  const mouse = useRef<PixelPoint | null>(null);
  // Hover hit (for the cursor + to decide pointer-events capture).
  const hover = useRef<{ id: string; grab: number | 'body' } | null>(null);
  // A pending marquee: an empty-space mousedown that may become a box-select on drag.
  const marquee = useRef<{ start: PixelPoint; cur: PixelPoint; active: boolean } | null>(null);
  // The current multi-drag set (ids + their grab-time origins). Lives in a ref so the
  // window-listener closures read it without re-binding.
  const dragSet = useRef<{ ids: string[]; origins: Map<string, DataPoint[]>; primary: string; grab: number | 'body' } | null>(null);
  // The last sampled pixel during a freehand stroke (for distance-based sampling).
  const lastFreehandPx = useRef<PixelPoint | null>(null);
  // A live measure-gesture in progress (shift+drag). Mirrors the React `measure`
  // state into a ref for the window-listener closures.
  const measuring = useRef<{ startPx: PixelPoint; startData: DataPoint } | null>(null);
  // Whether Shift is currently held (drives the measure-ruler pre-arm in updateCapture).
  const shiftHeld = useRef(false);
  // Whether Ctrl/Cmd is currently held — drives the marquee pre-arm in updateCapture so a
  // Ctrl+drag over EMPTY chart space box-selects (instead of the chart panning).
  const ctrlHeld = useRef(false);

  // A long-lived projector; its adapter reads chartRef.current live, its bars are
  // refreshed each paint from the snapshot.
  const projectorRef = useRef<CoordinateProjector | null>(null);

  // Bridges from the React-prop world into the long-lived effect closure (declared
  // before the effect so it can publish into them on mount).
  const captureUpdaterRef = useRef<(() => void) | null>(null);
  const repaintRef = useRef<(() => void) | null>(null);

  // rAF coalescer — many triggers, one paint per frame.
  const rafId = useRef(0);
  const schedule = () => {
    if (rafId.current) return;
    rafId.current = requestAnimationFrame(() => { rafId.current = 0; paint(); });
  };

  // ── set up canvas, projector, listeners, the live-append poller ───────────────
  useEffect(() => {
    const canvas = canvasRef.current!;
    const pane = paneRef.current;
    if (!pane) return;
    const myToken = Symbol('overlay');
    ensureWindowKey();

    const adapter: ProjectorAdapter = {
      timeToCoordinate: (t) => chartRef.current?.timeToCoordinate(t) ?? null,
      coordinateToTime: (x) => chartRef.current?.coordinateToTime(x) ?? null,
      priceToCoordinate: (p) => chartRef.current?.priceToCoordinate(p) ?? null,
      coordinateToPrice: (y) => chartRef.current?.coordinateToPrice(y) ?? null,
      getVisibleLogicalRange: () => chartRef.current?.getVisibleLogicalRange() ?? null,
      getPlotSize: () => ({ width: canvas.clientWidth, height: canvas.clientHeight }),
    };
    const projector = new CoordinateProjector(adapter, chartRef.current?.getBarsSnapshot() ?? []);
    projectorRef.current = projector;

    // HiDPI fit: back the canvas with devicePixelRatio physical pixels, draw in CSS px.
    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = pane.clientWidth;
      const h = pane.clientHeight;
      const pw = Math.max(1, Math.round(w * dpr));
      const ph = Math.max(1, Math.round(h * dpr));
      if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      schedule();
    };
    fit();

    const ro = new ResizeObserver(fit);
    ro.observe(pane);

    // Pan/zoom → repaint in lockstep.
    let offView = chartRef.current?.onViewChange(schedule) ?? (() => {});

    // Live-append / auto-follow detector. The chart exposes no "data changed" event,
    // so we poll once per animation frame: when the bar count or the last bar's time/
    // close changes (a new forming bar, a tick growing it, or a scroll-load prepend),
    // refresh the projector's bars and repaint. Cheap — a length + last-bar compare.
    let lastLen = -1;
    let lastLastTime = -1;
    let lastFirstTime = -1;
    let lastProbeY = NaN; // price→y of the last bar's close; detects a price auto-scale shift
    let running = true;
    const pollFrame = () => {
      if (!running) return;
      const c = chartRef.current;
      if (c) {
        const bars = c.getBarsSnapshot();
        const n = bars.length;
        const lt = n ? bars[n - 1]!.time : -1;
        const ft = n ? bars[0]!.time : -1;
        const barsChanged = n !== lastLen || lt !== lastLastTime || ft !== lastFirstTime;
        if (barsChanged) {
          lastLen = n; lastLastTime = lt; lastFirstTime = ft;
          projector.setBars(bars);
        }
        // A tick that GROWS the current forming bar (same time bucket + count) re-scales
        // the PRICE axis WITHOUT firing onViewChange (logical-range only) and without
        // changing the bar key above — so a price-anchored drawing would lag the scale
        // until the next unrelated repaint. LWC v4 exposes no price-scale-change event,
        // so we poll: project the last bar's close to y each frame and re-anchor when it
        // moves. One priceToCoordinate call/frame — cheap.
        const ref = n ? c.priceToCoordinate(bars[n - 1]!.close) : null;
        const probeMoved = ref !== null && (Number.isNaN(lastProbeY) || Math.abs(ref - lastProbeY) > 0.05);
        if (ref !== null) lastProbeY = ref;
        if (barsChanged || probeMoved) {
          schedule(); // re-anchor everything: bars and/or the price scale moved
        }
      }
      requestAnimationFrame(pollFrame);
    };
    requestAnimationFrame(pollFrame);

    // ── pointer FSM ─────────────────────────────────────────────────────────────
    const localPoint = (e: MouseEvent): PixelPoint => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    // The render/hit-test environment: plot size + a y→price accessor (for the
    // position/measure labels) + the live trade context (for sizing).
    const env = (): RenderEnv => ({
      width: canvas.clientWidth,
      height: canvas.clientHeight,
      priceAt: (y: number) => chartRef.current?.coordinateToPrice(y) ?? null,
      trade: tradeRef.current,
    });

    /** Project a drawing's anchors → pixels (for hit-test + paint). */
    const pixelsOf = (d: Drawing): PixelPoint[] => {
      const out: PixelPoint[] = [];
      for (const pt of d.points) {
        const pr = projector.project(pt);
        if (!pr) return [];
        out.push({ x: pr.x, y: pr.y });
      }
      return out;
    };

    /** Hit-test every drawing top-most-first; returns the first hit (skips HIDDEN
     *  only). A LOCKED drawing IS returned so a click selects it (→ open Properties /
     *  unlock); starting a DRAG on it is what's blocked, in onCanvasDown — selection
     *  and drag are split. (Task 2.) */
    const hitTest = (m: PixelPoint, extra = 0): { id: string; grab: number | 'body' } | null => {
      const ds = drawingsRef.current;
      const e = env();
      for (let i = ds.length - 1; i >= 0; i--) {
        const d = ds[i]!;
        if (d.hidden) continue;
        const tool = getTool(d.kind);
        if (!tool) continue;
        const px = pixelsOf(d);
        if (px.length < tool.pointCount) continue;
        // `extra` widens the pick radius — a fat-finger slop for touch (#9), 0 for the mouse.
        const h = tool.hitTest(px, m, extra, e, resolveStyle(canvas, d.style));
        if (h) return { id: d.id, grab: h.kind === 'handle' ? h.index : 'body' };
      }
      return null;
    };

    /** Snap a raw pixel point to the nearest bar O/H/L/C (when magnet is on); returns
     *  the snapped data point, or the plain unprojected point. */
    const dataAt = (m: PixelPoint): DataPoint | null => {
      if (magnetRef.current) {
        const snap = snapToOHLC(m, projector, projector ? chartRef.current?.getBarsSnapshot() ?? [] : [], MAGNET_RADIUS);
        if (snap) return snap.point;
      }
      return projector.unproject(m);
    };

    /** Decide whether the canvas should capture pointer events right now. */
    const updateCapture = () => {
      const armed = toolRef.current !== null;
      const interacting = mode.current.type !== 'idle' || (marquee.current?.active ?? false) || measuring.current !== null;
      const overObject = hover.current !== null;
      // Pre-arm capture while Shift is held over empty chart space so a shift+drag
      // lands on THIS canvas (→ onCanvasDown) and we can suppress the chart pan; a
      // plain shift-click there still falls through as a no-op (we don't preventDefault
      // until a drag begins). Not armed when a tool is active (placement owns shift).
      const shiftMeasure = shiftHeld.current && !armed && hover.current === null;
      // Ctrl/Cmd held over empty chart space pre-arms a marquee box-select, so a Ctrl+drag
      // lands on THIS canvas (→ onCanvasDown's marquee branch) instead of panning the chart.
      const ctrlMarquee = ctrlHeld.current && !armed && hover.current === null;
      const capture = armed || interacting || overObject || shiftMeasure || ctrlMarquee;
      canvas.style.pointerEvents = capture ? 'auto' : 'none';
      // When the canvas owns the gesture, also stop the browser from panning/zooming on touch
      // (so a finger DRAWS instead of scrolling the chart); idle → let touch pass to the chart.
      canvas.style.touchAction = capture ? 'none' : '';
      // cursor feedback
      if (armed) canvas.style.cursor = 'crosshair';
      else if (interacting) canvas.style.cursor = (measuring.current || marquee.current?.active) ? 'crosshair' : (mode.current.type === 'dragging' && mode.current.grab === 'body' ? 'move' : 'grabbing');
      else if (overObject) {
        // A locked object can only be selected (not dragged) → a plain pointer, never
        // the 'move'/handle affordance.
        const locked = !!drawingsRef.current.find((d) => d.id === hover.current!.id)?.locked;
        canvas.style.cursor = locked ? 'pointer' : (hover.current!.grab === 'body' ? 'move' : 'pointer');
      }
      else if (shiftMeasure) canvas.style.cursor = 'crosshair';
      else if (ctrlMarquee) canvas.style.cursor = 'crosshair';
      else canvas.style.cursor = '';
    };

    // Moves are tracked on the PANE so we see them even while the canvas is
    // pointer-events:none (the chart canvas below receives the move; it bubbles to
    // the pane). This is what lets idle hovers arm the capture without stealing
    // scroll/zoom from the chart. Entering the pane also makes it the keyboard owner.
    const onPaneMove = (e: MouseEvent) => {
      // TOUCH has no hover: a touch pointermove only fires DURING a press (a chart pan). If we
      // ran the hover/hit-test capture-arming on it, the canvas would grab the touch mid-pan
      // and snag the chart. So touch only ever captures via an ARMED tool (placement) — skip
      // hover-arming here. (Mouse/pen keep their hover.) Touch-select of existing objects is a
      // separate follow-up that needs a tap-hit-test path, not the hover model.
      if ((e as PointerEvent).pointerType === 'touch') return;
      activeOverlayToken = myToken; // this pane owns the keyboard now
      const m = localPoint(e);
      mouse.current = m;
      // Track shift/ctrl so updateCapture can pre-arm the measure ruler (shift) or the
      // marquee box-select (ctrl) over empty space.
      if (shiftHeld.current !== e.shiftKey) shiftHeld.current = e.shiftKey;
      const ctrlNow = e.ctrlKey || e.metaKey;
      if (ctrlHeld.current !== ctrlNow) { ctrlHeld.current = ctrlNow; updateCapture(); }
      // A freehand stroke or a live measure is driven by the window-capture handlers;
      // the pane should not run hover/hit-test while one is in progress.
      if (mode.current.type === 'freehand' || measuring.current) return;
      if (mode.current.type === 'placing' || mode.current.type === 'dragging') {
        handleInteractionMove(m);
        return;
      }
      if (marquee.current) { // a marquee may be forming
        marquee.current.cur = m;
        if (!marquee.current.active && Math.hypot(m.x - marquee.current.start.x, m.y - marquee.current.start.y) >= MARQUEE_MIN) {
          marquee.current.active = true;
          updateCapture();
        }
        if (marquee.current.active) { schedule(); return; }
      }
      const prev = hover.current;
      hover.current = hitTest(m);
      if ((prev?.id ?? null) !== (hover.current?.id ?? null) || (prev?.grab ?? null) !== (hover.current?.grab ?? null)) {
        updateCapture();
        schedule(); // hover affects selection-handle emphasis only when selected; cheap repaint
      } else {
        updateCapture();
      }
    };

    const onPaneEnter = () => { activeOverlayToken = myToken; };
    const onPaneLeave = () => {
      mouse.current = null;
      if (mode.current.type === 'idle' && !(marquee.current?.active)) { hover.current = null; updateCapture(); schedule(); }
    };

    // Empty-space click → deselect. When idle and NOT over an object, the canvas is
    // pointer-events:none (so the chart pans/zooms), which means `onCanvasDown`'s
    // deselect branch can't fire — the mousedown lands on the chart canvas below. So
    // we watch mousedown on the PANE: if there IS a selection, no tool is armed, and
    // the press is on empty space, we arm a "pending deselect" and complete it on
    // mouseup ONLY if the pointer didn't move (a click, not a chart-pan drag). We
    // never preventDefault here, so the chart still pans normally on a drag.
    // Touch double-tap timing (#86 text-edit): two quick taps near the same spot.
    let lastTapAt = 0, lastTapX = 0, lastTapY = 0;
    const onPaneDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (toolRef.current !== null) return;          // a tool is armed → placement owns it
      if (mode.current.type !== 'idle') return;       // already interacting (drag/place)
      // ── TOUCH: select / drag / double-tap EXISTING objects (#86) ────────────────────
      // Touch has no hover, so the canvas never captured this press (it's pointer-events:
      // none when idle). The PANE always sees the press (bubbling), so do the hit-test +
      // select/drag/double-tap HERE. The mouse path (onCanvasDown) is left untouched.
      if ((e as PointerEvent).pointerType === 'touch') {
        const tt = e.target as HTMLElement | null;
        // This tap landed on drawing chrome (toolbar / object-manager / context menu /
        // selection toolbar / the lin-log toggle) — let the button's own handler fire, but
        // STAMP it consumed first so the shell's tap→TF gesture skips it too. Without the
        // stamp, tapping a .draw-seltools option also opened the TF dial (#26; same leak as
        // #8/#24 — the object-hit path at the next branch already stamps).
        if (tt && tt.closest('.dtb, .omp, .dctx, .draw-seltools, .scale-toggle')) { markDrawTapConsumed(); return; }
        const mt = localPoint(e);
        const hitT = hitTest(mt, TOUCH_HIT_SLOP);
        if (hitT) {
          e.preventDefault(); e.stopPropagation();
          markDrawTapConsumed(); // this tap is the drawing layer's — don't let the shell toggle the TF strip (#8)
          const now = Date.now();
          const dbl = (now - lastTapAt < 300) && Math.hypot(mt.x - lastTapX, mt.y - lastTapY) < 22;
          lastTapAt = now; lastTapX = mt.x; lastTapY = mt.y;
          store.select(hitT.id);
          if (dbl) {
            // double-tap → edit text/callout inline, else open the properties panel.
            const d = store.get(hitT.id);
            if (d?.kind === 'text' || d?.kind === 'callout') openEditorRef.current?.(hitT.id, false);
            else openPropsRef.current?.(hitT.id, e.clientX, e.clientY);
            lastTapAt = 0;
            return;
          }
          // single tap on an object → begin a drag (capture the pointer so the chart below
          // doesn't pan under us; the window handlers move + commit the drawing).
          try { (e.currentTarget as HTMLElement).setPointerCapture((e as PointerEvent).pointerId); } catch { /* unsupported */ }
          const primaryLocked = !!store.get(hitT.id)?.locked;
          const dp = projector.unproject(mt);
          if (dp && !primaryLocked) {
            const grab = hitT.grab;
            const ids = grab === 'body' ? store.selectedIds() : [hitT.id];
            const origins = new Map<string, DataPoint[]>();
            for (const id of ids) { const d = store.get(id); if (d && !d.locked) origins.set(id, d.points.map((p) => ({ ...p }))); }
            if (origins.size > 0) {
              store.beginBatch();
              mode.current = { type: 'dragging', id: hitT.id, grab, anchor: dp, origin: store.get(hitT.id)!.points.map((p) => ({ ...p })) };
              dragSet.current = { ids: [...origins.keys()], origins, primary: hitT.id, grab };
              window.addEventListener('pointermove', onWindowMove, true);
              window.addEventListener('pointerup', onWindowUp, true);
              updateCapture();
            }
          }
          return;
        }
        // touch miss (empty space): if something is selected, this tap is a DISMISS/deselect —
        // claim it so the shell doesn't ALSO open the TF strip (#8). (A miss with nothing
        // selected is a genuine empty-chart tap → leave it for the TF toggle.)
        if (store.selectedId() !== null) markDrawTapConsumed();
        // …else fall through: deselect on a clean tap, else the chart pans.
      }
      if (store.selectedId() === null) return;        // nothing selected → nothing to clear
      // Ignore presses that originate on the toolbar / object-manager chrome (the
      // grip-drag, a button) — only true chart-area empty space should deselect.
      const tgt = e.target as HTMLElement | null;
      if (tgt && tgt !== canvas && tgt.closest('.dtb, .omp, .dctx, .draw-seltools, .scale-toggle')) return;
      const m = localPoint(e);
      if (hitTest(m)) return;                          // pressed on an object → the canvas handles it
      if (e.shiftKey) return;                          // shift = additive / measure (canvas owns it)
      // empty-space press with a live selection → tentatively deselect on a clean click.
      const start = m;
      const onUp = (ue: MouseEvent) => {
        window.removeEventListener('pointerup', onUp, true);
        const end = localPoint(ue);
        // Only a click (negligible movement) clears; a drag was a chart pan/zoom-scroll.
        if (Math.hypot(end.x - start.x, end.y - start.y) < MARQUEE_MIN && store.selectedId() !== null) {
          store.select(null);
        }
      };
      window.addEventListener('pointerup', onUp, true);
    };

    /** The pointer-follow for the measure ruler: updates the live box as the pointer moves
     *  (button up OR during a drag), until the ruler is frozen on release or finished. */
    const onMeasureFollow = (e: MouseEvent) => {
      if (!measuring.current) return;
      const m = localPoint(e);
      mouse.current = m;
      const curData = projector.unproject(m);
      if (!curData) return;
      const bars = chartRef.current?.getBarsSnapshot() ?? [];
      setMeasure({
        startPx: measuring.current.startPx,
        curPx: m,
        startData: measuring.current.startData,
        curData,
        readout: computeMeasure(measuring.current.startData, curData, bars, tradeRef.current),
      });
    };
    /** Releasing the mouse does NOT clear the ruler — it PERSISTS, visible, until the next
     *  pointer-down (the user's ask). If the gesture was a DRAG (the pointer travelled),
     *  freeze the ruler where it was released (stop following); a bare click keeps following
     *  so it can still be sized click-to-click. The ruler only clears in finishMeasure. */
    const onMeasureUp = (e: MouseEvent) => {
      window.removeEventListener('pointerup', onMeasureUp, true);
      if (!measuring.current) return;
      const up = localPoint(e);
      if (Math.hypot(up.x - measuring.current.startPx.x, up.y - measuring.current.startPx.y) >= MARQUEE_MIN) {
        window.removeEventListener('pointermove', onMeasureFollow, true); // freeze where the drag ended
      }
    };
    /** Finish the current measure (the NEXT pointer-down, or Esc): clear the box + capture. */
    const finishMeasure = () => {
      if (!measuring.current) return;
      measuring.current = null;
      window.removeEventListener('pointermove', onMeasureFollow, true);
      window.removeEventListener('pointerup', onMeasureUp, true);
      setMeasure(null);
      updateCapture();
      schedule();
    };
    /** Start a measure ruler at `startPx`: the press sets the anchor and the ruler FOLLOWS
     *  the pointer. Releasing the mouse does NOT clear it — it persists (and freezes where a
     *  drag ended); the NEXT pointer-down anywhere (or Esc) clears it. Shared by Shift+click/
     *  drag on empty space AND the dedicated Measure tool, so the readout is identical. */
    const startMeasureGesture = (startPx: PixelPoint) => {
      const startData = projector.unproject(startPx);
      if (!startData) return;
      measuring.current = { startPx, startData };
      updateCapture(); // capture stays on (interacting) so the follow + next click land here
      const bars = chartRef.current?.getBarsSnapshot() ?? [];
      setMeasure({ startPx, curPx: startPx, startData, curData: startData, readout: computeMeasure(startData, startData, bars, tradeRef.current) });
      window.addEventListener('pointermove', onMeasureFollow, true);
      window.addEventListener('pointerup', onMeasureUp, true);
    };

    // mousedown is taken on the CANVAS (only fires when we've armed capture).
    const onCanvasDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      activeOverlayToken = myToken;
      const m = localPoint(e);
      mouse.current = m;

      // Two-click measure (Task 11): a measure is in progress → THIS click finishes it
      // (no hold). Handled before any tool/select logic so the click does nothing else.
      if (measuring.current) { e.preventDefault(); e.stopPropagation(); finishMeasure(); return; }

      const armed = toolRef.current;
      if (armed) {
        // ── Measure tool: click to set the start, move, click again to finish — no
        //    mouse-hold (Task 11). Stays armed for the next measure. ──
        if (armed === 'measure') {
          e.preventDefault();
          e.stopPropagation();
          startMeasureGesture(m);
          return;
        }
        const dp = dataAt(m);
        if (!dp) return;
        e.preventDefault();
        e.stopPropagation();
        // ── freehand (brush / marker / highlighter): collect points during the press-drag ──
        if (isFreehandKind(armed)) {
          mode.current = { type: 'freehand', kind: armed, pending: [dp] };
          lastFreehandPx.current = m;
          window.addEventListener('pointermove', onWindowMove, true);
          window.addEventListener('pointerup', onWindowUp, true);
          updateCapture();
          schedule();
          return;
        }
        // ── multi-click placement (every other tool) ──
        const need = POINT_COUNT[armed] ?? 2;
        const cur = mode.current.type === 'placing' ? mode.current.pending : [];
        const pending = [...cur, dp];
        if (pending.length >= need) {
          finishPlacement(armed, pending);
        } else {
          mode.current = { type: 'placing', kind: armed, pending };
          // Hybrid for 2-point tools: support press-DRAG-release as well as click-click.
          // If this is the FIRST point of an exactly-2-point tool, watch for a drag —
          // a release past the threshold completes the drawing with the release point
          // (so a short drag draws a small line/arrow); a plain click leaves it placing
          // and waits for the 2nd click. This NEVER drops a tiny drawing.
          if (need === 2 && pending.length === 1) {
            const downKind = armed;
            const onPlaceMove = (me: MouseEvent) => { mouse.current = localPoint(me); schedule(); };
            const onPlaceUp = (ue: MouseEvent) => {
              window.removeEventListener('pointermove', onPlaceMove, true);
              window.removeEventListener('pointerup', onPlaceUp, true);
              const up = localPoint(ue);
              // Only treat it as a drag-place if the tool is still mid-placement of THIS
              // drawing (a 2nd click elsewhere may have already finished it).
              if (mode.current.type !== 'placing' || mode.current.kind !== downKind || mode.current.pending.length !== 1) return;
              if (Math.hypot(up.x - m.x, up.y - m.y) >= MARQUEE_MIN) {
                const upDp = dataAt(up);
                if (upDp) finishPlacement(downKind, [mode.current.pending[0]!, upDp]);
              }
            };
            window.addEventListener('pointermove', onPlaceMove, true);
            window.addEventListener('pointerup', onPlaceUp, true);
          }
        }
        schedule();
        return;
      }

      // ── select / start a drag ──
      const hit = hitTest(m);
      if (hit) {
        e.preventDefault();
        e.stopPropagation();
        const shift = e.shiftKey;
        if (shift) {
          store.toggleSelect(hit.id);
        } else if (!store.isSelected(hit.id)) {
          store.select(hit.id);
        }
        // A LOCKED object is selectable but never dragged (Task 2): clicking it
        // selected it above; we stop here without entering 'dragging' so its geometry
        // is frozen. (A multi-select body-drag started from an UNLOCKED object still
        // skips any locked members — see the origins filter below.)
        const primaryLocked = !!store.get(hit.id)?.locked;
        // Begin a drag of the (possibly multi-) selection. A handle drag only makes
        // sense for a single drawing; body-drag moves the whole selection.
        const dp = projector.unproject(m);
        if (dp && store.isSelected(hit.id) && !primaryLocked) {
          const grab = hit.grab;
          const ids = grab === 'body' ? store.selectedIds() : [hit.id];
          const origins = new Map<string, DataPoint[]>();
          for (const id of ids) { const d = store.get(id); if (d && !d.locked) origins.set(id, d.points.map((p) => ({ ...p }))); }
          // If nothing draggable remains (e.g. every selected object is locked), don't
          // start a drag — just leave the selection as-is.
          if (origins.size > 0) {
            store.beginBatch(); // collapse the whole drag into one undo step
            mode.current = { type: 'dragging', id: hit.id, grab, anchor: dp, origin: store.get(hit.id)!.points.map((p) => ({ ...p })) };
            dragSet.current = { ids: [...origins.keys()], origins, primary: hit.id, grab };
            window.addEventListener('pointermove', onWindowMove, true);
            window.addEventListener('pointerup', onWindowUp, true);
            updateCapture();
          }
        }
      } else if (e.shiftKey) {
        // ── Shift+click on empty space → START the two-click measure ruler (Task 11):
        // this click sets the anchor, the ruler then follows the pointer (button up),
        // and the next click (or Esc) finishes it — no hold. preventDefault so the chart
        // never pans. ──
        e.preventDefault();
        e.stopPropagation();
        startMeasureGesture(m);
      } else {
        // clicked empty space with no tool → start a possible marquee + clear selection
        e.preventDefault();
        e.stopPropagation();
        if (store.selectedId() !== null) store.select(null);
        marquee.current = { start: m, cur: m, active: false };
        window.addEventListener('pointermove', onWindowMove, true);
        window.addEventListener('pointerup', onWindowUp, true);
        schedule();
      }
    };

    // During a drag / marquee / freehand / measure we listen on WINDOW (capture) so it
    // continues even if the pointer briefly leaves the pane / moves fast.
    const onWindowMove = (e: MouseEvent) => {
      if (mode.current.type === 'dragging') { e.preventDefault(); handleInteractionMove(localPoint(e)); return; }
      if (mode.current.type === 'freehand') {
        e.preventDefault();
        const m = localPoint(e);
        // Sample only when the pointer has moved a few px from the last sample (keeps
        // the point list manageable + the smoothing clean).
        const last = lastFreehandPx.current;
        if (!last || Math.hypot(m.x - last.x, m.y - last.y) >= FREEHAND_SAMPLE_PX) {
          const dp = projector.unproject(m); // raw (no magnet) — freehand follows the hand
          if (dp) { mode.current.pending.push(dp); lastFreehandPx.current = m; }
        }
        mouse.current = m;
        schedule();
        return;
      }
      // (The measure ruler is driven by its own onMeasureFollow/onMeasureUp listeners — it
      //  never rides onWindowMove/onWindowUp, so there is no clear-on-release here.)
      if (marquee.current) {
        const m = localPoint(e);
        marquee.current.cur = m;
        if (!marquee.current.active && Math.hypot(m.x - marquee.current.start.x, m.y - marquee.current.start.y) >= MARQUEE_MIN) {
          marquee.current.active = true; updateCapture();
        }
        schedule();
      }
    };
    const onWindowUp = () => {
      if (mode.current.type === 'dragging') {
        mode.current = { type: 'idle' };
        dragSet.current = null;
        store.commit(); // close the undo step
        window.removeEventListener('pointermove', onWindowMove, true);
        window.removeEventListener('pointerup', onWindowUp, true);
        if (mouse.current) hover.current = hitTest(mouse.current);
        updateCapture();
        schedule();
        return;
      }
      if (mode.current.type === 'freehand') {
        const pending = mode.current.pending;
        const kind = mode.current.kind;
        mode.current = { type: 'idle' };
        lastFreehandPx.current = null;
        window.removeEventListener('pointermove', onWindowMove, true);
        window.removeEventListener('pointerup', onWindowUp, true);
        // Need ≥2 points to be a stroke; a bare click (1 point) is discarded WITHOUT
        // disarming, so a missed click lets the user try the stroke again.
        if (pending.length >= 2) finishPlacement(kind, pending);
        else { hover.current = mouse.current ? hitTest(mouse.current) : null; updateCapture(); schedule(); }
        return;
      }
      // (No measure-clear on release — the ruler persists until the next pointer-down; see
      //  onMeasureUp, which only freezes a drag-ended ruler without clearing it.)
      if (marquee.current) {
        const mq = marquee.current;
        marquee.current = null;
        window.removeEventListener('pointermove', onWindowMove, true);
        window.removeEventListener('pointerup', onWindowUp, true);
        if (mq.active) commitMarquee(mq.start, mq.cur);
        if (mouse.current) hover.current = hitTest(mouse.current);
        updateCapture();
        schedule();
      }
    };

    /** Box-select every drawing whose any anchor (or its body's projected pixels)
     *  falls within the marquee rect. */
    const commitMarquee = (a: PixelPoint, b: PixelPoint) => {
      const x0 = Math.min(a.x, b.x); const x1 = Math.max(a.x, b.x);
      const y0 = Math.min(a.y, b.y); const y1 = Math.max(a.y, b.y);
      const inside = (p: PixelPoint) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
      const picked: string[] = [];
      for (const d of drawingsRef.current) {
        if (d.hidden) continue;
        const px = pixelsOf(d);
        if (px.length === 0) continue;
        if (px.some(inside)) picked.push(d.id);
      }
      store.selectMany(picked);
    };

    const handleInteractionMove = (m: PixelPoint) => {
      if (mode.current.type === 'dragging') {
        const ds = dragSet.current;
        if (!ds) return;
        if (ds.grab === 'body') {
          // translate the whole selection by the (snapped or raw) data delta.
          const dp = projector.unproject(m);
          if (!dp) return;
          const md = mode.current;
          const dt = dp.time - md.anchor.time;
          const dprice = dp.price - md.anchor.price;
          for (const id of ds.ids) {
            const origin = ds.origins.get(id)!;
            store.setPoints(id, origin.map((p) => ({ time: p.time + dt, price: p.price + dprice })));
          }
        } else {
          // single-handle drag → magnet-snap the handle to a bar O/H/L/C.
          const dp = dataAt(m);
          if (!dp) return;
          store.movePoint(ds.primary, ds.grab as number, dp);
        }
        schedule();
      } else if (mode.current.type === 'placing') {
        schedule(); // rubber-band preview follows the mouse
      }
    };

    const finishPlacement = (kind: DrawingKind, pending: DataPoint[]) => {
      const id = nextDrawingId();
      const baseStyle = styleRef.current ?? FALLBACK_STYLE;
      // Position tools are placed with 2 clicks (entry, stop) but stored with a third
      // derived TARGET anchor so the box already shows a reward zone (1:2 by default).
      let points = pending;
      if ((kind === 'long-position' || kind === 'short-position') && pending.length === 2) {
        points = [...pending, deriveInitialTarget(pending[0]!, pending[1]!)];
      }
      const drawing: Drawing = { id, kind, points, style: { ...baseStyle }, source: 'user' };
      store.add(drawing);
      store.select(id);
      mode.current = { type: 'idle' };
      hover.current = mouse.current ? hitTest(mouse.current) : null;
      updateCapture();
      onPlacedRef.current?.(id);
      // A freshly-placed text label opens its inline editor immediately so the user
      // can type (Task 1) — the placeholder is otherwise un-editable.
      if (kind === 'text') openEditorRef.current?.(id, true);
    };

    // Keyboard, scoped to the FOCUSED/HOVERED pane via the active-overlay token.
    const onKeyDown = (e: KeyboardEvent) => {
      // Track Shift so the measure-ruler pre-arm reacts to a key press with the pointer
      // stationary over the pane (updateCapture re-checks shiftHeld + the live hover).
      if (e.key === 'Shift' && !shiftHeld.current) {
        shiftHeld.current = true;
        if (mouse.current && mode.current.type === 'idle' && !marquee.current && !measuring.current) updateCapture();
      }
      // Track Ctrl/Cmd so the marquee pre-arm reacts to a key press with the pointer
      // stationary over the pane (a Ctrl+drag over empty space → box-select).
      if ((e.key === 'Control' || e.key === 'Meta') && !ctrlHeld.current) {
        ctrlHeld.current = true;
        if (mouse.current && mode.current.type === 'idle' && !marquee.current && !measuring.current) updateCapture();
      }
      // never hijack keys while typing in an input/textarea/contenteditable.
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || t?.isContentEditable) return;
      const meta = e.ctrlKey || e.metaKey;
      if (meta && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) store.redo(); else store.undo();
        return;
      }
      if (meta && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); store.redo(); return; }
      if (e.key === 'Escape') {
        if (measuring.current) { finishMeasure(); }
        else if (mode.current.type === 'placing') { mode.current = { type: 'idle' }; updateCapture(); schedule(); }
        else if (store.selectedId()) { store.select(null); }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        const ids = store.selectedIds();
        if (ids.length) { e.preventDefault(); store.removeMany(ids); }
      }
    };

    // ── right-click context menu (object actions / chart actions) ─────────────────
    // Listen on the PANE so we catch right-clicks over empty chart space too (the
    // canvas is pointer-events:none there). We build the item list from what's under
    // the cursor + the supplied callbacks, then open the themed popup.
    const onContextMenu = (e: MouseEvent) => {
      const tgt = e.target as HTMLElement | null;
      if (tgt && tgt.closest('.dtb, .omp, .dctx, .draw-seltools, .scale-toggle')) return; // chrome has no chart menu
      const m = localPoint(e);
      const hit = hitTest(m);
      const overId = hit?.id ?? null;
      const price = projector.unproject(m)?.price ?? null;
      // If the right-click landed on an UNSELECTED object, select it first (so the
      // menu's actions target what the user clicked).
      if (overId && !store.isSelected(overId)) store.select(overId);
      openMenuRef.current?.(e.clientX, e.clientY, overId, price);
      e.preventDefault();
      e.stopPropagation();
    };

    // Double-click a drawing → text/callout opens its inline text editor (Task 1);
    // every OTHER kind opens the full ObjectProperties panel (Task 9). The canvas only
    // sees the dblclick when it's capturing (i.e. over an object).
    const onCanvasDblClick = (e: MouseEvent) => {
      const m = localPoint(e);
      const hit = hitTest(m);
      if (!hit) return;
      const d = store.get(hit.id);
      if (!d) return;
      e.preventDefault();
      e.stopPropagation();
      store.select(hit.id);
      if (d.kind === 'text' || d.kind === 'callout') openEditorRef.current?.(hit.id, false);
      else openPropsRef.current?.(hit.id, e.clientX, e.clientY);
    };

    // Releasing Shift drops the measure pre-arm (so the canvas goes transparent to the
    // chart again). A bare window keyup is fine — it only flips a ref + re-checks.
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift' && shiftHeld.current) {
        shiftHeld.current = false;
        if (mode.current.type === 'idle' && !marquee.current && !measuring.current) updateCapture();
      }
      if ((e.key === 'Control' || e.key === 'Meta') && ctrlHeld.current) {
        ctrlHeld.current = false;
        if (mode.current.type === 'idle' && !marquee.current && !measuring.current) updateCapture();
      }
    };

    // Wheel zoom-through: the canvas is pointer-events:auto whenever the pointer is over an
    // object (so it can be dragged), which would otherwise SWALLOW the wheel and block the
    // user from zooming the chart while hovering a drawing (e.g. a trade-planning box). So
    // while we're merely HOVERING (not mid-gesture), forward the wheel to the chart canvas
    // beneath us, so it still zooms. During an active drag/place/measure/marquee/freehand we
    // keep the wheel here (no zoom mid-gesture).
    const onCanvasWheel = (e: WheelEvent) => {
      const interacting = mode.current.type !== 'idle' || (marquee.current?.active ?? false) || measuring.current !== null;
      if (interacting) return;
      const prevPE = canvas.style.pointerEvents;
      canvas.style.pointerEvents = 'none';
      const below = document.elementFromPoint(e.clientX, e.clientY);
      canvas.style.pointerEvents = prevPE;
      if (below && below !== canvas) {
        below.dispatchEvent(new WheelEvent('wheel', {
          deltaX: e.deltaX, deltaY: e.deltaY, deltaZ: e.deltaZ, deltaMode: e.deltaMode,
          clientX: e.clientX, clientY: e.clientY, bubbles: true, cancelable: true,
        }));
        e.preventDefault();
        e.stopPropagation();
      }
    };

    pane.addEventListener('pointermove', onPaneMove);
    pane.addEventListener('mouseenter', onPaneEnter);
    pane.addEventListener('mouseleave', onPaneLeave);
    pane.addEventListener('pointerdown', onPaneDown);
    pane.addEventListener('contextmenu', onContextMenu);
    canvas.addEventListener('pointerdown', onCanvasDown);
    canvas.addEventListener('dblclick', onCanvasDblClick);
    canvas.addEventListener('wheel', onCanvasWheel, { passive: false });
    window.addEventListener('keyup', onKeyUp);
    keyHandlers.set(myToken, onKeyDown);

    // Re-evaluate capture whenever the armed tool changes (handled by the effect dep
    // below calling updateCapture through the ref) — initialise now.
    updateCapture();

    // expose for the tool-change effect + cleanup
    captureUpdaterRef.current = updateCapture;
    repaintRef.current = schedule;

    return () => {
      running = false;
      ro.disconnect();
      offView();
      offView = () => {};
      pane.removeEventListener('pointermove', onPaneMove);
      pane.removeEventListener('mouseenter', onPaneEnter);
      pane.removeEventListener('mouseleave', onPaneLeave);
      pane.removeEventListener('pointerdown', onPaneDown);
      pane.removeEventListener('contextmenu', onContextMenu);
      canvas.removeEventListener('pointerdown', onCanvasDown);
      canvas.removeEventListener('dblclick', onCanvasDblClick);
      canvas.removeEventListener('wheel', onCanvasWheel);
      window.removeEventListener('keyup', onKeyUp);
      keyHandlers.delete(myToken);
      if (activeOverlayToken === myToken) activeOverlayToken = null;
      window.removeEventListener('pointermove', onWindowMove, true);
      window.removeEventListener('pointerup', onWindowUp, true);
      if (rafId.current) cancelAnimationFrame(rafId.current);
      rafId.current = 0;
      captureUpdaterRef.current = null;
      repaintRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneRef, store]);

  // When the armed tool changes, re-evaluate capture (arming a tool must capture even
  // without a hover) + cancel any half-placed preview when disarming.
  useEffect(() => {
    if (activeTool === null && mode.current.type === 'placing') mode.current = { type: 'idle' };
    captureUpdaterRef.current?.();
    repaintRef.current?.();
  }, [activeTool]);

  // Repaint when the drawings or selection change (the subscription drove the
  // re-render; this schedules the actual canvas paint with fresh data).
  useEffect(() => { repaintRef.current?.(); }, [drawings, selectedId]);

  // ── text inline editor: open at the drawing's projected anchor ─────────────────
  const openEditor = (id: string, isNew: boolean) => {
    const d = store.get(id);
    const projector = projectorRef.current;
    if (!d || !projector || d.points.length < 1) return;
    const pr = projector.project(d.points[0]!);
    if (!pr) return;
    setMenu(null);
    setPropsPanel(null); // the inline editor and the props panel never coexist
    setEditor({ id, left: pr.x, top: pr.y, value: d.style.text ?? '', isNew });
  };
  openEditorRef.current = openEditor;

  /** Commit the editor's text onto the drawing (Enter / blur). Empty + new → remove. */
  const commitEditor = (cancel = false) => {
    setEditor((cur) => {
      if (!cur) return null;
      const d = store.get(cur.id);
      if (d) {
        const text = cur.value;
        if (cancel) {
          // Escape: drop a brand-new empty label; otherwise leave the old text intact.
          if (cur.isNew && !(d.style.text && d.style.text.length)) store.remove(cur.id);
        } else if (!text.length && cur.isNew) {
          store.remove(cur.id); // committing an empty new label removes it
        } else {
          store.setStyle(cur.id, { ...d.style, text });
        }
      }
      return null;
    });
  };

  // ── right-click menu builder: object actions vs chart actions ──────────────────
  // `clientX/clientY` anchor the ObjectProperties panel when "Properties…" is picked.
  const buildMenuItems = (overId: string | null, dataPrice: number | null, clientX: number, clientY: number): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [];
    if (overId) {
      const d = store.get(overId);
      if (!d) return items;
      const isPosition = d.kind === 'long-position' || d.kind === 'short-position';
      if (d.kind === 'text' || d.kind === 'callout') {
        items.push({ kind: 'item', label: 'Edit text', icon: '✎', onClick: () => openEditor(overId, false) });
      }
      if (isPosition && onPlaceOrderRef.current) {
        const plan = positionPlanOf(d);
        items.push({
          kind: 'item', label: 'Place this trade', icon: '➤',
          disabled: !plan, onClick: () => { if (plan) onPlaceOrderRef.current!(plan); },
        });
        items.push({ kind: 'sep' });
      }
      items.push({ kind: 'item', label: 'Clone', icon: '⧉', onClick: () => store.clone(overId, cloneOffset()) });
      items.push({ kind: 'item', label: d.locked ? 'Unlock' : 'Lock', icon: d.locked ? '🔓' : '🔒', onClick: () => store.setLocked(overId, !d.locked) });
      items.push({ kind: 'item', label: d.hidden ? 'Show' : 'Hide', icon: d.hidden ? '👁' : '🚫', onClick: () => store.setHidden(overId, !d.hidden) });
      items.push({ kind: 'sep' });
      items.push({ kind: 'item', label: 'Bring to front', icon: '⤒', onClick: () => store.bringToFront(overId) });
      items.push({ kind: 'item', label: 'Send to back', icon: '⤓', onClick: () => store.sendToBack(overId) });
      items.push({ kind: 'sep' });
      // Full editor for EVERY kind (Task 9). For text it complements "Edit text" above.
      items.push({ kind: 'item', label: 'Properties…', icon: '⚙', onClick: () => { store.select(overId); openPropsRef.current?.(overId, clientX, clientY); } });
      items.push({ kind: 'item', label: 'Delete', icon: '🗑', danger: true, disabled: !!d.locked, onClick: () => store.remove(overId) });
    } else {
      // ── empty chart space ──
      const a = actionsRef.current;
      if (a?.onNewOrder && dataPrice !== null) {
        items.push({ kind: 'item', label: `New order here (${fmtMenuPrice(dataPrice)})`, icon: '＋', onClick: () => a.onNewOrder!(dataPrice) });
      }
      if (a?.onAddIndicator) items.push({ kind: 'item', label: 'Add indicator', icon: 'ƒ', onClick: () => a.onAddIndicator!() });
      if (items.length) items.push({ kind: 'sep' });
      if (a?.onResetZoom) items.push({ kind: 'item', label: 'Reset zoom', icon: '⤢', onClick: () => a.onResetZoom!() });
      if (a?.onScreenshot) items.push({ kind: 'item', label: 'Take screenshot', icon: '📷', onClick: () => a.onScreenshot!() });
      if (a?.onOpenSettings) items.push({ kind: 'item', label: 'Settings', icon: '⚙', onClick: () => a.onOpenSettings!() });
    }
    return items;
  };

  /** The trade plan a position drawing describes (entry/sl/tp + sized lots), or null
   *  when prices aren't projectable. Reads the three anchors' prices directly. */
  const positionPlanOf = (d: Drawing): PositionTradePlan | null => {
    if (d.points.length < 3) return null;
    const side = d.kind === 'long-position' ? 'long' : 'short';
    const entry = d.points[0]!.price;
    const sl = d.points[1]!.price;
    const tp = d.points[2]!.price;
    const t = tradeRef.current;
    const riskPct = (d.style.riskPct && d.style.riskPct > 0) ? d.style.riskPct : 0.01;
    let lots = 0;
    if (t?.tickValue && t?.point && t?.balance) {
      const points = Math.abs(entry - sl) / t.point;
      const perLot = points * t.tickValue;
      if (perLot > 0) lots = (t.balance * riskPct) / perLot;
    }
    return { side, entry, sl, tp, lots };
  };

  /** A small (1-bar, ~½%) data-space offset so a clone is visibly separated. */
  const cloneOffset = (): { time: number; price: number } => {
    const bars = chartRef.current?.getBarsSnapshot() ?? [];
    const dt = bars.length >= 2 ? (bars[bars.length - 1]!.time - bars[bars.length - 2]!.time) : 0;
    const lastClose = bars.length ? bars[bars.length - 1]!.close : 0;
    return { time: dt, price: -Math.abs(lastClose) * 0.005 };
  };

  const openMenu = (clientX: number, clientY: number, overId: string | null, dataPrice: number | null) => {
    const pane = paneRef.current;
    if (!pane) return;
    const r = pane.getBoundingClientRect();
    const items = buildMenuItems(overId, dataPrice, clientX, clientY);
    if (items.length === 0) return; // nothing to offer (no callbacks wired) → native menu suppressed, no popup
    setEditor(null);
    setMenu({ x: clientX - r.left, y: clientY - r.top, items });
  };
  openMenuRef.current = openMenu;

  // ── object-properties panel: open near the click (client → pane-local) ─────────
  const openProps = (id: string, clientX: number, clientY: number) => {
    const pane = paneRef.current;
    if (!pane || !store.get(id)) return;
    const r = pane.getBoundingClientRect();
    setMenu(null);
    setEditor(null);
    setPropsPanel({ id, x: clientX - r.left, y: clientY - r.top });
  };
  openPropsRef.current = openProps;

  // ── paint ─────────────────────────────────────────────────────────────────────
  const paint = () => {
    const canvas = canvasRef.current;
    const projector = projectorRef.current;
    if (!canvas || !projector) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS px on the HiDPI backing store
    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    const env: RenderEnv = {
      width: canvas.clientWidth,
      height: canvas.clientHeight,
      priceAt: (y: number) => chartRef.current?.coordinateToPrice(y) ?? null,
      trade: tradeRef.current,
    };

    for (const d of drawingsRef.current) {
      if (d.hidden) continue;
      const tool = getTool(d.kind);
      if (!tool) continue;
      const px: PixelPoint[] = [];
      let ok = true;
      for (const pt of d.points) {
        const pr = projector.project(pt);
        if (!pr) { ok = false; break; }
        px.push({ x: pr.x, y: pr.y });
      }
      if (!ok || px.length < tool.pointCount) continue;
      tool.render(ctx, px, resolveStyle(canvas, d.style), store.isSelected(d.id), env);
    }

    // In-progress placement preview (rubber-band from the placed point(s) to the mouse).
    if (mode.current.type === 'placing' && mode.current.pending.length > 0 && mouse.current) {
      const kind = mode.current.kind;
      const tool = getTool(kind);
      const anchorPx = mode.current.pending.map((p) => projector.project(p)).filter((p): p is NonNullable<typeof p> => !!p);
      if (tool && anchorPx.length > 0) {
        const pendingPx = anchorPx.map((p) => ({ x: p.x, y: p.y }));
        const previewStyle = { ...resolveStyle(canvas, styleRef.current ?? FALLBACK_STYLE), dash: [4, 3] };
        const need = tool.pointCount;
        if (kind === 'long-position' || kind === 'short-position') {
          // Position preview: entry placed → show the box to the mouse with a derived
          // target so the reward zone is visible before the 2nd click.
          if (pendingPx.length === 1) {
            const entryData = mode.current.pending[0]!;
            const stopData = projector.unproject(mouse.current);
            if (stopData) {
              const tgt = deriveInitialTarget(entryData, stopData);
              const tgtPx = projector.project(tgt);
              if (tgtPx) tool.render(ctx, [pendingPx[0]!, mouse.current, { x: tgtPx.x, y: tgtPx.y }], previewStyle, false, env);
            }
          }
        } else if (pendingPx.length + 1 >= need || need <= 2) {
          // Tools whose render needs all N points only preview once enough are down;
          // 1- and 2-point tools preview from the mouse as the final point.
          const preview = [...pendingPx, mouse.current].slice(0, need);
          const pts = need === 1 ? [mouse.current] : preview;
          if (pts.length >= 1) tool.render(ctx, pts, previewStyle, false, env);
        } else {
          // Multi-point (≥3) tool mid-placement: draw a plain connecting polyline to
          // the mouse so the user sees the in-progress shape.
          ctx.save();
          ctx.strokeStyle = previewStyle.color;
          ctx.lineWidth = previewStyle.width;
          ctx.setLineDash([4, 3]);
          ctx.beginPath();
          ctx.moveTo(pendingPx[0]!.x, pendingPx[0]!.y);
          for (let i = 1; i < pendingPx.length; i++) ctx.lineTo(pendingPx[i]!.x, pendingPx[i]!.y);
          ctx.lineTo(mouse.current.x, mouse.current.y);
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    // In-progress freehand stroke (the brush, while pressed).
    if (mode.current.type === 'freehand' && mode.current.pending.length >= 1) {
      const tool = getTool(mode.current.kind);
      const px = mode.current.pending.map((p) => projector.project(p)).filter((p): p is NonNullable<typeof p> => !!p).map((p) => ({ x: p.x, y: p.y }));
      if (tool && px.length >= 2) tool.render(ctx, px, resolveStyle(canvas, styleRef.current ?? FALLBACK_STYLE), false, env);
    }

    // Marquee rectangle (box-select rubber band).
    if (marquee.current?.active) {
      const { start, cur } = marquee.current;
      const x0 = Math.min(start.x, cur.x); const y0 = Math.min(start.y, cur.y);
      const w = Math.abs(cur.x - start.x); const h = Math.abs(cur.y - start.y);
      ctx.save();
      const accent = resolveColor(canvas, 'var(--accent)');
      ctx.strokeStyle = accent;
      ctx.fillStyle = accent;
      ctx.globalAlpha = 0.08; ctx.fillRect(x0, y0, w, h);
      ctx.globalAlpha = 0.9; ctx.lineWidth = 1; ctx.setLineDash([4, 3]); ctx.strokeRect(x0, y0, w, h);
      ctx.restore();
    }
  };

  // The canvas defaults to pointer-events:none (set live by updateCapture). zIndex
  // sits above the chart canvas but below the loading/empty overlays. The text editor,
  // measure box, and context menu mount alongside it (DOM overlays, theme-aware).
  return (
    <>
      <canvas
        ref={canvasRef}
        className="drawing-overlay"
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 3 }}
      />
      {editor && (
        <textarea
          className="dtext-edit"
          autoFocus
          value={editor.value}
          placeholder="Type… (Enter to commit, Esc to cancel)"
          style={{ position: 'absolute', left: editor.left, top: editor.top, zIndex: 7 }}
          onChange={(e) => setEditor((cur) => (cur ? { ...cur, value: e.target.value } : cur))}
          onBlur={() => commitEditor(false)}
          onKeyDown={(e) => {
            // Enter commits (Shift+Enter inserts a newline); Escape cancels.
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitEditor(false); }
            else if (e.key === 'Escape') { e.preventDefault(); commitEditor(true); }
            e.stopPropagation(); // don't let the pane hotkeys see typing
          }}
          onMouseDown={(e) => e.stopPropagation()}
        />
      )}
      {measure && <MeasureBox m={measure} />}
      {menu && <ContextMenu x={menu.x} y={menu.y} bounds={paneSize(paneRef)} items={menu.items} onClose={() => setMenu(null)} />}
      {propsPanel && (
        <ObjectProperties
          store={store}
          id={propsPanel.id}
          x={propsPanel.x}
          y={propsPanel.y}
          bounds={paneSize(paneRef)}
          onClose={() => setPropsPanel(null)}
        />
      )}
      {/* Mobile selection toolbar (#9): mobile has no right-click / Delete key / object
          manager, so when a drawing is selected, float a compact Edit / Delete / Deselect
          bar at the top of the pane. Hidden while editing text or the props panel is open. */}
      {isMobile && selectedId && !editor && !propsPanel && (
        <div className="draw-seltools" role="toolbar" aria-label="Selected drawing">
          <button
            className="draw-seltool"
            title="Edit settings"
            onClick={() => { const r = paneRef.current?.getBoundingClientRect(); if (r) openProps(selectedId, r.left + r.width / 2, r.top + r.height / 3); }}
          >✎ Edit</button>
          <button
            className="draw-seltool draw-seltool-danger"
            title="Delete drawing"
            onClick={() => { store.remove(selectedId); store.select(null); }}
          >🗑 Delete</button>
          <button className="draw-seltool" title="Deselect" onClick={() => store.select(null)}>✕</button>
        </div>
      )}
    </>
  );
}

/** The pane's current size in px (for clamping the context menu). */
function paneSize(paneRef: React.RefObject<HTMLDivElement | null>): { width: number; height: number } {
  const el = paneRef.current;
  return { width: el?.clientWidth ?? 0, height: el?.clientHeight ?? 0 };
}

/** The shift+drag ruler box — a translucent rectangle between the two pixel anchors
 *  with the Δprice / % / bars (+ lots when sized) readout. Green up, red down. */
function MeasureBox({ m }: { m: MeasureState }) {
  const x0 = Math.min(m.startPx.x, m.curPx.x);
  const y0 = Math.min(m.startPx.y, m.curPx.y);
  const w = Math.abs(m.curPx.x - m.startPx.x);
  const h = Math.abs(m.curPx.y - m.startPx.y);
  const { fill, line } = measureColors(m.readout.direction);
  const sign = m.readout.dPrice > 0 ? '+' : '';
  const lines = [
    `${sign}${fmtMenuPrice(m.readout.dPrice)} (${sign}${m.readout.dPercent.toFixed(2)}%)`,
    `${m.readout.bars} bars`,
  ];
  if (m.readout.lots !== null) lines.push(`${m.readout.lots.toFixed(2)} lots`);
  return (
    <div className="dmeasure" style={{ position: 'absolute', left: x0, top: y0, width: w, height: h, zIndex: 6, borderColor: line, background: fill }}>
      <div className="dmeasure-tag" style={{ background: line }}>
        {lines.map((l, i) => <div key={i}>{l}</div>)}
      </div>
    </div>
  );
}
