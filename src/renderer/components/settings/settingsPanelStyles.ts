/**
 * Idempotent style injection for the custom settings panels (Chart Colors + Profiles).
 *
 * The bulk of the Settings page CSS lives in index.html, but these two panels are owned
 * by this cluster and add a few layout-only classes that index.html doesn't carry. We
 * inject them once here (the same inject-once-by-id pattern the ThemeProvider uses for
 * its chrome CSS) rather than touch index.html — every rule reads the theme `--vars`, so
 * it recolours with the active theme automatically. All the row / control / button /
 * badge classes are reused from index.html; only the panel-specific wrappers are new.
 */

const STYLE_ID = 'settings-panels-style';

const CSS = `
/* ── Chart Colors panel ── */
.sp-chart-colors { padding-top:2px; }
.sp-cc-intro { margin:0 0 10px; font-size:12.5px; line-height:1.5; max-width:62ch; }
.sp-cc-row .sp-row-control { align-items:center; }
.sp-cc-reset { background:transparent; color:var(--muted); border:1px solid var(--line2);
  border-radius:7px; padding:5px 10px; font-size:11.5px; font-weight:600; font-family:inherit;
  white-space:nowrap; cursor:pointer; }
.sp-cc-reset:hover:not(:disabled) { color:var(--fg); border-color:var(--line-hover); }
.sp-cc-reset:disabled { opacity:.4; cursor:default; }
.sp-cc-actions { display:flex; gap:8px; margin-top:14px; }
.sp-badge-muted { background:transparent; color:var(--muted); border:1px solid var(--line2); }

/* ── Profiles panel ── */
.sp-profiles { padding-top:2px; }
.sp-profiles-intro { margin:0 0 14px; font-size:12.5px; line-height:1.5; max-width:62ch; }
.sp-profiles-save { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:16px; }
.sp-profiles-save .sp-text { flex:1; min-width:160px; width:auto; }
.sp-profiles-list { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; }
.sp-profile { display:flex; align-items:center; justify-content:space-between; gap:16px;
  padding:11px 2px; border-bottom:1px solid var(--line); }
.sp-profile.active { background:linear-gradient(90deg, color-mix(in srgb, var(--accent) 8%, transparent), transparent 60%); }
.sp-profile-name { font-size:13.5px; font-weight:600; display:flex; align-items:center; gap:8px; min-width:0;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.sp-profile-actions { display:flex; gap:6px; flex:none; }
.sp-profile-actions .sp-btn { padding:6px 12px; }
.sp-profile-rename { display:flex; gap:6px; align-items:center; width:100%; }
.sp-profile-rename .sp-text { flex:1; min-width:120px; width:auto; }

/* ── "Apply to all charts" action (Item 12) ── */
.sp-apply-all { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-top:8px; }
.sp-apply-help { line-height:1.4; max-width:54ch; }
.sp-apply-confirm { line-height:1.4; max-width:48ch; }
.sp-apply-confirm code { font-size:11px; }
.sp-apply-done { color:var(--up); font-weight:600; }

/* pixel skins: square the panel chrome to match the retro look */
body.theme-8bit .sp-cc-reset, body.theme-16bit .sp-cc-reset,
body.theme-8bit .sp-badge-muted, body.theme-16bit .sp-badge-muted {
  border-radius:0; border-width:var(--skin-border-width); border-style:solid;
}
`;

/** Inject the panel styles once (no-op if already present). */
export function ensureSettingsPanelStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}
