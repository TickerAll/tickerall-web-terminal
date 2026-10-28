/**
 * SettingsPage — the full-page Settings VIEW (replaces the old centre modal). A real
 * sectioned preferences surface:
 *
 *   ┌──────────────┬───────────────────────────────────────────────┐
 *   │  search      │  <section title>                              │
 *   │  General     │                                               │
 *   │  Appearance  │   [theme picker — Appearance only]            │
 *   │  Chart       │   SettingRow  (auto-rendered from descriptors)│
 *   │  Sounds      │   SettingRow                                  │
 *   │  Per-chart   │   …                                           │
 *   │  Data/Acct   │                                               │
 *   │  Advanced    │   [export / import / reset — Advanced only]   │
 *   └──────────────┴───────────────────────────────────────────────┘
 *
 * Controls are AUTO-RENDERED from `SETTINGS_DESCRIPTORS` grouped by `section`
 * (boolean→toggle, options→select, number→number, color→swatch, string→text — see
 * SettingRow). Every control reads/writes the settings store, so edits LIVE-APPLY with
 * no save button. The search box fuzzily filters controls by label/path across every
 * section. Appearance carries a first-class THEME PICKER (live swatch previews) wired
 * to `appearance.theme`. Advanced wires Export / Import / Reset-section / Reset-all to
 * the `settings:export|import|reset` IPC.
 *
 * The page is self-contained: every prop is optional, so it can be mounted on its own.
 * The host (Terminal.tsx) supplies `chartKey` (for the per-chart "this chart only"
 * toggles), `onClose`, and the Data/Account actions.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  SETTINGS_DESCRIPTORS, DEFAULT_SETTINGS, PER_CHART_PATHS, type SettingDescriptor,
} from '../../shared/settingsSchema';
import {
  BUILTIN_THEMES, THEME_ORDER, resolveTheme,
} from '../theme/tokens';
import { useSetting } from '../settings/hooks';
import {
  resetSettings, exportSettings, importSettings, applyChartSettingsToAll,
} from '../settings/store';
import { SettingRow } from './settings/SettingRow';
import { ThemeSwatch } from './settings/ThemeSwatch';
import { ChartColorsPanel } from './settings/ChartColorsPanel';
import { ProfilesPanel } from './settings/ProfilesPanel';
import { ensureSettingsPanelStyles } from './settings/settingsPanelStyles';

// Inject the cluster's panel CSS (incl. the "Apply to all charts" action styles) once,
// in case neither custom panel that also injects it is rendered.
ensureSettingsPanelStyles();

// ── Section ordering ─────────────────────────────────────────────────────────
// The canonical nav order. Sections with descriptors render generically; the three
// SPECIAL sections (Per-chart defaults / Data & Account / Advanced) are always present
// even though they aren't (only) descriptor-driven. Any descriptor section not listed
// here is appended after, so a future cluster's new section still shows up.
const PER_CHART = 'Per-chart defaults';
const DATA_ACCOUNT = 'Data & Account';
const ADVANCED = 'Advanced';
// Custom (non-descriptor) sections with their own panels.
const CHART_COLORS = 'Chart Colors';
const PROFILES = 'Profiles';
const SPECIAL = [CHART_COLORS, PER_CHART, PROFILES, DATA_ACCOUNT, ADVANCED];
// Known descriptor sections in display order; the special sections come last. Any
// descriptor section NOT listed here (a future cluster's) is appended after these.
// Chart Colors sits right after Chart; Profiles before Data/Account + Advanced.
const PREFERRED_ORDER = ['General', 'Appearance', 'Chart', CHART_COLORS, 'Sounds', 'Alerts', PER_CHART, PROFILES, DATA_ACCOUNT, ADVANCED];

/** The ordered list of sections to show in the nav. */
function useSections(): string[] {
  return useMemo(() => {
    const fromDescriptors = Array.from(new Set(SETTINGS_DESCRIPTORS.map((d) => d.section)));
    const known = new Set(PREFERRED_ORDER);
    const extra = fromDescriptors.filter((s) => !known.has(s)); // future clusters' sections
    // Keep preferred order; drop preferred entries that have no descriptors AND aren't
    // special (so we don't show an empty "Chart" if every chart descriptor were removed).
    const ordered = PREFERRED_ORDER.filter(
      (s) => SPECIAL.includes(s) || fromDescriptors.includes(s),
    );
    return [...ordered, ...extra];
  }, []);
}

/** Descriptors for one section (Per-chart defaults aggregates every perChart row). */
function descriptorsForSection(section: string): SettingDescriptor[] {
  if (section === PER_CHART) return SETTINGS_DESCRIPTORS.filter((d) => d.perChart);
  return SETTINGS_DESCRIPTORS.filter((d) => d.section === section);
}

