/**
 * DrawingStore — a tiny framework-light observable holding the drawing objects +
 * the current selection. Mirrors the repo's settings-store pattern
 * (`getSnapshot` + `subscribe`) so React consumes it via `useSyncExternalStore`
 * with no extra dependency, and the imperative controller (CanvasOverlay's pointer
 * FSM) reads/writes it directly.
 *
 * Snapshot stability: `list()` returns the SAME array reference until a mutation,
 * so `useSyncExternalStore` doesn't loop. Every mutation rebuilds the array once and
 * bumps a version, then notifies subscribers.
 *
 * Scope: the slice keeps one flat store. Per-(account,symbol,tf) scoping +
 * persistence (area G) layer on top later by swapping which store a pane reads — the
 * store API doesn't change.
 */

import type { Drawing } from './types';
import type { DataPoint } from './CoordinateProjector';

type Listener = () => void;

let idCounter = 0;
/** Monotonic, collision-free id for a new drawing. */
export function nextDrawingId(): string {
  idCounter += 1;
  return `dw_${Date.now().toString(36)}_${idCounter.toString(36)}`;
}

/** A point-in-time copy of the drawings (for undo/redo). Selection is intentionally
 *  NOT part of history — undo restores geometry/style, not what was highlighted. */
type HistorySnapshot = Drawing[];

/** Max undo depth (bounded — drawings are cheap but a runaway history isn't). */
const HISTORY_LIMIT = 100;

export class DrawingStore {
  private byId = new Map<string, Drawing>();
  private order: string[] = [];
  /** The primary selection (kept for the single-select API the slice/harness use). */
  private selected: string | null = null;
  /** The full selection set (multi-select). Always contains `selected` when non-null. */
  private selectedSet = new Set<string>();
  private listeners = new Set<Listener>();
  /** Cached ordered snapshot; invalidated (set null) on any mutation. */
  private cache: Drawing[] | null = [];

  // ── undo/redo history ─────────────────────────────────────────────────────────
  // We snapshot the drawing list (deep-ish: each Drawing is replaced immutably on
  // edit, so a shallow array copy + per-drawing object identity is enough to restore
  // — undo/redo swap whole-list snapshots). The controller batches a drag into ONE
  // commit by calling `beginBatch()` at grab and `commit()` at release.
  private undoStack: HistorySnapshot[] = [];
  private redoStack: HistorySnapshot[] = [];
  private batching = false;

  // ── subscription (useSyncExternalStore contract) ────────────────────────────
  subscribe = (cb: Listener): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  private emit(): void {
    this.cache = null; // rebuild on next read
    for (const l of this.listeners) l();
  }

  // ── reads ────────────────────────────────────────────────────────────────────
  /** Ordered drawings (stable reference until the next mutation). */
  list = (): Drawing[] => {
    if (this.cache === null) this.cache = this.order.map((id) => this.byId.get(id)!).filter(Boolean);
    return this.cache;
  };

  get(id: string): Drawing | undefined {
    return this.byId.get(id);
  }

  selectedId = (): string | null => this.selected;

  /** The full (multi-)selection as a stable-ish array. Includes the primary. */
  selectedIds = (): string[] => [...this.selectedSet];

  /** Whether `id` is part of the current selection. */
  isSelected(id: string): boolean { return this.selectedSet.has(id); }

