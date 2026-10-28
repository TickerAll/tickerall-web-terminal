/**
 * DrawingLayer — bundles the drawing engine's UI + canvas for one chart pane: the
 * CanvasOverlay (the painting + pointer FSM), the left DrawingToolbar (tool picker +
 * style row), and the ObjectManager panel. It owns the per-pane UI state the overlay
 * needs (active style, magnet on/off, manager open) and the tool-arming hotkeys,
 * scoped to THIS pane (only when the pointer is over it).
 *
 * `activeTool` / `setActiveTool` are controlled by the parent (ChartPane) so the
 * existing imperative `ChartPaneHandle.setActiveTool` keeps working. Everything else
 * (style, magnet, manager) is local UI state; persistence of the magnet preference
 * is the parent's concern (passed via `magnet`/`onMagnetChange` when wired to a
 * setting — defaults to a local toggle otherwise).
 */

import { useEffect, useRef, useState } from 'react';
import { CanvasOverlay, type OverlayChart, type DrawingActions, type PositionTradePlan } from '../CanvasOverlay';
import type { DrawingStore } from '../DrawingStore';
import type { DrawingKind, DrawingStyle } from '../types';
import type { TradeContext } from '../tools/registry';
import { TOOL_META } from '../tools';
import { DrawingToolbar } from './DrawingToolbar';
import { ObjectManager } from './ObjectManager';

interface Props {
  paneRef: React.RefObject<HTMLDivElement | null>;
  chart: OverlayChart | null;
  store: DrawingStore;
  /** The armed tool (controlled by ChartPane so the imperative handle still works). */
  activeTool: DrawingKind | null;
  setActiveTool: (k: DrawingKind | null) => void;
  /** Magnet on/off, controlled by the parent (persisted via a setting). */
  magnet: boolean;
  setMagnet: (v: boolean) => void;
  /** Default style for new drawings, controlled by the parent (persisted). */
  style: DrawingStyle;
  setStyle: (s: DrawingStyle) => void;
  /** ── The SEAM (all optional; the engine works fully with these undefined) ──────
   *  Per-symbol trade context that sizes the long/short position tool + the measure
   *  ruler, and enables the "New order here" menu item. Pass from ChartPane with the
   *  live symbol's point/tickValue/contractSize/bid/ask/balance. */
  trade?: TradeContext;
  /** Chart/shell actions for the right-click empty-chart menu. An absent callback
   *  simply hides that menu item. */
  actions?: DrawingActions;
  /** Called when the user picks "Place this trade" on a position-tool drawing. */
  onPlaceOrder?: (plan: PositionTradePlan) => void;
  /** Mobile tier — enables the touch selection toolbar in the overlay (#9). */
  isMobile?: boolean;
}

/** Hotkey → kind map (single letters; armed only when this pane is hovered). */
const HOTKEYS: Record<string, DrawingKind> = Object.fromEntries(
  TOOL_META.filter((m) => m.hotkey).map((m) => [m.hotkey!, m.kind]),
);

export function DrawingLayer({ paneRef, chart, store, activeTool, setActiveTool, magnet, setMagnet, style, setStyle, trade, actions, onPlaceOrder, isMobile }: Props) {
  const [managerOpen, setManagerOpen] = useState(false);
  // Track whether the pointer is over THIS pane, so hotkeys only arm the hovered
  // chart (mirrors the overlay's pane-scoped Delete/Escape — no global tool arming).
  const hovered = useRef(false);

  useEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;
    const onEnter = () => { hovered.current = true; };
    const onLeave = () => { hovered.current = false; };
    pane.addEventListener('mouseenter', onEnter);
    pane.addEventListener('mouseleave', onLeave);
    const onKey = (e: KeyboardEvent) => {
      if (!hovered.current) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || t?.isContentEditable) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return; // leave Ctrl/Cmd combos to the overlay (undo) / shell
      const k = e.key.toLowerCase();
      const kind = HOTKEYS[k];
      if (kind) { e.preventDefault(); setActiveTool(activeTool === kind ? null : kind); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      pane.removeEventListener('mouseenter', onEnter);
      pane.removeEventListener('mouseleave', onLeave);
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneRef, activeTool]);

  return (
    <>
      <CanvasOverlay
        paneRef={paneRef}
        chart={chart}
        store={store}
        activeTool={activeTool}
        defaultStyle={style}
        magnet={magnet}
        onPlaced={() => setActiveTool(null)}
        trade={trade}
        actions={actions}
        onPlaceOrder={onPlaceOrder}
        isMobile={isMobile}
      />
      <DrawingToolbar
        store={store}
        paneRef={paneRef}
        activeTool={activeTool}
        setActiveTool={setActiveTool}
        style={style}
        setStyle={setStyle}
        magnet={magnet}
        setMagnet={setMagnet}
        managerOpen={managerOpen}
        setManagerOpen={setManagerOpen}
      />
      {managerOpen && <ObjectManager store={store} onClose={() => setManagerOpen(false)} />}
    </>
  );
}
