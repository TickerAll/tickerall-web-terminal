/**
 * drawingChrome — injects a one-time `<style>` overriding the drawing-engine chrome
 * that ships in index.html (the `.dtb*` tool-toolbar rules). We can't edit index.html
 * from here, so we mirror ThemeProvider's `ensureChromeStyle()` pattern: append a
 * `<style>` to `document.head` AFTER index.html's block, so for equal specificity our
 * rules win the cascade (later wins). We bump the rules a touch in specificity
 * (`.dtb.dtb`) where index.html sets the same property, so the override is robust.
 *
 * What it changes (vs index.html):
 *   - bigger tap targets: `.dtb-btn` 28→36px, `.dtb-ico` 13→18px;
 *   - a drag-grip header (`.dtb-grip`) the user grabs to reposition the toolbar
 *     anywhere in the pane (the position itself is applied inline by DrawingToolbar
 *     and persisted in localStorage — this only styles the grip);
 *   - a `.dtb.dragging` affordance while moving;
 *   - a locked-row indicator (`.omp-row.locked`) in the object manager (index.html
 *     styles `.omp-row.hidden` but not `.locked`), so a locked object reads as
 *     frozen at a glance.
 *
 * Everything stays theme-aware (CSS vars only), so it re-skins with the terminal
 * theme exactly like the base rules.
 */

const DRAWING_CHROME_ID = 'drawing-chrome';