  // ── undo/redo internals ────────────────────────────────────────────────────────
  /** Capture the current list onto the undo stack (and clear redo). During a batch,
   *  only the first call records — so a multi-step drag is a single undo step. */
  private record(): void {
    if (this.batching) return; // a batch already captured its "before" at beginBatch
    this.pushUndo();
  }
  private pushUndo(): void {
    this.undoStack.push(this.list().slice());
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  /** Start a batch: capture ONE "before" snapshot; subsequent mutations until
   *  `commit()` won't each push history. Used to make a drag one undo step. */
  beginBatch(): void {
    if (this.batching) return;
    this.pushUndo();
    this.batching = true;
  }
  /** End a batch. If nothing actually changed during it, drop the snapshot we pushed
   *  so an empty drag (click-without-move) doesn't leave a no-op undo step. */
  commit(): void {
    if (!this.batching) return;
    this.batching = false;
    const prev = this.undoStack[this.undoStack.length - 1];
    if (prev && sameList(prev, this.list())) this.undoStack.pop();
  }

  canUndo(): boolean { return this.undoStack.length > 0; }
  canRedo(): boolean { return this.redoStack.length > 0; }

  undo(): void {
    const snap = this.undoStack.pop();
    if (!snap) return;
    this.redoStack.push(this.list().slice());
    this.restore(snap);
  }
  redo(): void {
    const snap = this.redoStack.pop();
    if (!snap) return;
    this.undoStack.push(this.list().slice());
    this.restore(snap);
  }
  /** Replace the whole drawing set from a history snapshot (no new history entry). */
  private restore(snap: HistorySnapshot): void {
    this.byId.clear();
    this.order = [];
    for (const d of snap) { this.byId.set(d.id, d); this.order.push(d.id); }
    // prune selection to surviving ids.
    for (const id of [...this.selectedSet]) if (!this.byId.has(id)) this.selectedSet.delete(id);
    if (this.selected && !this.byId.has(this.selected)) this.selected = null;
    this.emit();
  }

  // ── mutations (each records history first; drags batch via beginBatch/commit) ──
  add(d: Drawing): void {
    this.record();
    this.byId.set(d.id, d);
    this.order.push(d.id);
    this.emit();
  }

  /** Replace a drawing wholesale (immutable-style edit). No-op if it's gone. */
  replace(d: Drawing): void {
    if (!this.byId.has(d.id)) return;
    this.record();
    this.byId.set(d.id, d);
    this.emit();
  }

  /** Update just the style of a drawing (used by the style row). No-op if gone. */
  setStyle(id: string, style: Drawing['style']): void {
    const d = this.byId.get(id);
    if (!d) return;
    this.record();
    this.byId.set(id, { ...d, style: { ...style } });
    this.emit();
  }

  /** Toggle/set the locked flag (locked drawings ignore drag/delete). */
  setLocked(id: string, locked: boolean): void {
    const d = this.byId.get(id);
    if (!d || !!d.locked === locked) return;
    this.record();
    this.byId.set(id, { ...d, locked });
    this.emit();
  }

  /** Toggle/set the hidden flag (hidden drawings are not painted/hit-tested). */
  setHidden(id: string, hidden: boolean): void {
    const d = this.byId.get(id);
    if (!d || !!d.hidden === hidden) return;
    this.record();
    this.byId.set(id, { ...d, hidden });
    this.emit();
  }

  /** Move one anchor of a drawing to a new data point. */
  movePoint(id: string, index: number, pt: DataPoint): void {
    const d = this.byId.get(id);
    if (!d || index < 0 || index >= d.points.length) return;
    this.record();
    const points = d.points.slice();
    points[index] = pt;
    this.byId.set(id, { ...d, points });
    this.emit();
  }

  /** Translate every anchor of a drawing by a data-space delta. */
  moveBy(id: string, dt: number, dp: number): void {
    const d = this.byId.get(id);
    if (!d) return;
    this.record();
    const points = d.points.map((p) => ({ time: p.time + dt, price: p.price + dp }));
    this.byId.set(id, { ...d, points });
    this.emit();
  }

  /** Set every anchor of a drawing absolutely (used by body-drag from an origin). */
  setPoints(id: string, points: DataPoint[]): void {
    const d = this.byId.get(id);
    if (!d) return;
    this.record();
    this.byId.set(id, { ...d, points: points.map((p) => ({ ...p })) });
    this.emit();
  }

  remove(id: string): void {
    if (!this.byId.has(id)) return;
    this.record();
    this.byId.delete(id);
    this.order = this.order.filter((x) => x !== id);
    this.selectedSet.delete(id);
    if (this.selected === id) this.selected = this.selectedSet.size ? [...this.selectedSet][0]! : null;
    this.emit();
  }

  /** Move a drawing to the TOP of the z-order (painted last → above everything). The
   *  paint + hit-test walk `order` front-to-back, so "front" == end of the array. */
  bringToFront(id: string): void {
    const i = this.order.indexOf(id);
    if (i < 0 || i === this.order.length - 1) return; // gone or already on top
    this.record();
    this.order.splice(i, 1);
    this.order.push(id);
    this.emit();
  }

  /** Move a drawing to the BOTTOM of the z-order (painted first → below everything). */
  sendToBack(id: string): void {
    const i = this.order.indexOf(id);
    if (i <= 0) return; // gone or already at the back
    this.record();
    this.order.splice(i, 1);
    this.order.unshift(id);
    this.emit();
  }

  /** Duplicate a drawing (offset slightly so the clone is visible) and select it.
   *  Returns the new id, or null when the source is gone. */
  clone(id: string, offset: { time: number; price: number } = { time: 0, price: 0 }): string | null {
    const d = this.byId.get(id);
    if (!d) return null;
    this.record();
    const copy: Drawing = {
      ...d,
      id: nextDrawingId(),
      points: d.points.map((p) => ({ time: p.time + offset.time, price: p.price + offset.price })),
      style: { ...d.style },
      source: 'user',
    };
    this.byId.set(copy.id, copy);
    this.order.push(copy.id);
    this.selected = copy.id;
    this.selectedSet.clear();
    this.selectedSet.add(copy.id);
    this.emit();
    return copy.id;
  }

  /** Remove several drawings in one undo step (locked ones are skipped). */
  removeMany(ids: string[]): void {
    const removable = ids.filter((id) => this.byId.has(id) && !this.byId.get(id)!.locked);
    if (removable.length === 0) return;
    this.record();
    for (const id of removable) { this.byId.delete(id); this.selectedSet.delete(id); }
    const gone = new Set(removable);
    this.order = this.order.filter((x) => !gone.has(x));
    if (this.selected && gone.has(this.selected)) this.selected = this.selectedSet.size ? [...this.selectedSet][0]! : null;
    this.emit();
  }

  /** Set the PRIMARY selection (and reset the multi-select set to just it). */
  select(id: string | null): void {
    if (this.selected === id && this.selectedSet.size === (id ? 1 : 0) && (id === null || this.selectedSet.has(id))) return;
    this.selected = id;
    this.selectedSet.clear();
    if (id) this.selectedSet.add(id);
    this.emit();
  }

  /** Replace the whole selection set (the last id becomes primary). For marquee. */
  selectMany(ids: string[]): void {
    this.selectedSet.clear();
    for (const id of ids) if (this.byId.has(id)) this.selectedSet.add(id);
    this.selected = ids.length ? ids[ids.length - 1]! : null;
    this.emit();
  }

  /** Toggle `id` in the multi-selection (shift-click). The toggled id becomes (or,
   *  if removed, yields) the primary. */
  toggleSelect(id: string): void {
    if (!this.byId.has(id)) return;
    if (this.selectedSet.has(id)) {
      this.selectedSet.delete(id);
      if (this.selected === id) this.selected = this.selectedSet.size ? [...this.selectedSet][this.selectedSet.size - 1]! : null;
    } else {
      this.selectedSet.add(id);
      this.selected = id;
    }
    this.emit();
  }

  clear(): void {
    if (this.byId.size === 0 && this.selected === null) return;
    this.record();
    this.byId.clear();
    this.order = [];
    this.selected = null;
    this.selectedSet.clear();
    this.emit();
  }

  /** Bulk-load (e.g. from persistence). Replaces everything. Does
   *  NOT push undo history (a context restore is not a user edit) and RESETS history
   *  so undo can't cross into another instrument's drawings. */
  load(drawings: Drawing[]): void {
    this.byId.clear();
    this.order = [];
    for (const d of drawings) { this.byId.set(d.id, d); this.order.push(d.id); }
    this.selected = null;
    this.selectedSet.clear();
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.batching = false;
    this.emit();
  }
}

/** Shallow list equality by per-drawing object identity (drawings are replaced
 *  immutably on edit, so identity ⇒ unchanged). Used to drop no-op drag commits. */
function sameList(a: Drawing[], b: Drawing[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
