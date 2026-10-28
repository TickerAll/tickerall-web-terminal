/**
 * IndicatorManager — an observable store of the active indicator INSTANCES, scoped
 * per chart context (`${accountId}:${symbol}:${tf}`) and persisted to localStorage.
 *
 * Mirrors the repo's `DrawingStore` pattern (`subscribe` + a stable-reference
 * `list()` snapshot) so React consumes it via `useSyncExternalStore` with no extra
 * dependency. `list()` returns the SAME array reference until a mutation, so the
 * hook doesn't loop; every mutation rebuilds the array once and notifies.
 *
 * Scope: a SINGLE manager holds instances for the CURRENT context only. The host
 * sets the context (`setContext`) when the chart's (account, symbol, timeframe)
 * changes; the manager saves the outgoing context's instances and loads the
 * incoming one's from localStorage. This keeps a per-chart indicator set without
 * touching the app settings schema (owned by another agent) — it uses its own
 * localStorage key namespace (`tat.indicators.v1:<context>`).
 */

import { getIndicator, type IndicatorDef } from './registry';

type Listener = () => void;

/** Where an indicator applies: 'global' = on EVERY chart (the default), 'chart' = on
 *  the current (account, symbol, timeframe) only. */
export type IndicatorScope = 'global' | 'chart';

/** A live indicator instance on a chart. */
export interface IndicatorInstance {
  /** Stable per-instance id (so two SMAs with different periods coexist). */
  instanceId: string;
  /** The registry indicator id (e.g. 'sma', 'rsi'). */
  indicatorId: string;
  /** The user-set parameters (validated against the def on add/update). */
  params: Record<string, number>;
  /** Per-output-key colour overrides (defaults come from the def). */
  colors: Record<string, string>;
  /** Whether the instance is currently drawn. */
  visible: boolean;
  /** Whether it applies to all charts or just the current one. */
  scope: IndicatorScope;
}

/** localStorage key namespaces — versioned + independent of the settings schema. The
 *  global set spans every chart; the per-context set is keyed by the chart context. */
const LS_PREFIX = 'tat.indicators.v1:';
const LS_GLOBAL = 'tat.indicators.global.v1';

let idCounter = 0;
/** Monotonic, collision-free instance id. */
export function nextInstanceId(): string {
  idCounter += 1;
  return `ind_${Date.now().toString(36)}_${idCounter.toString(36)}`;
}

/** Build the default params for a def (each param's `default`). */
function defaultParams(def: IndicatorDef): Record<string, number> {
  const out: Record<string, number> = {};
  for (const par of def.params) out[par.name] = par.default;
  return out;
}

/** Build the default colours for a def (each output's `defaultColor`). */
function defaultColors(def: IndicatorDef): Record<string, string> {
  const out: Record<string, string> = {};
  for (const o of def.outputs) out[o.key] = o.defaultColor;
  return out;
}

/** Validate + coerce a partial params bag against a def (clamps to min/max, rounds
 *  ints, fills missing with the default). Unknown keys are dropped. */
function sanitizeParams(def: IndicatorDef, raw: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const par of def.params) {
    const v = raw[par.name];
    let num = typeof v === 'number' && Number.isFinite(v) ? v : par.default;
    if (par.type === 'int' || par.type === 'select') num = Math.round(num);
    if (par.min !== undefined && num < par.min) num = par.min;
    if (par.max !== undefined && num > par.max) num = par.max;
    if (par.type === 'select' && par.options && !par.options.some((o) => o.value === num)) {
      num = par.default;
    }
    out[par.name] = num;
  }
  return out;
}

/** Validate + filter a colours bag against a def (keeps only known output keys;
 *  fills missing from the default). */
function sanitizeColors(def: IndicatorDef, raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const o of def.outputs) {
    const v = raw[o.key];
    out[o.key] = typeof v === 'string' && v.length > 0 ? v : o.defaultColor;
  }
  return out;
}

