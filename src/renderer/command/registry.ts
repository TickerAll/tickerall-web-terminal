/**
 * CommandRegistry — the single source of truth for the command palette (area J /
 * Platform). A tiny framework-light observable holding the registered commands,
 * mirroring the repo's settings-store + DrawingStore pattern (`subscribe` +
 * `getSnapshot`/`list`) so React consumes it via `useSyncExternalStore` with no extra
 * dependency, and any imperative caller can register/unregister directly.
 *
 * Why a module singleton (not a context): commands originate in component scope
 * (Terminal's action closures) but the palette + a future keymap both need them. A
 * singleton lets the shell register ONCE on mount (via `useTerminalCommands`) without
 * wrapping the tree in another provider — the lowest-risk seam into the shell.
 *
 * Snapshot stability: `list()` returns the SAME array reference until a mutation, so
 * `useSyncExternalStore` doesn't loop. Every mutation rebuilds the array once, bumps a
 * version, then notifies subscribers.
 *
 * The fuzzy matcher (`fuzzyMatch` / `rankCommands`) is a dependency-free subsequence
 * scorer (same spirit as VS Code's quick-open): a query matches a command when its
 * characters appear in order somewhere in the command's searchable text; the score
 * rewards contiguous runs, word-boundary/CamelCase starts, and an early first hit.
 */

export interface Command {
  /** Stable unique id (e.g. `chart.reload`, `tf.M15`). Re-registering the same id replaces it. */
  id: string;
  /** The label shown in the palette (e.g. "Reload chart"). */
  title: string;
  /** Optional right-aligned hint — a shortcut, the current value, or a one-word note. */
  hint?: string;
  /** Optional group header the palette buckets under (e.g. "Chart", "Timeframe", "Account"). */
  section?: string;
  /** Extra search terms that don't show in the title but should match (synonyms/aliases). */
  keywords?: string[];
  /** Run the command. The palette closes first, then invokes this. May be async. */
  run: () => void | Promise<void>;
  /** When false, the command is hidden + non-runnable (e.g. "New order" with no account). */
  enabled?: boolean;
}

type Listener = () => void;

class CommandRegistry {
  private byId = new Map<string, Command>();
  /** Insertion order of ids (stable, so same-section/same-score ties keep a sane order). */
  private order: string[] = [];
  private listeners = new Set<Listener>();
  /** Cached ordered snapshot; invalidated (set null) on any mutation. */
  private cache: Command[] | null = [];

  // ── subscription (useSyncExternalStore contract) ─────────────────────────────
  subscribe = (cb: Listener): (() => void) => {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  };

  private emit(): void {
    this.cache = null; // rebuild on next read
    for (const l of this.listeners) l();
  }

  // ── reads ─────────────────────────────────────────────────────────────────────
  /** All commands in registration order (stable reference until the next mutation). */
  list = (): Command[] => {
    if (this.cache === null) this.cache = this.order.map((id) => this.byId.get(id)!).filter(Boolean);
    return this.cache;
  };

  get(id: string): Command | undefined { return this.byId.get(id); }

  // ── mutations ──────────────────────────────────────────────────────────────────
  /** Register (or replace) a single command. */
  register(cmd: Command): void {
    if (!this.byId.has(cmd.id)) this.order.push(cmd.id);
    this.byId.set(cmd.id, cmd);
    this.emit();
  }

  /**
   * Register many commands and return a single disposer that unregisters exactly
   * this batch (by id). The disposer is the ergonomic seam for `useEffect` cleanup in
   * `useTerminalCommands`.
   */
  registerAll(cmds: Command[]): () => void {
    for (const c of cmds) {
      if (!this.byId.has(c.id)) this.order.push(c.id);
      this.byId.set(c.id, c);
    }
    this.emit();
    const ids = cmds.map((c) => c.id);
    return () => this.unregisterAll(ids);
  }

  unregister(id: string): void {
    if (!this.byId.delete(id)) return;
    this.order = this.order.filter((x) => x !== id);
    this.emit();
  }

  unregisterAll(ids: string[]): void {
    let any = false;
    for (const id of ids) if (this.byId.delete(id)) any = true;
    if (!any) return;
    const drop = new Set(ids);
    this.order = this.order.filter((x) => !drop.has(x));
    this.emit();
  }

  /** Remove everything (used by tests; not needed by the shell). */
  clear(): void {
    if (this.byId.size === 0) return;
    this.byId.clear();
    this.order = [];
    this.emit();
  }
}

/** The process-wide registry the shell registers into and the palette reads from. */
export const commandRegistry = new CommandRegistry();

// ── Fuzzy matcher ──────────────────────────────────────────────────────────────

export interface FuzzyHit {
  /** Higher = better. 0 means no match. */
  score: number;
  /** Indices into the matched string that were consumed (for optional highlighting). */
  positions: number[];
}

