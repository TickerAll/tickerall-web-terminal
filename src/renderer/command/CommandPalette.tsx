/**
 * CommandPalette — the Cmd/Ctrl-K overlay (area J / Platform). Self-contained:
 *
 *   • Owns its OWN open/close: a capture-phase Cmd/Ctrl-K listener toggles it, so the
 *     only shell hook is mounting <CommandPalette/> once (no extra key wiring / no
 *     hoisted open-state to thread). An optional toolbar affordance opens it via the
 *     exported `openCommandPalette()` imperative.
 *   • Reads the live `commandRegistry` through `useSyncExternalStore` (the repo's
 *     no-dependency observable pattern), ranks with the dependency-free fuzzy matcher.
 *   • Full keyboard model: ↑/↓ (+ Ctrl-N/P) move, Enter runs, Esc/Cmd-K/backdrop-click
 *     closes, Tab/Shift-Tab is trapped to the input (the list is mouse+arrow driven).
 *   • Theme-aware: every colour is a CSS var already defined in index.html, so it
 *     re-themes live with the rest of the shell (dark/light/tertiary/8-bit/16-bit).
 *
 * Styling is injected once as a scoped <style> (id `cmdk-style`) using the shell's
 * tokens — no index.html edit needed, keeping this drop-in and self-contained.
 */

import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
  useSyncExternalStore,
} from 'react';
import { commandRegistry, rankCommands, type Command, type RankedCommand } from './registry';

// ── Imperative open/close (for the toolbar affordance + tests) ───────────────────
const openListeners = new Set<(open: boolean) => void>();
/** Open the palette from anywhere (e.g. a toolbar button). */
export function openCommandPalette(): void { for (const l of openListeners) l(true); }
/** Close the palette from anywhere. */
export function closeCommandPalette(): void { for (const l of openListeners) l(false); }

