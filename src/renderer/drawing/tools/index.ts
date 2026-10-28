/**
 * Tool-family barrel — importing this registers EVERY core drawing tool into the
 * registry (each tool file calls `registerTool` at module top-level). The overlay
 * imports this once instead of listing tools individually, so the fan-out is "add a
 * file + import it here", never a change to the overlay.
 *
 * The list also defines the toolbar's display order + metadata (label, icon glyph,
 * grouping) via TOOL_META, so the toolbar enumerates tools from one source of truth.
 */

import type { DrawingKind } from '../types';

// Side-effect imports: each registers its tool.
import './trendline';
import './hline';
import './vline';
import './ray';
import './extended';
import './arrow';
import './rect';
import './ellipse';
import './triangle';
import './fib';
import './patterns';
import './brush';
import './freehand';
import './emoji';
import './position';
import './text';

export { getTool, allTools, type RenderEnv } from './registry';

/** Toolbar metadata for a kind: a short label, a single-glyph icon, and a group. */
export interface ToolMeta {
  kind: DrawingKind;
  label: string;
  /** A compact glyph used as the toolbar icon (no icon-font dependency). */
  icon: string;
  /** Grouping for the toolbar (lines / shapes / patterns / fib / trade / text). */
  group: 'lines' | 'shapes' | 'patterns' | 'fib' | 'trade' | 'text';
  /** Optional single-key shortcut (armed when the chart has focus). */
  hotkey?: string;
}

/** The core tool set, in toolbar order. One source of truth for the picker. */
export const TOOL_META: ToolMeta[] = [
  { kind: 'trendline', label: 'Trend line', icon: '╱', group: 'lines', hotkey: 't' },
  { kind: 'ray', label: 'Ray', icon: '➚', group: 'lines', hotkey: 'r' },
  { kind: 'extended', label: 'Extended line', icon: '∞', group: 'lines', hotkey: 'e' },
  { kind: 'arrow', label: 'Arrow', icon: '→', group: 'lines', hotkey: 'a' },
  { kind: 'hline', label: 'Horizontal line', icon: '─', group: 'lines', hotkey: 'h' },
  { kind: 'vline', label: 'Vertical line', icon: '│', group: 'lines', hotkey: 'v' },
  { kind: 'brush', label: 'Free draw (pencil)', icon: '✎', group: 'lines', hotkey: 'b' },
  { kind: 'marker', label: 'Free draw (marker)', icon: '🖊', group: 'lines' },
  { kind: 'highlighter', label: 'Highlighter', icon: '🖍', group: 'lines' },
  { kind: 'rect', label: 'Rectangle', icon: '▭', group: 'shapes', hotkey: 's' },
  { kind: 'ellipse', label: 'Ellipse', icon: '◯', group: 'shapes', hotkey: 'o' },
  { kind: 'triangle', label: 'Triangle', icon: '△', group: 'patterns', hotkey: 'g' },
  { kind: 'head-shoulders', label: 'Head & shoulders', icon: 'H&S', group: 'patterns' },
  { kind: 'xabcd', label: 'XABCD pattern', icon: 'XA', group: 'patterns' },
  { kind: 'fib-retracement', label: 'Fib retracement', icon: 'Fib', group: 'fib', hotkey: 'f' },
  { kind: 'long-position', label: 'Long position (plan a buy)', icon: '▲', group: 'trade', hotkey: 'l' },
  { kind: 'short-position', label: 'Short position (plan a sell)', icon: '▼', group: 'trade', hotkey: 'k' },
  { kind: 'text', label: 'Text', icon: 'A', group: 'text', hotkey: 'x' },
  { kind: 'emoji', label: 'Emoji / sticker', icon: '😀', group: 'text' },
];

/** Quick lookup of a kind's meta. */
export const TOOL_META_BY_KIND: Partial<Record<DrawingKind, ToolMeta>> =
  Object.fromEntries(TOOL_META.map((m) => [m.kind, m]));