const DRAWING_CHROME_CSS = `
/* Bigger, friendlier tool buttons + icons (override index.html's 28px/13px). The
   doubled selector (.dtb.dtb) edges out the base rule's specificity so the size
   override is robust regardless of stylesheet order. */
.dtb.dtb .dtb-btn { width:36px; height:36px; border-radius:7px; }
.dtb.dtb .dtb-ico { font-size:18px; }
.dtb.dtb .dtb-sep { width:26px; }

/* ── Fixed toolbar width (Task 3) ──────────────────────────────────────────────
   The vertical palette must NOT change width when the style row / selection UI
   appears. We pin a CONSTANT width and force the inner rows (style swatches, width
   + line-style chips) to wrap/scroll INSIDE that width instead of widening the bar.
   56px comfortably fits one 36px button centred within the bar's 4px side padding;
   the base center alignment is kept so buttons + separators stay centred. */
.dtb.dtb { width:56px; min-width:56px; max-width:56px; box-sizing:border-box; }
/* The style row lives at the bottom; constrain it to the bar's inner width and let
   its rows wrap (and, if ever taller than the bar, the bar's own overflow-y scrolls). */
.dtb.dtb .dtb-style { width:100%; max-width:100%; box-sizing:border-box; overflow-x:hidden; }
.dtb.dtb .dtb-swatches { grid-template-columns:repeat(4, 1fr); width:100%; box-sizing:border-box; padding:0 2px; }
.dtb.dtb .dtb-swatch { width:100%; max-width:14px; justify-self:center; }
.dtb.dtb .dtb-widths, .dtb.dtb .dtb-linestyles { flex-wrap:wrap; width:100%; box-sizing:border-box; padding:0 2px; }
.dtb.dtb .dtb-ls { min-width:0; flex:1 1 auto; }
.dtb.dtb .dtb-fill { width:100%; justify-content:center; box-sizing:border-box; }

/* Header row: the drag grip (grab to move) + a collapse chevron (Task 3). */
.dtb-head { display:flex; align-items:center; gap:2px; width:100%; margin:-1px 0 3px; }
.dtb-grip {
  display:flex; align-items:center; justify-content:center;
  flex:1; height:16px; border-radius:5px;
  color:var(--muted); cursor:grab; user-select:none; letter-spacing:2px;
  font-size:11px; line-height:1;
}
.dtb-grip:hover { background:var(--hover); color:var(--fg); }
.dtb.dragging { box-shadow:0 8px 26px rgba(0,0,0,.5); }
.dtb.dragging .dtb-grip { cursor:grabbing; background:var(--hover); color:var(--fg); }
/* Collapse (hide) chevron — flush right in the header. */
.dtb-collapse {
  flex:none; width:18px; height:16px; display:flex; align-items:center; justify-content:center;
  background:transparent; border:none; border-radius:5px; color:var(--muted); cursor:pointer;
  font-size:13px; line-height:1; padding:0;
}
.dtb-collapse:hover { background:var(--hover); color:var(--fg); }

/* Floating "show tools" button when the toolbar is collapsed (Task 3). Sits where
   the toolbar's top-left would be; click to restore. */
.dtb-show {
  position:absolute; top:10px; left:8px; z-index:6;
  display:flex; align-items:center; gap:2px; padding:6px 7px;
  background:var(--panel); border:1px solid var(--line2); border-radius:8px;
  color:var(--muted); cursor:pointer; box-shadow:0 4px 16px rgba(0,0,0,.35);
  font-size:13px; line-height:1;
}
.dtb-show:hover { color:var(--fg); border-color:var(--line-hover); }
.dtb-show-ico { font-size:14px; }
.dtb-show-chev { font-size:12px; opacity:.8; }

/* The Select cursor glyph — a touch bolder/bigger so the arrow reads as a pointer. */
.dtb.dtb .dtb-ico-cursor { font-size:19px; font-weight:700; }

/* Trade-planner buttons: tint the up/down glyphs so Long/Short read as buy/sell at a
   glance (they're plain triangles otherwise). The .on (armed) state keeps the accent
   fill from the base rule, so this only colours the idle glyph. */
.dtb-btn-long-position:not(.on) .dtb-ico { color:var(--up, #26a69a); }
.dtb-btn-short-position:not(.on) .dtb-ico { color:var(--down, #ef5350); }

/* Object-manager: a locked row reads as frozen — a subtle left accent + muted label,
   and the lock button shows its active (on) tint via the base .omp-act.on rule. */
.omp-row.locked { box-shadow:inset 2px 0 0 var(--accent); }
.omp-row.locked .omp-label { color:var(--muted); }
.omp-act.on { color:var(--accent); opacity:1; }

/* ── Inline text editor (Task 1) ───────────────────────────────────────────────
   An auto-sizing textarea anchored over a text drawing's top-left. Theme-aware; it
   sits above the canvas (zIndex set inline). */
.dtext-edit {
  min-width:80px; min-height:22px; max-width:340px; padding:3px 5px; resize:both;
  font:13px system-ui, sans-serif; line-height:1.25;
  color:var(--fg); background:var(--panel); caret-color:var(--accent);
  border:1px solid var(--accent); border-radius:5px; outline:none;
  box-shadow:0 4px 16px rgba(0,0,0,.4);
}
.dtext-edit::placeholder { color:var(--muted); }

/* ── Measure ruler box (Task 6) ────────────────────────────────────────────────
   A translucent rectangle (colour set inline by direction) with a floating readout
   tag. Pointer-events:none so it never eats the gesture. */
.dmeasure { border:1px solid; border-radius:2px; pointer-events:none; }
.dmeasure-tag {
  position:absolute; left:50%; top:-2px; transform:translate(-50%, -100%);
  padding:3px 6px; border-radius:4px; white-space:nowrap;
  color:#fff; font:11px system-ui, sans-serif; line-height:1.3; text-align:center;
  box-shadow:0 2px 8px rgba(0,0,0,.4);
}

/* ── Right-click context menu (Task 2) ─────────────────────────────────────────
   A positioned popup; theme-aware, scrolls if very tall. */
.dctx {
  position:absolute; z-index:8; min-width:180px; max-height:80%; overflow-y:auto;
  padding:4px; background:var(--panel); border:1px solid var(--line2); border-radius:8px;
  box-shadow:0 8px 28px rgba(0,0,0,.5); font:12px system-ui, sans-serif;
}
.dctx-item {
  display:flex; align-items:center; gap:8px; width:100%; padding:6px 8px;
  background:transparent; border:none; border-radius:5px; color:var(--fg);
  cursor:pointer; text-align:left; font:inherit;
}
.dctx-item:hover:not(:disabled) { background:var(--hover); }
.dctx-item:disabled { opacity:.4; cursor:default; }
.dctx-item.danger { color:var(--danger, #e5484d); }
.dctx-ico { width:16px; text-align:center; flex:none; opacity:.9; }
.dctx-label { flex:1; }
.dctx-sep { height:1px; margin:4px 2px; background:var(--line); }

/* ── Object properties panel (Task 9) ──────────────────────────────────────────
   A themed editor for the selected drawing — colour / width / line / opacity / fill,
   text + font, and the position planner's entry/SL/TP + risk%. Mounts in the pane
   (absolute), clamps on-screen, scrolls if tall. */
.dprops {
  position:absolute; z-index:8; width:248px; max-height:88%; display:flex; flex-direction:column;
  background:var(--panel); border:1px solid var(--line2); border-radius:9px;
  box-shadow:0 10px 32px rgba(0,0,0,.55); font:12px system-ui, sans-serif; color:var(--fg);
  overflow:hidden;
}
.dprops-head {
  display:flex; align-items:center; gap:7px; padding:8px 10px;
  border-bottom:1px solid var(--line); font-weight:600;
}
.dprops-ico { font-size:13px; flex:none; }
.dprops-title { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dprops-x {
  flex:none; background:transparent; border:none; color:var(--muted); cursor:pointer;
  font-size:12px; padding:2px 5px; border-radius:5px;
}
.dprops-x:hover { background:var(--hover); color:var(--fg); }
.dprops-body { padding:8px 10px; overflow-y:auto; display:flex; flex-direction:column; gap:8px; }
.dprops-divider { height:1px; margin:2px 0; background:var(--line); }

.dprops-field { display:flex; align-items:center; gap:8px; min-height:24px; }
.dprops-flabel { flex:none; width:74px; color:var(--muted); font-size:11px; }
.dprops-fctl { flex:1; min-width:0; display:flex; align-items:center; }

/* swatches */
.dprops-swatches { display:flex; flex-wrap:wrap; gap:4px; align-items:center; }
.dprops-swatch {
  width:16px; height:16px; border-radius:4px; border:1px solid var(--line2); cursor:pointer; padding:0;
}
.dprops-swatch.on { outline:2px solid var(--fg); outline-offset:1px; }
.dprops-swatch-custom {
  position:relative; overflow:hidden; display:flex; align-items:center; justify-content:center;
  background:conic-gradient(from 0deg, #f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00);
}
.dprops-swatch-custom input { position:absolute; inset:-4px; opacity:0; cursor:pointer; }

/* segmented controls (width / line style) */
.dprops-segs { display:flex; gap:3px; flex-wrap:wrap; width:100%; }
.dprops-seg {
  flex:1 1 auto; min-width:26px; height:22px; display:flex; align-items:center; justify-content:center;
  background:var(--hover); border:1px solid var(--line2); border-radius:5px; color:var(--muted);
  cursor:pointer; font-size:11px; padding:0 4px;
}
.dprops-seg.on { border-color:var(--accent); background:var(--sel); color:var(--fg); }
.dprops-seg-wide { min-width:48px; }
.dprops-wbar { width:14px; background:currentColor; border-radius:2px; display:block; }

/* range slider (opacity) */
.dprops-range { width:100%; accent-color:var(--accent); }

/* toggles + flags */
.dprops-toggle { display:flex; align-items:center; gap:6px; cursor:pointer; color:var(--fg); }
.dprops-toggle input { margin:0; accent-color:var(--accent); }
.dprops-flags { display:flex; gap:14px; }

/* text + selects + numeric inputs */
.dprops-text {
  width:100%; box-sizing:border-box; resize:vertical; min-height:38px;
  background:var(--bg); border:1px solid var(--line2); color:var(--fg); border-radius:6px;
  padding:5px 7px; font:12px system-ui, sans-serif; line-height:1.3;
}
.dprops-text:focus { outline:none; border-color:var(--accent); }
.dprops-select {
  width:100%; box-sizing:border-box; background:var(--bg); border:1px solid var(--line2); color:var(--fg);
  border-radius:6px; padding:4px 6px; font:12px system-ui, sans-serif; cursor:pointer;
}
.dprops-select:focus { outline:none; border-color:var(--accent); }
.dprops-row { display:flex; gap:6px; width:100%; }
.dprops-select-sm { flex:1; }
.dprops-num {
  width:72px; box-sizing:border-box; background:var(--bg); border:1px solid var(--line2); color:var(--fg);
  border-radius:6px; padding:4px 6px; font:12px system-ui, sans-serif; font-variant-numeric:tabular-nums;
}
.dprops-num:focus { outline:none; border-color:var(--accent); }
.dprops-num-wide { width:100%; }
`;

/** Inject the drawing-chrome override stylesheet once (idempotent). Called when the
 *  toolbar mounts; safe to call repeatedly. */
export function ensureDrawingChrome(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(DRAWING_CHROME_ID)) return;
  const style = document.createElement('style');
  style.id = DRAWING_CHROME_ID;
  style.textContent = DRAWING_CHROME_CSS;
  document.head.appendChild(style);
}
