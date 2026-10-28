/**
 * ChartTabs — a TradingView-style tab strip of open charts. Each tab is one
 * (account, symbol) the user has charted; it remembers its own timeframe. Tabs can
 * be pinned (pinned ones sort first and survive). The active tab is whichever tab
 * matches the shell's current (activeId, activeSymbol) — one ChartPane renders it.
 *
 * It owns no state: the shell holds the tab list + the active (account, symbol) and
 * passes handlers. The right end carries the chart's maximize/restore toggle.
 */

import { useRef } from 'react';
import { TF_LABEL } from '../../shared/types';
import type { ChartLayout } from './mosaic';

/** The layout switcher's buttons: [layout, glyph, tooltip]. Exported so the mobile ☰
 *  drawer can offer the same picker (it's hidden on the mobile tab strip to save width). */
export const LAYOUTS: [ChartLayout, string, string][] = [
  ['single', '▢', 'Single chart'],
  ['cols', '▥', 'Side by side'],
  ['rows', '▤', 'Stacked'],
  ['grid', '▦', 'Grid'],
];

/** One open chart. `id` is `${accountId}::${symbol}` — unique per chart. */
export type ChartTab = {
  id: string;
  accountId: string;
  symbol: string;
  timeframe: number;
  pinned: boolean;
};

export function ChartTabs({
  tabs, activeTabId, onActivate, onClose, onTogglePin, onReorder, onAddChart, layout, onSetLayout, maximized, onToggleMax, onStartTabDock, shownIds,
}: {
  tabs: ChartTab[];
  activeTabId: string | null;
  onActivate: (t: ChartTab) => void;
  onClose: (t: ChartTab) => void;
  onTogglePin: (t: ChartTab) => void;
  onReorder: (fromId: string, toId: string) => void;
  onAddChart: () => void;
  layout: ChartLayout;
  onSetLayout: (l: ChartLayout) => void;
  maximized: boolean;
  onToggleMax: () => void;
  /** Begin a TOUCH dock-drag of a strip tab (HTML5 DnD is dead on touch). Fires when the
   *  finger drags a tab VERTICALLY (a horizontal swipe still scrolls the strip); the mosaic
   *  then tracks + commits via dragSourceId. */
  onStartTabDock?: (tabId: string) => void;
  /** Ids of tabs currently shown as a chart pane in the mosaic (multi-chart layout only). When
   *  provided, each tab shows a dot — filled = on the canvas, hollow = strip-only (drag it onto
   *  a chart to show it). Undefined in single-chart layout, where the dot is meaningless. */
  shownIds?: Set<string>;
}) {
  // Whether the last tab press was a touch — so onDragStart cancels the native HTML5 drag on
  // touch (it fights the custom pointer-drag and never commits the drop on mobile).
  const lastDownTouch = useRef(false);
  // Tabs render in array order; manual drag-reorder controls it (pinned shows a star).
  return (
    <div className="chart-tabs">
      <div className="chart-tabs-scroll">
        {tabs.map((t) => {
          const on = t.id === activeTabId;
          const shown = shownIds?.has(t.id) ?? false;
          return (
            <div
              key={t.id}
              className={`ctab ${on ? 'on' : ''} ${t.pinned ? 'pinned' : ''} ${shown ? 'shown' : ''}`}
              draggable
              onPointerDown={(e) => {
                lastDownTouch.current = e.pointerType === 'touch';
                if (e.pointerType !== 'touch') return;
                if ((e.target as HTMLElement).closest('button')) return; // pin/close tap, not a drag
                const sx = e.clientX, sy = e.clientY, pid = e.pointerId, el = e.currentTarget as HTMLElement;
                let started = false;
                const onMove = (ev: PointerEvent) => {
                  if (started) return;
                  const dx = ev.clientX - sx, dy = ev.clientY - sy;
                  if (Math.hypot(dx, dy) <= 8) return;
                  window.removeEventListener('pointermove', onMove);
                  // vertical-dominant drag → start the dock; horizontal → leave it to the strip scroll
                  if (Math.abs(dy) > Math.abs(dx)) {
                    started = true;
                    try { el.setPointerCapture(pid); } catch { /* unsupported */ }
                    onStartTabDock?.(t.id);
                  }
                };
                const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
                window.addEventListener('pointermove', onMove);
                window.addEventListener('pointerup', onUp);
              }}
              onDragStart={(e) => {
                if (lastDownTouch.current) { e.preventDefault(); return; } // touch → the pointer-drag owns it
                e.dataTransfer.setData('text/tab', t.id); e.dataTransfer.setData('application/x-chart-tab', t.id); e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
              onDrop={(e) => { e.preventDefault(); const from = e.dataTransfer.getData('text/tab'); if (from) onReorder(from, t.id); }}
              onClick={() => onActivate(t)}
              onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); onClose(t); } }} // middle-click closes
              title={shownIds ? (shown ? `${t.symbol} · on the chart` : `${t.symbol} · drag onto a chart to show`) : `${t.symbol} · ${TF_LABEL[t.timeframe] ?? ''}`}
            >
              {shownIds ? <span className="ctab-dot" aria-hidden /> : null}
              <button
                className="ctab-pin"
                title={t.pinned ? 'Unpin' : 'Pin'}
                onClick={(e) => { e.stopPropagation(); onTogglePin(t); }}
              >{t.pinned ? '★' : '☆'}</button>
              <span className="ctab-sym">{t.symbol}</span>
              <span className="ctab-tf">{TF_LABEL[t.timeframe] ?? ''}</span>
              <button
                className="ctab-x"
                title="Close"
                onClick={(e) => { e.stopPropagation(); onClose(t); }}
              >×</button>
            </div>
          );
        })}
        <button className="ctab-add" type="button" title="New chart" onClick={onAddChart}>＋</button>
      </div>
      <div className="ctab-layout">
        {LAYOUTS.map(([l, ico, title]) => (
          <button
            key={l}
            type="button"
            className={`ctab-lay ${layout === l ? 'on' : ''}`}
            title={title}
            onClick={() => onSetLayout(l)}
          >{ico}</button>
        ))}
      </div>
      <button
        className="ctab-max"
        title={maximized ? 'Restore chart' : 'Maximize chart'}
        onClick={onToggleMax}
      >{maximized ? '⤡' : '⤢'}</button>
    </div>
  );
}
