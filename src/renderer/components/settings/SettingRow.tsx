/**
 * SettingRow — the generic, descriptor-driven control for ONE setting. The Settings
 * page renders one of these per `SettingDescriptor`; the control kind is chosen from
 * `descriptor.control` (toggle / select / number / color / text). Every control reads
 * the current value via the settings store and writes via `setSetting`, so a change
 * LIVE-APPLIES immediately (store broadcast → subscribers re-render) — there is no
 * save button.
 *
 * Per-chart scope: when a descriptor is `perChart` and the page passes a `chartKey`
 * (`${accountId}:${symbol}:${tf}`), a small "this chart only" toggle appears. Checking
 * it writes to `perChart.<key>.<path>` (a sparse override); unchecking it clears that
 * override so the chart falls back to the global value. Reads prefer the override when
 * one exists.
 *
 * §29 discipline (load-bearing): `0` and `''` are VALID values. Number inputs never
 * reject a 0; an empty number box is treated as "no edit yet", not as 0; presence is
 * tested with `=== undefined`, never truthiness.
 */

import { useCallback } from 'react';
import { useSyncExternalStore } from 'react';
import type { SettingDescriptor } from '../../../shared/settingsSchema';
import { getByPath } from '../../../shared/settingsSchema';
import { getSnapshot, subscribeStore, setSetting } from '../../settings/store';
import { api } from '../../api';

/** Does a sparse per-chart override exist for this path? (presence, not truthiness). */
function useHasOverride(path: string, chartKey: string | null): boolean {
  return useSyncExternalStore(subscribeStore, () =>
    chartKey ? getByPath(getSnapshot(), `perChart.${chartKey}.${path}`) !== undefined : false,
  );
}

/** Read the effective value: the per-chart override if present, else the global. */
function useEffectiveValue<T = unknown>(path: string, chartKey: string | null, overridden: boolean): T {
  return useSyncExternalStore(subscribeStore, () => {
    const snap = getSnapshot();
    if (chartKey && overridden) return getByPath(snap, `perChart.${chartKey}.${path}`) as T;
    return getByPath(snap, path) as T;
  });
}

/** Is a hex string the native <input type=color> can edit? (#rgb / #rrggbb). */
function isHex(v: unknown): v is string {
  return typeof v === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v);
}

export function SettingRow({
  descriptor, chartKey, matched,
}: {
  descriptor: SettingDescriptor;
  /** The active chart's scope key, or null when no chart is active / scoping is off. */
  chartKey: string | null;
  /** When a search is active, the matched substring to highlight in the label. */
  matched?: string;
}) {
  const { path, control } = descriptor;
  const canScope = !!descriptor.perChart && !!chartKey;
  const overridden = useHasOverride(path, canScope ? chartKey : null);
  // Writes target the override path when this chart has (or is taking) an override.
  const writePath = canScope && overridden ? `perChart.${chartKey}.${path}` : path;
  const value = useEffectiveValue(path, canScope ? chartKey : null, overridden);

  const write = useCallback((v: unknown) => setSetting(writePath, v), [writePath]);

  // Toggle "this chart only": on → seed the override with the current effective value;
  // off → clear the override (write undefined; the store deletes the leaf via JSON).
  const toggleScope = useCallback((on: boolean) => {
    if (!chartKey) return;
    const op = `perChart.${chartKey}.${path}`;
    if (on) void api.settingsSet(op, value);
    else void api.settingsSet(op, undefined);
  }, [chartKey, path, value]);

  return (
    <div className={`sp-row ${overridden ? 'scoped' : ''}`}>
      <div className="sp-row-label">
        <div className="sp-row-title">
          <Highlight text={descriptor.label} term={matched} />
          {overridden && <span className="sp-badge">this chart</span>}
        </div>
        {descriptor.help && <div className="sp-row-help">{descriptor.help}</div>}
        <div className="sp-row-path">{path}</div>
      </div>

      <div className="sp-row-control">
        <Control control={control} descriptor={descriptor} value={value} onChange={write} />
        {canScope && (
          <label className="sp-scope" title="Override this setting for the active chart only">
            <input type="checkbox" checked={overridden} onChange={(e) => toggleScope(e.target.checked)} />
            <span>this chart</span>
          </label>
        )}
      </div>
    </div>
  );
}

/** The control widget for a descriptor + value. Pure; calls `onChange` on every edit. */
function Control({
  control, descriptor, value, onChange,
}: {
  control: SettingDescriptor['control'];
  descriptor: SettingDescriptor;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  if (control === 'toggle') {
    const on = value === true;
    return (
      <button
        type="button"
        role="switch"
        aria-checked={on}
        className={`sp-toggle ${on ? 'on' : ''}`}
        onClick={() => onChange(!on)}
      >
        <span className="sp-toggle-knob" />
      </button>
    );
  }

  if (control === 'select') {
    return (
      <select className="sp-select" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
        {(descriptor.options ?? []).map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    );
  }

  if (control === 'number') {
    // §29: keep the raw string so an empty box stays empty (not coerced to 0) and a
    // typed 0 is honoured. Only write a finite number; an empty/partial entry no-ops.
    const num = typeof value === 'number' ? value : Number(value);
    return (
      <input
        type="number"
        className="sp-number"
        value={Number.isFinite(num) ? num : ''}
        min={descriptor.min}
        max={descriptor.max}
        step={descriptor.step}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === '') return;            // empty ⇒ no edit (don't force a 0)
          const n = Number(raw);
          if (Number.isFinite(n)) onChange(n); // 0 is valid and will be written
        }}
      />
    );
  }

  if (control === 'color') {
    const hex = isHex(value);
    return (
      <div className="sp-color">
        <input
          type="color"
          className="sp-color-swatch"
          value={hex ? (value as string) : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          title={hex ? (value as string) : 'pick a colour'}
        />
        {/* Text box too, so non-hex CSS colours (rgba(), transparent) are still editable. */}
        <input
          type="text"
          className="sp-color-text"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
        />
      </div>
    );
  }

  // text (default)
  return (
    <input
      type="text"
      className="sp-text"
      value={typeof value === 'string' ? value : value == null ? '' : String(value)}
      onChange={(e) => onChange(e.target.value)}
      spellCheck={false}
    />
  );
}

/** Highlight the matched search term inside a label (case-insensitive, first hit). */
function Highlight({ text, term }: { text: string; term?: string }) {
  if (!term) return <>{text}</>;
  const i = text.toLowerCase().indexOf(term.toLowerCase());
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="sp-hl">{text.slice(i, i + term.length)}</mark>
      {text.slice(i + term.length)}
    </>
  );
}