const SCORE = {
  /** Each matched character is worth this baseline. */
  base: 1,
  /** Bonus when the match is contiguous with the previous match. */
  consecutive: 8,
  /** Bonus when the matched char starts a word (after space/`-`/`_`/`:`/`.`/`/`). */
  wordStart: 10,
  /** Bonus when the matched char is an uppercase letter following a lowercase one (CamelCase). */
  camel: 8,
  /** Per-char penalty for the gap before the FIRST match (rewards early hits). */
  leadingGap: -1,
  /** Best possible leading penalty floor (don't punish very long strings to oblivion). */
  leadingGapFloor: -8,
} as const;

const BOUNDARY = new Set([' ', '-', '_', ':', '.', '/', '\t']);

/**
 * Subsequence fuzzy match of `query` against `text` (case-insensitive). Returns a
 * `FuzzyHit` with a score and the consumed positions, or `null` if `query`'s chars
 * don't all appear in order. An empty query matches everything with score 0 (callers
 * treat "all, unranked" as "show in registration order").
 */
export function fuzzyMatch(query: string, text: string): FuzzyHit | null {
  if (query.length === 0) return { score: 0, positions: [] };
  if (text.length === 0) return null;

  const q = query.toLowerCase();
  const t = text.toLowerCase();

  const positions: number[] = [];
  let score = 0;
  let ti = 0;
  let firstMatch = -1;
  let prevMatch = -2;

  for (let qi = 0; qi < q.length; qi++) {
    const qc = q[qi]!;
    // Advance through `text` to the next occurrence of this query char.
    let found = -1;
    for (; ti < t.length; ti++) {
      if (t[ti] === qc) { found = ti; break; }
    }
    if (found === -1) return null; // a query char ran out of text → no match

    positions.push(found);
    let charScore = SCORE.base;

    // Contiguous-run bonus.
    if (found === prevMatch + 1) charScore += SCORE.consecutive;

    // Word-boundary bonus: first char overall, or the char after a boundary.
    const prevTextChar = found > 0 ? text[found - 1]! : '';
    if (found === 0 || BOUNDARY.has(prevTextChar)) {
      charScore += SCORE.wordStart;
    } else {
      // CamelCase bonus: an uppercase char preceded by a lowercase one.
      const cur = text[found]!;
      if (cur >= 'A' && cur <= 'Z' && prevTextChar >= 'a' && prevTextChar <= 'z') charScore += SCORE.camel;
    }

    if (firstMatch === -1) firstMatch = found;
    score += charScore;
    prevMatch = found;
    ti = found + 1;
  }

  // Penalize a late first hit (so "set" ranks "Settings" above "Reset chart").
  score += Math.max(SCORE.leadingGapFloor, firstMatch * SCORE.leadingGap);

  return { score, positions };
}

export interface RankedCommand {
  cmd: Command;
  score: number;
  /** Which field matched + its consumed positions (title preferred for highlighting). */
  hit: FuzzyHit;
  /** True when the title itself matched (vs only keywords/section); titles rank first. */
  titleMatched: boolean;
}

/**
 * Rank a command list against a query. Each command is scored on the best of its
 * searchable fields (title, then section + keywords as fallbacks, scored a touch
 * lower so a title hit always beats a keyword-only hit). Disabled commands are
 * dropped. With an empty query, returns every enabled command in registration order
 * (score 0) so the palette shows the full grouped menu.
 */
export function rankCommands(query: string, commands: Command[]): RankedCommand[] {
  const enabled = commands.filter((c) => c.enabled !== false);
  const q = query.trim();

  if (q.length === 0) {
    return enabled.map((cmd) => ({ cmd, score: 0, hit: { score: 0, positions: [] }, titleMatched: true }));
  }

  const out: RankedCommand[] = [];
  for (const cmd of enabled) {
    const titleHit = fuzzyMatch(q, cmd.title);

    // Fallback haystacks (section + keywords). Scored at a discount so a real title
    // match always outranks an alias-only match.
    let bestAux: FuzzyHit | null = null;
    const aux: string[] = [];
    if (cmd.section) aux.push(cmd.section);
    if (cmd.keywords) aux.push(...cmd.keywords);
    for (const a of aux) {
      const h = fuzzyMatch(q, a);
      if (h && (!bestAux || h.score > bestAux.score)) bestAux = h;
    }

    if (titleHit) {
      out.push({ cmd, score: titleHit.score, hit: titleHit, titleMatched: true });
    } else if (bestAux) {
      out.push({ cmd, score: bestAux.score - 4, hit: bestAux, titleMatched: false });
    }
  }

  // Title matches first, then by score desc; the input order is stable (Array.sort in
  // modern V8/Node is stable) so equal scores keep registration order.
  out.sort((a, b) => {
    if (a.titleMatched !== b.titleMatched) return a.titleMatched ? -1 : 1;
    return b.score - a.score;
  });
  return out;
}