export class IndicatorManager {
  /** Instances that apply to EVERY chart (the default scope). */
  private globalInstances: IndicatorInstance[] = [];
  /** Instances scoped to the CURRENT context only, in insertion order. */
  private instances: IndicatorInstance[] = [];
  /** The active context key (`${accountId}:${symbol}:${tf}`), or '' before set. */
  private context = '';
  private listeners = new Set<Listener>();
  /** Cached snapshot (global ∪ context); null after a mutation so the next read rebuilds. */
  private cache: IndicatorInstance[] | null = null;
  /** Inject a storage backend (defaults to window.localStorage; test-overridable). */
  private storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;

  constructor(storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) {
    this.storage =
      storage ??
      (typeof localStorage !== 'undefined' ? localStorage : null);
    // Global indicators are loaded once and span every chart context.
    this.globalInstances = this.loadFromStorage(LS_GLOBAL, 'global');
  }

  // ── subscription (useSyncExternalStore contract) ─────────────────────────────
  subscribe = (cb: Listener): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  private emit(): void {
    this.cache = null;
    for (const l of this.listeners) l();
  }

  // ── reads ────────────────────────────────────────────────────────────────────
  /** The active context key. */
  currentContext = (): string => this.context;

  /** Active instances for the current context (stable reference until a mutation).
   *  Optionally pass a `context` to assert you're reading the one you expect — if it
   *  differs from the active context, returns an empty array (so a stale render that
   *  hasn't seen `setContext` yet doesn't show the wrong chart's indicators). */
  list = (context?: string): IndicatorInstance[] => {
    if (context !== undefined && context !== this.context) return EMPTY;
    // Effective set = GLOBAL (all charts) ∪ this context's own instances.
    if (this.cache === null) this.cache = [...this.globalInstances, ...this.instances];
    return this.cache;
  };

  /** One instance by id, from either scope (or undefined). */
  get(instanceId: string): IndicatorInstance | undefined {
    return this.globalInstances.find((i) => i.instanceId === instanceId)
      ?? this.instances.find((i) => i.instanceId === instanceId);
  }

  // ── context switching + persistence ──────────────────────────────────────────
  /** Switch the active chart context. Persists the OUTGOING context's instances,
   *  then loads the incoming context's from storage. A no-op if the context is the
   *  same (so a re-render with identical props doesn't reload). */
  setContext(context: string): void {
    if (context === this.context) return;
    // Save the OLD context's instances before swapping; the GLOBAL set is untouched
    // (it applies to every chart).
    if (this.context) this.persistContext();
    this.context = context;
    this.instances = this.loadFromStorage(LS_PREFIX + context, 'chart');
    this.emit();
  }

  /** Persist the current context's instances (tiny payload → synchronous write). */
  private persistContext(): void {
    if (!this.storage || !this.context) return;
    try {
      this.storage.setItem(LS_PREFIX + this.context, JSON.stringify(this.instances));
    } catch {
      /* storage full / unavailable — indicators are a convenience, never block. */
    }
  }

