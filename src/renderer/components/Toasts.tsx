/**
 * Toasts — a tiny, self-contained, theme-aware toast surface (TERMINAL-ROADMAP areas
 * I/J: the in-app alert surface). There was no toast UI in the terminal; this is it.
 *
 * Design: a framework-light observable (`toasts.push/dismiss`, mirroring the
 * settings-/DrawingStore pattern so React reads it via `useSyncExternalStore` with no
 * new dependency) + a `<Toasts/>` component that renders the live stack in a fixed
 * top-right column. Any module can fire a toast imperatively from anywhere:
 *
 *     import { pushToast } from '../components/Toasts';
 *     pushToast({ kind: 'alert', title: 'EURUSD ↑ 1.0850', body: 'crossed above' });
 *
 * Toasts auto-dismiss after `ttlMs` (default 6s; 0 = sticky until clicked/closed).
 * Colours are driven entirely by CSS variables (the `.toast` / `.toast-*` rules in
 * index.html) so they re-theme live with the rest of the app.
 */

import { useSyncExternalStore } from 'react';

export type ToastKind = 'alert' | 'info' | 'success' | 'error';

export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  body?: string;
  /** Auto-dismiss after this many ms (0 = stay until dismissed). Default 6000. */
  ttlMs?: number;
}

/** What `pushToast` accepts (id is assigned for you). */
export type ToastInput = Omit<Toast, 'id'> & { id?: string };

// ── the observable store ──────────────────────────────────────────────────────
let items: Toast[] = [];
const listeners = new Set<() => void>();
let idCounter = 0;
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function emit(): void {
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Stable snapshot for useSyncExternalStore (same ref until a mutation). */
function getSnapshot(): Toast[] {
  return items;
}

/** Fire a toast. Returns its id (so a caller can dismiss it early). */
export function pushToast(input: ToastInput): string {
  idCounter += 1;
  const id = input.id ?? `toast_${Date.now().toString(36)}_${idCounter.toString(36)}`;
  const toast: Toast = { ttlMs: 6000, ...input, id };
  items = [...items, toast];
  emit();
  const ttl = toast.ttlMs ?? 6000;
  if (ttl > 0) {
    // setTimeout is a no-op-safe global; guarded so a non-DOM host doesn't crash.
    if (typeof setTimeout === 'function') {
      const t = setTimeout(() => dismissToast(id), ttl);
      timers.set(id, t);
    }
  }
  return id;
}

/** Remove a toast (by the click handler or its TTL). */
export function dismissToast(id: string): void {
  const t = timers.get(id);
  if (t != null) {
    clearTimeout(t);
    timers.delete(id);
  }
  const next = items.filter((x) => x.id !== id);
  if (next.length === items.length) return; // already gone
  items = next;
  emit();
}

/** The number of live toasts (handy for diagnostics / tests / a tray badge). */
export function toastCount(): number {
  return items.length;
}

/** Clear every toast (e.g. on logout / account switch). */
export function clearToasts(): void {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  if (items.length === 0) return;
  items = [];
  emit();
}

// ── the surface ───────────────────────────────────────────────────────────────

const ICON: Record<ToastKind, string> = {
  alert: '🔔',
  info: 'ℹ',
  success: '✓',
  error: '✕',
};

/** The toast stack. Mount ONCE near the app root (sibling of the shell, after it so
 *  it overlays). Pointer-events are scoped to the cards so the stack never blocks the
 *  chart underneath. */
export function Toasts(): JSX.Element | null {
  const list = useSyncExternalStore(subscribe, getSnapshot);
  if (list.length === 0) return null;
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {list.map((t) => (
        <div
          key={t.id}
          className={`toast toast-${t.kind}`}
          onClick={() => dismissToast(t.id)}
          title="Click to dismiss"
        >
          <span className="toast-icon">{ICON[t.kind]}</span>
          <div className="toast-text">
            <div className="toast-title">{t.title}</div>
            {t.body ? <div className="toast-body">{t.body}</div> : null}
          </div>
          <button
            className="toast-x"
            onClick={(e) => {
              e.stopPropagation();
              dismissToast(t.id);
            }}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