export function SettingsPage({
  chartKey = null, onClose, onReloadChart, userEmail, onLogout,
}: {
  /** Active chart scope key `${accountId}:${symbol}:${tf}` for per-chart overrides. */
  chartKey?: string | null;
  onClose?: () => void;
  onReloadChart?: () => void;
  userEmail?: string;
  onLogout?: () => void;
}) {
  const sections = useSections();
  const [active, setActive] = useState<string>(sections[0] ?? 'General');
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const searching = q.length > 0;

  // Item 4 — drag the modal by its title bar. Offset from the backdrop's centred
  // position; captured at grab so the move is a clean delta.
  const [dragPos, setDragPos] = useState({ x: 0, y: 0 });
  const startDrag = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.sp-close')) return; // not from the × button
    e.preventDefault();
    const ox = dragPos.x, oy = dragPos.y, sx = e.clientX, sy = e.clientY;
    const onMove = (ev: MouseEvent) => setDragPos({ x: ox + (ev.clientX - sx), y: oy + (ev.clientY - sy) });
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'grabbing';
  };

  // Search hits across ALL sections (label or dot-path). Dedup by path.
  const hits = useMemo<SettingDescriptor[]>(() => {
    if (!searching) return [];
    const seen = new Set<string>();
    return SETTINGS_DESCRIPTORS.filter((d) => {
      if (seen.has(d.path)) return false;
      const hit = d.label.toLowerCase().includes(q) || d.path.toLowerCase().includes(q)
        || d.section.toLowerCase().includes(q) || (d.help?.toLowerCase().includes(q) ?? false);
      if (hit) seen.add(d.path);
      return hit;
    });
  }, [q, searching]);

  // Per-section hit counts (for the nav badges while searching).
  const sectionHitCount = useMemo<Record<string, number>>(() => {
    if (!searching) return {};
    const counts: Record<string, number> = {};
    for (const d of hits) {
      counts[d.section] = (counts[d.section] ?? 0) + 1;
      if (d.perChart) counts[PER_CHART] = (counts[PER_CHART] ?? 0) + 1;
    }
    return counts;
  }, [hits, searching]);

  // Esc closes the modal (alongside the backdrop click + the × button).
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // A centred modal over the workspace (not a full-page takeover). Reuses the
  // existing `.modal-backdrop` for the dim/centre; the `.sp` grid is sized as a
  // dialog via inline (theme-aware) styles so this needs no index.html change.
  return (
    <div className="modal-backdrop" onClick={() => onClose?.()}>
      <div
        className="sp"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative', inset: 'auto', zIndex: 'auto',
          width: 'min(960px, 94vw)', height: 'min(680px, 88vh)',
          border: '1px solid var(--line2)', borderRadius: 12,
          boxShadow: '0 16px 48px var(--shadow)', overflow: 'hidden',
          transform: `translate(${dragPos.x}px, ${dragPos.y}px)`,
        }}
      >
      {/* ── Left: section nav + search ── */}
      <nav className="sp-nav">
        <div className="sp-nav-head" onMouseDown={startDrag} style={{ cursor: 'grab' }}>
          <span className="sp-nav-title">Settings</span>
          {onClose && (
            <button className="sp-close" onClick={onClose} title="Close settings" aria-label="Close settings">×</button>
          )}
        </div>
        <div className="sp-search">
          <input
            type="search"
            placeholder="Search settings…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search settings"
            spellCheck={false}
          />
        </div>
        <ul className="sp-nav-list">
          {sections.map((s) => {
            const count = sectionHitCount[s];
            const dim = searching && !count && s !== ADVANCED && s !== DATA_ACCOUNT;
            return (
              <li key={s}>
                <button
                  className={`sp-nav-item ${!searching && active === s ? 'on' : ''} ${dim ? 'dim' : ''}`}
                  onClick={() => { setActive(s); setQuery(''); }}
                >
                  <span>{s}</span>
                  {searching && count ? <span className="sp-nav-count">{count}</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
        {chartKey && (
          <div className="sp-nav-foot muted tiny">
            Per-chart overrides apply to<br /><code>{chartKey}</code>
          </div>
        )}
      </nav>

      {/* ── Right: the active section (or search results) ── */}
      <div className="sp-content">
        {searching ? (
          <>
            <div className="sp-section-head">
              <h2>{hits.length} result{hits.length === 1 ? '' : 's'} for “{query}”</h2>
            </div>
            {hits.length === 0
              ? <div className="sp-empty muted">No settings match. Try a different term.</div>
              : hits.map((d) => (
                  <SettingRow key={d.path} descriptor={d} chartKey={chartKey} matched={q} />
                ))}
          </>
        ) : (
          <Section
            section={active}
            chartKey={chartKey}
            onReloadChart={onReloadChart}
            userEmail={userEmail}
            onLogout={onLogout}
          />
        )}
      </div>
      </div>
    </div>
  );
}

// ── A single section's content ───────────────────────────────────────────────
function Section({
  section, chartKey, onReloadChart, userEmail, onLogout,
}: {
  section: string;
  chartKey: string | null;
  onReloadChart?: () => void;
  userEmail?: string;
  onLogout?: () => void;
}) {
  // Appearance shows the first-class ThemePicker (swatches) below, so drop the
  // redundant appearance.theme dropdown the descriptor list would otherwise add.
  const rows = descriptorsForSection(section).filter(
    (d) => !(section === 'Appearance' && d.path === 'appearance.theme'),
  );
  return (
    <>
      <div className="sp-section-head">
        <h2>{section}</h2>
        {section === PER_CHART && (
          <p className="muted">
            {chartKey
              ? <>Defaults you can override for the active chart only (<code>{chartKey}</code>). Use the “this chart” toggle on a row.</>
              : 'Open a chart to set per-chart overrides. These are the settings that support a per-chart value.'}
          </p>
        )}
        {(section === 'Chart' || section === PER_CHART) && <ApplyToAllCharts chartKey={chartKey} />}
      </div>

      {section === 'Appearance' && <ThemePicker />}
      {section === CHART_COLORS && <ChartColorsPanel />}
      {section === PROFILES && <ProfilesPanel />}

      {rows.map((d) => (
        <SettingRow key={d.path} descriptor={d} chartKey={chartKey} />
      ))}

      {section === DATA_ACCOUNT && (
        <DataAccount onReloadChart={onReloadChart} userEmail={userEmail} onLogout={onLogout} />
      )}
      {section === ADVANCED && <Advanced section={section} />}

      {rows.length === 0 && SPECIAL.indexOf(section) < 0 && (
        <div className="sp-empty muted">Nothing configurable here yet.</div>
      )}
    </>
  );
}

// ── "Apply to all charts" (Item 12) ──────────────────────────────────────────
// Promotes the ACTIVE chart's effective per-chartable settings to the GLOBAL base and
// clears every chart's per-chart override of those keys, so every chart inherits the
// same values. Destructive of per-chart overrides → a small inline two-step confirm.
// Disabled when no chart is active (no scope to read from).
function ApplyToAllCharts({ chartKey }: { chartKey: string | null }) {
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);

  const apply = () => {
    applyChartSettingsToAll(chartKey);
    setConfirming(false);
    setDone(true);
    window.setTimeout(() => setDone(false), 2600);
  };

  const n = PER_CHART_PATHS.length;
  return (
    <div className="sp-apply-all">
      {!confirming ? (
        <>
          <button
            className="sp-btn ghost"
            disabled={!chartKey}
            onClick={() => { setDone(false); setConfirming(true); }}
            title={chartKey
              ? 'Make every chart use this chart’s settings (clears all per-chart overrides for those settings)'
              : 'Open a chart first'}
          >
            Apply to all charts
          </button>
          <span className="sp-apply-help muted tiny">
            {done
              ? <span className="sp-apply-done">Applied to all charts.</span>
              : chartKey
                ? <>Use the active chart’s {n} per-chart setting{n === 1 ? '' : 's'} everywhere, clearing per-chart overrides.</>
                : 'Open a chart to use its settings as the default for all charts.'}
          </span>
        </>
      ) : (
        <>
          <span className="sp-apply-confirm muted tiny">
            Set <b>every</b> chart to <code>{chartKey}</code>’s settings? This clears all per-chart overrides for those settings.
          </span>
          <button className="sp-btn danger" onClick={apply}>Apply to all</button>
          <button className="sp-btn ghost" onClick={() => setConfirming(false)}>Cancel</button>
        </>
      )}
    </div>
  );
}

// ── Appearance: the first-class theme picker with live previews ──────────────
function ThemePicker() {
  const [theme, setTheme] = useSetting<string>('appearance.theme');
  const activeId = resolveTheme(theme).id;
  return (
    <div className="sp-theme">
      <div className="sp-theme-grid">
        {THEME_ORDER.map((id) => {
          const def = BUILTIN_THEMES[id];
          if (!def) return null;
          return (
            <ThemeSwatch key={id} def={def} active={def.id === activeId} onPick={() => setTheme(def.id)} />
          );
        })}
      </div>
      <p className="sp-theme-note muted tiny">
        Themes re-apply live — the whole app (chart included) recolours instantly.
      </p>
    </div>
  );
}

// ── Data & Account: the non-descriptor actions the old modal carried ─────────
function DataAccount({
  onReloadChart, userEmail, onLogout,
}: {
  onReloadChart?: () => void;
  userEmail?: string;
  onLogout?: () => void;
}) {
  return (
    <>
      <div className="sp-action-row">
        <div className="sp-row-label">
          <div className="sp-row-title">Chart data</div>
          <div className="sp-row-help">Charts stream live from the tick feed (no caching). Reload to refetch history.</div>
        </div>
        <button className="sp-btn" disabled={!onReloadChart} onClick={onReloadChart}>Reload chart</button>
      </div>
      <div className="sp-action-row">
        <div className="sp-row-label">
          <div className="sp-row-title">Account</div>
          <div className="sp-row-help">{userEmail ?? 'signed in'}</div>
        </div>
        <button className="sp-btn ghost" disabled={!onLogout} onClick={onLogout}>Sign out</button>
      </div>
    </>
  );
}

// ── Advanced: export / import / reset, wired to the settings IPC ─────────────
function Advanced({ section }: { section: string }) {
  const [exported, setExported] = useState('');
  const [importText, setImportText] = useState('');
  const [status, setStatus] = useState('');

  const doExport = async () => {
    const json = await exportSettings();
    setExported(json);
    setStatus('Exported current settings as JSON below.');
    // Best-effort clipboard copy (CSP allows it; ignore if denied).
    try { await navigator.clipboard?.writeText(json); setStatus('Settings JSON copied to clipboard (and shown below).'); } catch { /* shown below regardless */ }
  };

  const doImport = () => {
    const text = importText.trim();
    if (!text) { setStatus('Paste a settings JSON to import first.'); return; }
    try {
      JSON.parse(text); // validate before sending (the store also guards)
    } catch {
      setStatus('That isn’t valid JSON — nothing imported.');
      return;
    }
    importSettings(text);
    setStatus('Imported. Settings applied live.');
  };

  const importFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      setImportText(text);
      try { JSON.parse(text); importSettings(text); setStatus(`Imported ${file.name}. Settings applied live.`); }
      catch { setStatus(`${file.name} isn’t valid JSON — nothing imported.`); }
    };
    reader.readAsText(file);
  };

  const resetSection = (s: string) => {
    if (s) { resetSettings(s); setStatus(`Reset “${s}” to defaults.`); }
  };
  const resetAll = () => { resetSettings(); setStatus('All settings reset to defaults.'); };

  // Section choices for "reset a section" = the real top-level setting sections
  // (derived from DEFAULT_SETTINGS, so a cluster that adds a new section is covered
  // automatically). `schemaVersion` / `perChart` aren't user sections.
  const resetTargets = Object.keys(DEFAULT_SETTINGS).filter((k) => k !== 'schemaVersion' && k !== 'perChart');
  const [resetTarget, setResetTarget] = useState(resetTargets[0]!);

  return (
    <div className="sp-advanced">
      <div className="sp-adv-block">
        <div className="sp-row-title">Export</div>
        <div className="sp-row-help">Copy your settings as JSON (e.g. to back up or share).</div>
        <div className="sp-adv-actions">
          <button className="sp-btn" onClick={() => void doExport()}>Export to JSON</button>
        </div>
        {exported && (
          <textarea className="sp-json" readOnly value={exported} onFocus={(e) => e.currentTarget.select()} rows={8} />
        )}
      </div>

      <div className="sp-adv-block">
        <div className="sp-row-title">Import</div>
        <div className="sp-row-help">Paste a settings JSON, or choose a file. Imported settings apply live and persist.</div>
        <textarea
          className="sp-json"
          placeholder="Paste exported settings JSON here…"
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          rows={6}
          spellCheck={false}
        />
        <div className="sp-adv-actions">
          <button className="sp-btn" onClick={doImport}>Import from text</button>
          <label className="sp-btn ghost sp-file">
            Import from file…
            <input
              type="file"
              accept="application/json,.json"
              onChange={(e) => { importFile(e.target.files?.[0]); e.target.value = ''; }}
            />
          </label>
        </div>
      </div>

      <div className="sp-adv-block">
        <div className="sp-row-title">Reset</div>
        <div className="sp-row-help">Restore defaults — for one section, or everything.</div>
        <div className="sp-adv-actions">
          <select className="sp-select" value={resetTarget} onChange={(e) => setResetTarget(e.target.value)}>
            {resetTargets.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <button className="sp-btn" onClick={() => resetSection(resetTarget)}>Reset section</button>
          <button className="sp-btn danger" onClick={resetAll}>Reset all settings</button>
        </div>
      </div>

      {status && <div className="sp-adv-status muted tiny" role="status">{status}</div>}
      <input type="hidden" data-section={section} />
    </div>
  );
}