  /** Persist the global (all-charts) instances. */
  private persistGlobal(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(LS_GLOBAL, JSON.stringify(this.globalInstances));
    } catch {
      /* never block */
    }
  }

  /** Load + validate a context's instances from storage. Drops any whose indicator
   *  id no longer exists, and re-sanitizes params/colours against the current defs
   *  (so a registry change can't surface a malformed instance). */
  private loadFromStorage(key: string, scope: IndicatorScope): IndicatorInstance[] {
    if (!this.storage) return [];
    let raw: unknown;
    try {
      const txt = this.storage.getItem(key);
      if (!txt) return [];
      raw = JSON.parse(txt);
    } catch {
      return [];
    }
    if (!Array.isArray(raw)) return [];
    const out: IndicatorInstance[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      const indicatorId = typeof rec.indicatorId === 'string' ? rec.indicatorId : '';
      const def = getIndicator(indicatorId);
      if (!def) continue; // unknown indicator (registry changed) — skip.
      out.push({
        instanceId: typeof rec.instanceId === 'string' ? rec.instanceId : nextInstanceId(),
        indicatorId,
        params: sanitizeParams(def, (rec.params as Record<string, unknown>) ?? {}),
        colors: sanitizeColors(def, (rec.colors as Record<string, unknown>) ?? {}),
        visible: rec.visible !== false,
        scope,
      });
    }
    return out;
  }

  // ── mutations ────────────────────────────────────────────────────────────────
  /** Add an indicator instance. Default scope is 'global' (shows on EVERY chart);
   *  pass scope 'chart' to add it to the current context only. Returns the created
   *  instance, or null if the indicator id is unknown. */
  add(
    indicatorId: string,
    params?: Record<string, number>,
    colors?: Record<string, string>,
    scope: IndicatorScope = 'global',
  ): IndicatorInstance | null {
    const def = getIndicator(indicatorId);
    if (!def) return null;
    const inst: IndicatorInstance = {
      instanceId: nextInstanceId(),
      indicatorId,
      params: params ? sanitizeParams(def, params) : defaultParams(def),
      colors: colors ? sanitizeColors(def, colors) : defaultColors(def),
      visible: true,
      scope,
    };
    if (scope === 'global') {
      this.globalInstances = [...this.globalInstances, inst];
      this.persistGlobal();
    } else {
      this.instances = [...this.instances, inst];
      this.persistContext();
    }
    this.emit();
    return inst;
  }

  /** Find an instance in whichever scope it lives, apply `fn` (return the new instance,
   *  the SAME ref for a no-op, or null to remove), then persist that scope + emit. */
  private apply(instanceId: string, fn: (inst: IndicatorInstance) => IndicatorInstance | null): void {
    const inGlobal = this.globalInstances.some((i) => i.instanceId === instanceId);
    const listRef = inGlobal ? this.globalInstances : this.instances;
    const idx = listRef.findIndex((i) => i.instanceId === instanceId);
    if (idx < 0) return;
    const cur = listRef[idx]!;
    const next = fn(cur);
    if (next === cur) return; // no-op
    const newList = next === null
      ? listRef.filter((_, k) => k !== idx)
      : listRef.map((i, k) => (k === idx ? next : i));
    if (inGlobal) { this.globalInstances = newList; this.persistGlobal(); }
    else { this.instances = newList; this.persistContext(); }
    this.emit();
  }

  /** Remove an instance (from whichever scope it's in). No-op if it's gone. */
  remove(instanceId: string): void {
    this.apply(instanceId, () => null);
  }

  /** Replace an instance's parameters (validated). No-op if it's gone. */
  updateParams(instanceId: string, params: Record<string, number>): void {
    this.apply(instanceId, (inst) => {
      const def = getIndicator(inst.indicatorId);
      if (!def) return inst;
      return { ...inst, params: sanitizeParams(def, { ...inst.params, ...params }) };
    });
  }

  /** Replace an instance's output colours (validated). No-op if it's gone. */
  updateColors(instanceId: string, colors: Record<string, string>): void {
    this.apply(instanceId, (inst) => {
      const def = getIndicator(inst.indicatorId);
      if (!def) return inst;
      return { ...inst, colors: sanitizeColors(def, { ...inst.colors, ...colors }) };
    });
  }

  /** Toggle (or set) an instance's visibility. No-op if it's gone. */
  toggle(instanceId: string, visible?: boolean): void {
    this.apply(instanceId, (inst) => {
      const next = visible === undefined ? !inst.visible : visible;
      return next === inst.visible ? inst : { ...inst, visible: next };
    });
  }

  /** Remove EVERY indicator on this chart — both the global (all-charts) set and the
   *  current context's set. */
  clear(): void {
    let changed = false;
    if (this.globalInstances.length) { this.globalInstances = []; this.persistGlobal(); changed = true; }
    if (this.instances.length) { this.instances = []; this.persistContext(); changed = true; }
    if (changed) this.emit();
  }
}

/** Shared empty array so `list(context)` for a mismatched context returns a stable
 *  reference (no re-render churn). */
const EMPTY: IndicatorInstance[] = [];

/** Build the context key the manager scopes by. Mirrors the app's other per-chart
 *  scoping (`${accountId}:${symbol}:${tf}`). */
export function indicatorContextKey(
  accountId: string | null | undefined,
  symbol: string | null | undefined,
  timeframe: number,
): string {
  return `${accountId ?? ''}:${symbol ?? ''}:${timeframe}`;
}

/** A process-wide default manager — the host + menu share this one so they stay in
 *  sync (the menu writes, the host reads). A test can construct its own with an
 *  injected storage. */
export const indicatorManager = new IndicatorManager();
