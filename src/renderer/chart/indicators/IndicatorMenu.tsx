/**
 * IndicatorMenu — the "Indicators" toolbar control: a trigger button that opens a
 * popover to (a) ADD an indicator from the registry catalog, and (b) manage the
 * ACTIVE instances on the current chart (edit params + colours, toggle visibility,
 * remove). Everything is written through the shared `indicatorManager`, scoped to
 * the chart context the host set.
 *
 * It carries its own scoped `<style>` (injected once) built on the app's CSS vars,
 * so it themes correctly without any edits to index.html. The two pieces are
 * exported separately so the integrator can place the BUTTON in a chart toolbar and
 * let the PANEL float beneath it: `<IndicatorMenu accountId=.. symbol=.. timeframe=../>`
 * renders both (button + popover) as one self-contained unit.
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  indicatorManager,
  indicatorContextKey,
  type IndicatorInstance,
  type IndicatorManager,
} from './manager';
import { INDICATORS, getIndicator, type IndicatorDef, type IndiParam } from './registry';

export interface IndicatorMenuProps {
  accountId: string | null;
  symbol: string | null;
  timeframe: number;
  /** Override the manager (tests). Defaults to the shared singleton. */
  manager?: IndicatorManager;
}

export function IndicatorMenu({ accountId, symbol, timeframe, manager = indicatorManager }: IndicatorMenuProps) {
  const context = indicatorContextKey(accountId, symbol, timeframe);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Keep the manager's context current (the host does this too; doing it here makes
  // the menu usable even if mounted without a host).
  useEffect(() => {
    manager.setContext(context);
  }, [manager, context]);

  const instances = useSyncExternalStore(
    manager.subscribe,
    () => manager.list(context),
    () => manager.list(context),
  );

  // Inject styles once.
  useEffect(() => {
    injectStyles();
  }, []);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const disabled = !symbol; // no chart context → nothing to add to.

  return (
    <div className="ind-menu" ref={rootRef}>
      <button
        type="button"
        className={`ind-menu-btn ${open ? 'on' : ''}`}
        title="Indicators"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="ind-menu-ico">∿</span>
        <span className="ind-menu-label">Indicators</span>
        {instances.length > 0 && <span className="ind-menu-count">{instances.length}</span>}
      </button>
      {open && !disabled && (
        <IndicatorPanel
          instances={instances}
          onAdd={(id, scope) => manager.add(id, undefined, undefined, scope)}
          onRemove={(iid) => manager.remove(iid)}
          onToggle={(iid) => manager.toggle(iid)}
          onUpdateParams={(iid, params) => manager.updateParams(iid, params)}
          onUpdateColors={(iid, colors) => manager.updateColors(iid, colors)}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

interface PanelProps {
  instances: IndicatorInstance[];
  onAdd: (indicatorId: string, scope: 'global' | 'chart') => void;
  onRemove: (instanceId: string) => void;
  onToggle: (instanceId: string) => void;
  onUpdateParams: (instanceId: string, params: Record<string, number>) => void;
  onUpdateColors: (instanceId: string, colors: Record<string, string>) => void;
  onClose: () => void;
}

function IndicatorPanel({
  instances,
  onAdd,
  onRemove,
  onToggle,
  onUpdateParams,
  onUpdateColors,
  onClose,
}: PanelProps) {
  const [tab, setTab] = useState<'add' | 'active'>(instances.length > 0 ? 'active' : 'add');
  const [editing, setEditing] = useState<string | null>(null);
  // Default: an added indicator applies to ALL charts; "this chart only" scopes it.
  const [chartOnly, setChartOnly] = useState(false);

  const overlays = useMemo(() => INDICATORS.filter((d) => d.pane === 'overlay'), []);
  const oscillators = useMemo(() => INDICATORS.filter((d) => d.pane === 'oscillator'), []);

  return (
    <div className="ind-panel">
      <div className="ind-panel-head">
        <div className="ind-tabs">
          <button type="button" className={`ind-tab ${tab === 'add' ? 'on' : ''}`} onClick={() => setTab('add')}>
            Add
          </button>
          <button type="button" className={`ind-tab ${tab === 'active' ? 'on' : ''}`} onClick={() => setTab('active')}>
            Active{instances.length > 0 ? ` (${instances.length})` : ''}
          </button>
        </div>
        <button type="button" className="ind-panel-x" title="Close" onClick={onClose}>
          ✕
        </button>
      </div>

      {tab === 'add' && (
        <div className="ind-panel-body">
          <label className="ind-scope">
            <input type="checkbox" checked={chartOnly} onChange={(e) => setChartOnly(e.target.checked)} />
            <span>This chart only</span>
            <span className="ind-scope-hint">{chartOnly ? '' : 'added to all charts'}</span>
          </label>
          <div className="ind-group-label">Overlays</div>
          <ul className="ind-add-list">
            {overlays.map((d) => (
              <li key={d.id}>
                <button type="button" className="ind-add-row" onClick={() => onAdd(d.id, chartOnly ? 'chart' : 'global')}>
                  <span className="ind-add-name">{d.label}</span>
                  <span className="ind-add-plus">＋</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="ind-group-label">Oscillators</div>
          <ul className="ind-add-list">
            {oscillators.map((d) => (
              <li key={d.id}>
                <button type="button" className="ind-add-row" onClick={() => onAdd(d.id, chartOnly ? 'chart' : 'global')}>
                  <span className="ind-add-name">{d.label}</span>
                  <span className="ind-add-plus">＋</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === 'active' && (
        <div className="ind-panel-body">
          {instances.length === 0 ? (
            <div className="ind-empty">No indicators on this chart. Use “Add”.</div>
          ) : (
            <ul className="ind-active-list">
              {instances.map((inst) => {
                const def = getIndicator(inst.indicatorId);
                if (!def) return null;
                const isEditing = editing === inst.instanceId;
                return (
                  <li key={inst.instanceId} className={`ind-active-item ${isEditing ? 'editing' : ''}`}>
                    <div className="ind-active-row">
                      <button
                        type="button"
                        className={`ind-eye ${inst.visible ? '' : 'off'}`}
                        title={inst.visible ? 'Hide' : 'Show'}
                        onClick={() => onToggle(inst.instanceId)}
                      >
                        {inst.visible ? '👁' : '⦸'}
                      </button>
                      <span className="ind-active-name" title={def.label}>
                        {def.label}
                        <span className="ind-active-sub">
                          <span className="ind-scope-tag">{inst.scope === 'chart' ? 'this chart' : 'all charts'}</span>
                          {paramSummary(def, inst)}
                        </span>
                      </span>
                      <button
                        type="button"
                        className={`ind-act ${isEditing ? 'on' : ''}`}
                        title="Edit"
                        onClick={() => setEditing(isEditing ? null : inst.instanceId)}
                      >
                        ⚙
                      </button>
                      <button
                        type="button"
                        className="ind-act"
                        title="Remove"
                        onClick={() => {
                          if (editing === inst.instanceId) setEditing(null);
                          onRemove(inst.instanceId);
                        }}
                      >
                        ✕
                      </button>
                    </div>
                    {isEditing && (
                      <InstanceEditor
                        def={def}
                        instance={inst}
                        onUpdateParams={(params) => onUpdateParams(inst.instanceId, params)}
                        onUpdateColors={(colors) => onUpdateColors(inst.instanceId, colors)}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** A compact "period 14 · EMA · Close" summary for the active row. */
function paramSummary(def: IndicatorDef, inst: IndicatorInstance): string {
  const parts: string[] = [];
  for (const par of def.params) {
    const v = inst.params[par.name];
    if (v === undefined) continue;
    if (par.type === 'select' && par.options) {
      const opt = par.options.find((o) => o.value === v);
      if (opt) parts.push(opt.label);
    } else {
      parts.push(String(v));
    }
  }
  return parts.length ? `  ${parts.join(' · ')}` : '';
}

interface EditorProps {
  def: IndicatorDef;
  instance: IndicatorInstance;
  onUpdateParams: (params: Record<string, number>) => void;
  onUpdateColors: (colors: Record<string, string>) => void;
}

function InstanceEditor({ def, instance, onUpdateParams, onUpdateColors }: EditorProps) {
  return (
    <div className="ind-editor">
      {def.params.length > 0 && (
        <div className="ind-editor-section">
          {def.params.map((par) => (
            <ParamField
              key={par.name}
              param={par}
              value={instance.params[par.name] ?? par.default}
              onChange={(v) => onUpdateParams({ [par.name]: v })}
            />
          ))}
        </div>
      )}
      <div className="ind-editor-section">
        {def.outputs.map((out) => (
          <div className="ind-field" key={out.key}>
            <label className="ind-field-label">{out.label}</label>
            <ColorField
              value={instance.colors[out.key] ?? out.defaultColor}
              onChange={(c) => onUpdateColors({ [out.key]: c })}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function ParamField({
  param,
  value,
  onChange,
}: {
  param: IndiParam;
  value: number;
  onChange: (v: number) => void;
}) {
  // Local text state so a half-typed number doesn't snap mid-edit; commit on blur /
  // Enter (and on every change for selects).
  const [text, setText] = useState(String(value));
  useEffect(() => {
    setText(String(value));
  }, [value]);

  if (param.type === 'select' && param.options) {
    return (
      <div className="ind-field">
        <label className="ind-field-label">{param.label}</label>
        <select className="ind-select" value={value} onChange={(e) => onChange(Number(e.target.value))}>
          {param.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  const commit = () => {
    const num = Number(text);
    if (!Number.isFinite(num)) {
      setText(String(value));
      return;
    }
    onChange(num);
  };
  return (
    <div className="ind-field">
      <label className="ind-field-label">{param.label}</label>
      <input
        className="ind-input"
        type="number"
        inputMode={param.type === 'int' ? 'numeric' : 'decimal'}
        step={param.type === 'int' ? 1 : 'any'}
        min={param.min}
        max={param.max}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit();
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
    </div>
  );
}

/** A colour swatch + native picker. `var(--x)` tokens are resolved to a literal for
 *  the <input type=color>; choosing a colour stores the literal hex. */
function ColorField({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const resolved = resolveColorLiteral(value);
  return (
    <div className="ind-color">
      <input
        type="color"
        className="ind-color-input"
        value={resolved}
        onChange={(e) => onChange(e.target.value)}
        title="Colour"
      />
    </div>
  );
}

/** Resolve a `var(--x)` to a 6-digit hex literal (for the native colour input).
 *  Falls back to a neutral grey if the var isn't a hex value. */
function resolveColorLiteral(color: string): string {
  let c = color;
  if (c.startsWith('var(')) {
    try {
      const name = c.slice(4, -1).trim();
      c = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#2f81f7';
    } catch {
      c = '#2f81f7';
    }
  }
  // <input type=color> needs `#rrggbb`. Expand `#rgb`, else default.
  if (/^#[0-9a-fA-F]{6}$/.test(c)) return c;
  if (/^#[0-9a-fA-F]{3}$/.test(c)) {
    return `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`;
  }
  return '#2f81f7';
}

// ── scoped styles (injected once) ───────────────────────────────────────────────
let injected = false;
function injectStyles() {
  if (injected) return;
  injected = true;
  const style = document.createElement('style');
  style.setAttribute('data-indicators', 'menu');
  style.textContent = MENU_CSS;
  document.head.appendChild(style);
}

const MENU_CSS = `
.ind-menu { position: relative; display: inline-flex; }
.ind-menu-btn { display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 9px; font-size: 11px;
  background: var(--panel2); color: var(--fg); border: 1px solid var(--line2); border-radius: 6px; cursor: pointer; }
.ind-menu-btn:hover:not(:disabled) { border-color: var(--line-hover); }
.ind-menu-btn.on { border-color: var(--accent); }
.ind-menu-btn:disabled { opacity: .45; cursor: default; }
.ind-menu-ico { font-size: 13px; line-height: 1; }
.ind-menu-count { display: inline-flex; align-items: center; justify-content: center; min-width: 15px; height: 15px;
  padding: 0 4px; font-size: 10px; border-radius: 8px; background: var(--accent); color: var(--on-accent); }

.ind-panel { position: absolute; top: calc(100% + 4px); left: 0; z-index: 40; width: 280px; max-height: 460px;
  display: flex; flex-direction: column; background: var(--panel); border: 1px solid var(--line2);
  border-radius: 8px; box-shadow: 0 8px 28px var(--shadow); overflow: hidden; }
.ind-panel-head { display: flex; align-items: center; justify-content: space-between; padding: 6px 8px;
  border-bottom: 1px solid var(--line); background: var(--surface); }
.ind-tabs { display: flex; gap: 2px; }
.ind-tab { background: transparent; border: none; color: var(--muted); font-size: 11px; padding: 4px 9px;
  border-radius: 6px; cursor: pointer; }
.ind-tab:hover { background: var(--hover); color: var(--fg); }
.ind-tab.on { background: var(--sel); color: var(--fg); }
.ind-panel-x { background: transparent; border: none; color: var(--muted); cursor: pointer; font-size: 12px;
  padding: 2px 4px; border-radius: 4px; }
.ind-panel-x:hover { background: var(--hover); color: var(--fg); }
.ind-panel-body { overflow-y: auto; padding: 6px; }
.ind-group-label { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted);
  padding: 6px 6px 3px; }
.ind-add-list, .ind-active-list { list-style: none; margin: 0; padding: 0; }
.ind-add-row { display: flex; align-items: center; justify-content: space-between; width: 100%; gap: 8px;
  padding: 6px 8px; background: transparent; border: none; color: var(--fg); font-size: 12px; cursor: pointer;
  border-radius: 6px; text-align: left; }
.ind-add-row:hover { background: var(--hover); }
.ind-add-plus { color: var(--accent); font-size: 13px; }
.ind-empty { padding: 16px 10px; color: var(--muted); text-align: center; font-size: 12px; }
.ind-active-item { border-radius: 6px; }
.ind-active-item.editing { background: var(--panel2); }
.ind-active-row { display: flex; align-items: center; gap: 6px; padding: 5px 6px; }
.ind-eye { background: transparent; border: none; cursor: pointer; font-size: 12px; padding: 1px 3px; border-radius: 4px;
  color: var(--fg); line-height: 1; }
.ind-eye.off { opacity: .4; }
.ind-eye:hover { background: var(--hover); }
.ind-active-name { flex: 1; min-width: 0; font-size: 12px; color: var(--fg); display: flex; flex-direction: column;
  overflow: hidden; }
.ind-active-name > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ind-active-sub { font-size: 10px; color: var(--muted); }
.ind-act { background: transparent; border: none; cursor: pointer; font-size: 11px; padding: 2px 4px;
  border-radius: 4px; color: var(--muted); line-height: 1; }
.ind-act:hover { background: var(--hover); color: var(--fg); }
.ind-act.on { color: var(--accent); }
.ind-editor { padding: 4px 8px 9px 28px; display: flex; flex-direction: column; gap: 8px; }
.ind-editor-section { display: flex; flex-direction: column; gap: 5px; }
.ind-field { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.ind-field-label { font-size: 11px; color: var(--muted); flex: 1; min-width: 0; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; }
.ind-input, .ind-select { width: 110px; background: var(--bg); color: var(--fg); border: 1px solid var(--line2);
  border-radius: 4px; padding: 3px 6px; font-size: 11px; }
.ind-input:focus, .ind-select:focus { border-color: var(--accent); outline: none; }
.ind-color { width: 110px; display: flex; justify-content: flex-start; }
.ind-color-input { width: 28px; height: 20px; padding: 0; border: 1px solid var(--line2); border-radius: 4px;
  background: var(--bg); cursor: pointer; }
.ind-scope { display: flex; align-items: center; gap: 6px; padding: 5px 6px 8px; font-size: 11px; color: var(--fg); cursor: pointer; }
.ind-scope input { margin: 0; cursor: pointer; }
.ind-scope-hint { color: var(--muted); font-size: 10px; margin-left: auto; }
.ind-scope-tag { display: inline-block; font-size: 9px; text-transform: uppercase; letter-spacing: .04em;
  color: var(--muted); background: var(--hover); border-radius: 3px; padding: 0 4px; margin-right: 5px; }
`;
