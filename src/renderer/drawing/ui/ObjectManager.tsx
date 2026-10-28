/**
 * ObjectManager — a small panel listing the pane's drawings (MT5's Ctrl+B object
 * list, scoped to this chart). Each row: a kind icon + label, select-on-click,
 * and hide / lock / delete toggles. Locked rows can't be dragged or deleted (the
 * delete button is disabled); hidden rows skip rendering. For a text label, the
 * row's label is editable inline so you can name it after placing.
 *
 * Reads/writes the same DrawingStore the overlay uses, so toggling here updates the
 * canvas immediately (and vice-versa: selecting on the canvas highlights the row).
 */

import { useEffect, useState } from 'react';
import type { DrawingStore } from '../DrawingStore';
import type { Drawing } from '../types';
import { TOOL_META_BY_KIND } from '../tools';
import { useDrawingList, useSelectedSet } from './useDrawings';
import { ensureDrawingChrome } from './drawingChrome';

interface Props {
  store: DrawingStore;
  onClose: () => void;
}

function labelFor(d: Drawing): string {
  const meta = TOOL_META_BY_KIND[d.kind];
  if (d.kind === 'text') return d.style.text && d.style.text.length ? d.style.text : 'Text';
  return meta?.label ?? d.kind;
}

export function ObjectManager({ store, onClose }: Props) {
  const list = useDrawingList(store);
  const selected = useSelectedSet(store);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  // Ensure the injected chrome (locked-row indicator etc.) is present even if the
  // manager is somehow mounted before the toolbar. Idempotent.
  useEffect(() => { ensureDrawingChrome(); }, []);

  const startEdit = (d: Drawing) => {
    if (d.kind !== 'text') return;
    setEditingId(d.id);
    setEditValue(d.style.text ?? '');
  };
  const commitEdit = (d: Drawing) => {
    store.setStyle(d.id, { ...d.style, text: editValue });
    setEditingId(null);
  };

  return (
    <div className="omp">
      <div className="omp-head">
        <span>Objects ({list.length})</span>
        <button type="button" className="omp-x" title="Close" onClick={onClose}>✕</button>
      </div>
      {list.length === 0 ? (
        <div className="omp-empty">No drawings on this chart.</div>
      ) : (
        <ul className="omp-list">
          {/* newest on top — mirrors the z-order (last drawn is top-most) */}
          {[...list].reverse().map((d) => {
            const meta = TOOL_META_BY_KIND[d.kind];
            const isSel = selected.has(d.id);
            return (
              <li
                key={d.id}
                className={`omp-row ${isSel ? 'on' : ''} ${d.hidden ? 'hidden' : ''} ${d.locked ? 'locked' : ''}`}
                onClick={(e) => { if (e.shiftKey) store.toggleSelect(d.id); else store.select(d.id); }}
                onDoubleClick={() => startEdit(d)}
              >
                <span className="omp-ico" style={{ color: d.style.color.startsWith('var(') ? 'var(--accent)' : d.style.color }}>
                  {meta?.icon ?? '•'}
                </span>
                {editingId === d.id ? (
                  <input
                    className="omp-edit"
                    autoFocus
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={() => commitEdit(d)}
                    onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(d); else if (e.key === 'Escape') setEditingId(null); }}
                  />
                ) : (
                  <span className="omp-label">{labelFor(d)}</span>
                )}
                <span className="omp-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className={`omp-act ${d.hidden ? 'off' : ''}`}
                    title={d.hidden ? 'Show' : 'Hide'}
                    onClick={() => store.setHidden(d.id, !d.hidden)}
                  >{d.hidden ? '🚫' : '👁'}</button>
                  <button
                    type="button"
                    className={`omp-act ${d.locked ? 'on' : ''}`}
                    title={d.locked ? 'Unlock' : 'Lock'}
                    onClick={() => store.setLocked(d.id, !d.locked)}
                  >{d.locked ? '🔒' : '🔓'}</button>
                  <button
                    type="button"
                    className="omp-act"
                    title={d.locked ? 'Unlock to delete' : 'Delete'}
                    disabled={d.locked}
                    onClick={() => store.remove(d.id)}
                  >🗑</button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
