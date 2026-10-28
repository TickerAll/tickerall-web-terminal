/**
 * useTerminalCommands — registers the STANDARD terminal commands into the
 * `commandRegistry`, driven entirely by handlers the shell passes in. The shell owns
 * its action closures (selectSymbol, changeTimeframe, setOrderFor, …); this hook only
 * knows their SHAPE (the `TerminalCommandHandlers` interface), so it has no import of
 * Terminal.tsx and no coupling to the component — the lowest-risk seam.
 *
 * Call it ONCE from the shell with the current handlers + light context (the active
 * symbol/timeframe/account list, used to label and gate commands). It re-registers
 * whenever those inputs change (so "New order" gates off when there's no account, and
 * the timeframe/account/theme sub-commands reflect the live state) and unregisters its
 * batch on unmount.
 *
 * Adding a command later = add an entry here (or, for other clusters, call
 * `commandRegistry.register(...)` from their own module). The palette + any future
 * keymap pick it up automatically.
 */

import { useEffect } from 'react';
import { commandRegistry, type Command } from './registry';
import { TIMEFRAMES, TF_LABEL } from '../../shared/types';
import { BUILTIN_THEMES, THEME_ORDER } from '../theme/tokens';

/** A connected account, minimally (matches the shell's `ConnAcct`/listing shape). */
export interface CommandAccountInfo {
  id: string;
  label: string;
}

/** The action handlers the shell wires the standard commands to. All optional-safe. */
export interface TerminalCommandHandlers {
  /** Open the New Order dialog for a symbol (the shell passes the active symbol). */
  newOrder: () => void;
  /** Change the active chart timeframe (MT5 ENUM_TIMEFRAMES id). */
  changeTimeframe: (tf: number) => void;
  /** Open Settings. */
  openSettings: () => void;
  /** Force-reload the active chart. */
  reloadChart: () => void;
  /** Make an account active (by id). */
  switchAccount: (id: string) => void;
  /** Set the active theme (by theme id). */
  setTheme: (id: string) => void;
}

/** Live context used to label + gate the commands. */
export interface TerminalCommandContext {
  /** The active symbol, or null when nothing is charted (gates New Order). */
  activeSymbol: string | null;
  /** The active timeframe id (so the timeframe commands can show a ✓ / skip the current). */
  timeframe: number;
  /** Connected accounts (drives the "Switch to <account>" commands). */
  accounts: CommandAccountInfo[];
  /** The active account id (so its switch command is marked current / skipped). */
  activeAccountId: string | null;
  /** The active theme id (so its switch command shows a ✓). */
  themeId?: string;
}

/**
 * Build the standard command list from handlers + context. Exported (pure) so it can
 * be unit-tested headless without React.
 */
export function buildTerminalCommands(
  h: TerminalCommandHandlers,
  ctx: TerminalCommandContext,
): Command[] {
  const cmds: Command[] = [];
  const hasSymbol = !!ctx.activeSymbol;

  // ── Trading ───────────────────────────────────────────────────────────────────
  cmds.push({
    id: 'trade.newOrder',
    title: 'New order',
    hint: ctx.activeSymbol ?? undefined,
    section: 'Trading',
    keywords: ['buy', 'sell', 'place', 'order', 'trade'],
    enabled: hasSymbol,
    run: h.newOrder,
  });

  // ── Chart ───────────────────────────────────────────────────────────────────────
  cmds.push({
    id: 'chart.reload',
    title: 'Reload chart',
    section: 'Chart',
    keywords: ['refresh', 'reload', 'redraw'],
    run: h.reloadChart,
  });

  // Timeframe sub-commands (one per TF; the active one is hinted ✓ but still runnable).
  for (const tf of TIMEFRAMES) {
    cmds.push({
      id: `tf.${tf.id}`,
      title: `Timeframe: ${tf.label}`,
      hint: ctx.timeframe === tf.id ? '✓' : undefined,
      section: 'Timeframe',
      keywords: ['timeframe', 'period', 'tf', tf.label],
      enabled: hasSymbol,
      run: () => h.changeTimeframe(tf.id),
    });
  }

  // ── Tools ───────────────────────────────────────────────────────────────────────
  cmds.push({
    id: 'tools.settings',
    title: 'Open Settings',
    hint: 'Ctrl+,',
    section: 'Tools',
    keywords: ['settings', 'preferences', 'config', 'options'],
    run: h.openSettings,
  });

  // ── Account switching (one per connected account, except the active one) ─────────
  for (const acc of ctx.accounts) {
    if (acc.id === ctx.activeAccountId) continue;
    cmds.push({
      id: `account.${acc.id}`,
      title: `Switch to ${acc.label}`,
      section: 'Account',
      keywords: ['account', 'switch', acc.label],
      run: () => h.switchAccount(acc.id),
    });
  }

  // ── Theme switching (one per built-in theme; active one ✓) ───────────────────────
  for (const id of THEME_ORDER) {
    const name = BUILTIN_THEMES[id]?.name ?? id;
    cmds.push({
      id: `theme.${id}`,
      title: `Theme: ${name}`,
      hint: ctx.themeId === id ? '✓' : undefined,
      section: 'Theme',
      keywords: ['theme', 'colour', 'color', 'appearance', 'skin', name],
      run: () => h.setTheme(id),
    });
  }

  return cmds;
}

/**
 * Register the standard commands; re-runs when the handlers or context change.
 * Returns nothing — the registry is the side-effect target.
 */
export function useTerminalCommands(
  handlers: TerminalCommandHandlers,
  ctx: TerminalCommandContext,
): void {
  // Spread the primitives the build depends on into the dep array so the effect
  // re-runs when any of them change (without re-running on every render).
  const accountsKey = ctx.accounts.map((a) => `${a.id}:${a.label}`).join('|');
  useEffect(() => {
    const cmds = buildTerminalCommands(handlers, ctx);
    return commandRegistry.registerAll(cmds);
    // handlers is reconstructed each render by the shell but its identity isn't in the
    // deps — we re-register on the CONTEXT primitives that change the command set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    ctx.activeSymbol, ctx.timeframe, ctx.activeAccountId, accountsKey,
    ctx.themeId,
  ]);
}