/** True when the event is the Cmd/Ctrl-K palette toggle (and not inside an IME). */
function isPaletteToggle(e: KeyboardEvent): boolean {
  return (e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;
}

const STYLE_ID = 'cmdk-style';
const CMDK_CSS = `
.cmdk-backdrop {
  position: fixed; inset: 0; z-index: 100;
  background: var(--backdrop, #0008);
  display: flex; align-items: flex-start; justify-content: center;
  padding-top: 12vh;
}
.cmdk-panel {
  width: 560px; max-width: calc(100vw - 32px); max-height: 64vh;
  display: flex; flex-direction: column; overflow: hidden;
  background: var(--panel, #11161d);
  border: 1px solid var(--line2, #28323f);
  border-radius: calc(12px * var(--skin-radius-mult, 1));
  box-shadow: 0 24px 64px var(--shadow, #000a);
  font-family: var(--skin-font, inherit);
}
.cmdk-input {
  width: 100%; box-sizing: border-box;
  background: var(--panel2, #0d1117);
  border: 0; border-bottom: 1px solid var(--line, #1d2530);
  color: var(--fg, #c9d1d9);
  padding: 14px 16px; font-size: 15px; outline: none;
  font-family: inherit;
}
.cmdk-input::placeholder { color: var(--muted, #7d8590); }
.cmdk-list { overflow-y: auto; padding: 6px 0; }
.cmdk-empty { padding: 22px 16px; color: var(--muted, #7d8590); font-size: 13px; text-align: center; }
.cmdk-section {
  padding: 8px 16px 4px; font-size: 10px; letter-spacing: .06em; text-transform: uppercase;
  color: var(--muted, #7d8590);
}
.cmdk-item {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 16px; cursor: pointer; font-size: 13.5px;
  color: var(--fg, #c9d1d9); border-left: 2px solid transparent;
}
.cmdk-item.active { background: var(--sel, #16202c); border-left-color: var(--accent, #2f81f7); }
.cmdk-item:hover:not(.active) { background: var(--hover, #161d27); }
.cmdk-title { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cmdk-title b { color: var(--accent, #2f81f7); font-weight: 600; }
.cmdk-hint {
  flex: 0 0 auto; color: var(--muted, #7d8590); font-size: 11px;
  font-variant-numeric: tabular-nums; padding: 1px 7px;
  border: 1px solid var(--line, #1d2530); border-radius: 5px; background: var(--panel2, #0d1117);
}
.cmdk-foot {
  display: flex; gap: 14px; padding: 7px 16px; border-top: 1px solid var(--line, #1d2530);
  color: var(--muted, #7d8590); font-size: 10.5px;
}
.cmdk-foot kbd {
  font-family: inherit; border: 1px solid var(--line2, #28323f); border-radius: 4px;
  padding: 0 4px; background: var(--panel2, #0d1117); color: var(--fg, #c9d1d9);
}
`;

/** Inject the palette stylesheet once (idempotent). */
function ensureStyle(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CMDK_CSS;
  document.head.appendChild(s);
}

/** Render a title with the fuzzy-matched characters bolded. */
function Highlighted({ text, positions }: { text: string; positions: number[] }) {
  if (positions.length === 0) return <>{text}</>;
  const set = new Set(positions);
  const out: React.ReactNode[] = [];
  let run = '';
  let bold = false;
  const flush = () => { if (run) { out.push(bold ? <b key={out.length}>{run}</b> : <span key={out.length}>{run}</span>); run = ''; } };
  for (let i = 0; i < text.length; i++) {
    const isHit = set.has(i);
    if (isHit !== bold) { flush(); bold = isHit; }
    run += text[i];
  }
  flush();
  return <>{out}</>;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Restore focus to whatever was focused before the palette opened.
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  // Live command list from the registry (stable ref until a mutation).
  const commands = useSyncExternalStore(commandRegistry.subscribe, commandRegistry.list);

  const ranked: RankedCommand[] = useMemo(() => rankCommands(query, commands), [query, commands]);

  // Build the flat render rows (section headers + items) and the navigable item map.
  const { rows, itemRows } = useMemo(() => {
    const r: Array<{ kind: 'section'; label: string } | { kind: 'item'; rc: RankedCommand; itemIndex: number }> = [];
    const items: Array<{ rc: RankedCommand }> = [];
    let lastSection: string | null = null;
    for (const rc of ranked) {
      const section = rc.cmd.section ?? 'Commands';
      if (section !== lastSection) { r.push({ kind: 'section', label: section }); lastSection = section; }
      r.push({ kind: 'item', rc, itemIndex: items.length });
      items.push({ rc });
    }
    return { rows: r, itemRows: items };
  }, [ranked]);

  const close = useCallback(() => setOpen(false), []);

  const runItem = useCallback((cmd: Command) => {
    setOpen(false);
    // Defer so the overlay unmounts before the action mutates shell state.
    queueMicrotask(() => { void cmd.run(); });
  }, []);

  // ── Global toggle: capture-phase Cmd/Ctrl-K (+ imperative open/close) ──────────
  useEffect(() => {
    ensureStyle();
    const onKey = (e: KeyboardEvent) => {
      if (isPaletteToggle(e)) {
        e.preventDefault();
        e.stopPropagation();
        setOpen((v) => !v);
      }
    };
    // Capture phase so it wins even when focus is in an input.
    window.addEventListener('keydown', onKey, true);
    const onImperative = (v: boolean) => setOpen(v);
    openListeners.add(onImperative);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      openListeners.delete(onImperative);
    };
  }, []);

  // On open: reset query/selection, remember the previously-focused element, focus the
  // input. On close: restore focus.
  useEffect(() => {
    if (open) {
      restoreFocusRef.current = (document.activeElement as HTMLElement) ?? null;
      setQuery('');
      setActiveIdx(0);
      // focus after paint so the input exists.
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      restoreFocusRef.current?.focus?.();
      restoreFocusRef.current = null;
    }
  }, [open]);

  // Keep the active index in range as the filtered list shrinks/grows.
  useEffect(() => {
    setActiveIdx((i) => (itemRows.length === 0 ? 0 : Math.min(i, itemRows.length - 1)));
  }, [itemRows.length]);

  // Scroll the active item into view.
  useLayoutEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-item="${activeIdx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx, open]);

  // ── Keyboard model while open (on the panel) ──────────────────────────────────
  const onPanelKeyDown = useCallback((e: React.KeyboardEvent) => {
    const n = itemRows.length;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (n) setActiveIdx((i) => (i + 1) % n);
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (n) setActiveIdx((i) => (i - 1 + n) % n);
        break;
      case 'n': // Ctrl-N (emacs-ish) — down
        if (e.ctrlKey && !e.metaKey) { e.preventDefault(); if (n) setActiveIdx((i) => (i + 1) % n); }
        break;
      case 'p': // Ctrl-P — up
        if (e.ctrlKey && !e.metaKey) { e.preventDefault(); if (n) setActiveIdx((i) => (i - 1 + n) % n); }
        break;
      case 'Home':
        e.preventDefault(); setActiveIdx(0); break;
      case 'End':
        e.preventDefault(); if (n) setActiveIdx(n - 1); break;
      case 'Enter': {
        e.preventDefault();
        const it = itemRows[activeIdx];
        if (it) runItem(it.rc.cmd);
        break;
      }
      case 'Escape':
        e.preventDefault(); e.stopPropagation(); close(); break;
      case 'Tab':
        // Focus-trap: the only focusable element is the input; keep focus there.
        e.preventDefault();
        inputRef.current?.focus();
        break;
      default:
        break;
    }
  }, [itemRows, activeIdx, runItem, close]);

  if (!open) return null;

  return (
    <div
      className="cmdk-backdrop"
      onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div className="cmdk-panel" onKeyDown={onPanelKeyDown}>
        <input
          ref={inputRef}
          className="cmdk-input"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActiveIdx(0); }}
          placeholder="Type a command…"
          aria-label="Search commands"
          aria-controls="cmdk-listbox"
          aria-activedescendant={itemRows[activeIdx] ? `cmdk-opt-${activeIdx}` : undefined}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <div className="cmdk-list" ref={listRef} id="cmdk-listbox" role="listbox">
          {itemRows.length === 0 ? (
            <div className="cmdk-empty">No matching commands</div>
          ) : (
            rows.map((row, i) =>
              row.kind === 'section' ? (
                <div className="cmdk-section" key={`s-${i}`}>{row.label}</div>
              ) : (
                <div
                  key={row.rc.cmd.id}
                  id={`cmdk-opt-${row.itemIndex}`}
                  data-item={row.itemIndex}
                  role="option"
                  aria-selected={row.itemIndex === activeIdx}
                  className={`cmdk-item${row.itemIndex === activeIdx ? ' active' : ''}`}
                  onMouseMove={() => setActiveIdx(row.itemIndex)}
                  onMouseDown={(e) => { e.preventDefault(); /* keep input focus */ }}
                  onClick={() => runItem(row.rc.cmd)}
                >
                  <span className="cmdk-title">
                    <Highlighted text={row.rc.cmd.title} positions={row.rc.titleMatched ? row.rc.hit.positions : []} />
                  </span>
                  {row.rc.cmd.hint && <span className="cmdk-hint">{row.rc.cmd.hint}</span>}
                </div>
              ),
            )
          )}
        </div>
        <div className="cmdk-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> run</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
