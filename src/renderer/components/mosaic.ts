/**
 * mosaic.ts — the pure split-tree model + operations behind the drag-to-dock chart
 * layout. A node is either a LEAF (one chart, by tab id) or a SPLIT of two children:
 *   - dir 'row' → side by side (a = left, b = right)
 *   - dir 'col' → stacked     (a = top,  b = bottom)
 *   - split    → a's fraction of the axis (0..1); b gets the rest.
 *
 * All ops are PURE (return a new tree, never mutate) so they're trivially unit-tested
 * and so React sees fresh references. The ChartMosaic component renders the tree +
 * drives these ops on drag/resize; the shell (Terminal) owns the tree state. The VISIBLE
 * pane set is decoupled from the tab strip: the shell prunes panes for closed tabs
 * (pruneTree), seeds a preset (buildTree), and the user grows the layout by dragging
 * tabs in (moveLeaf / moveLeafToRoot / appendLeaf) — open tabs are never force-charted.
 */

export type Side = 'left' | 'right' | 'top' | 'bottom';
export type MosaicLayout = 'cols' | 'rows' | 'grid';
/** The shell's layout-switcher value: a single chart, or a multi-chart preset that
 *  seeds the mosaic tree. */
export type ChartLayout = 'single' | MosaicLayout;

export type MosaicNode =
  | { t: 'leaf'; id: string }
  | { t: 'split'; dir: 'row' | 'col'; a: MosaicNode; b: MosaicNode; split: number };

/** All leaf ids, in visual order (left→right, top→bottom). */
export function leaves(n: MosaicNode | null): string[] {
  if (!n) return [];
  if (n.t === 'leaf') return [n.id];
  return [...leaves(n.a), ...leaves(n.b)];
}

/** Combine pre-built nodes into a balanced split tree of `dir` (equal-ish fractions). */
function combine(nodes: MosaicNode[], dir: 'row' | 'col'): MosaicNode {
  if (nodes.length === 1) return nodes[0]!;
  const mid = Math.ceil(nodes.length / 2);
  return { t: 'split', dir, a: combine(nodes.slice(0, mid), dir), b: combine(nodes.slice(mid), dir), split: mid / nodes.length };
}

/** Build a balanced tree from ordered ids under a preset. null when there are no ids. */
export function buildTree(ids: string[], layout: MosaicLayout): MosaicNode | null {
  if (ids.length === 0) return null;
  const leafOf = (id: string): MosaicNode => ({ t: 'leaf', id });
  if (ids.length === 1) return leafOf(ids[0]!);
  if (layout === 'cols') return combine(ids.map(leafOf), 'row');
  if (layout === 'rows') return combine(ids.map(leafOf), 'col');
  // grid: rows of `cols`, stacked.
  const cols = Math.ceil(Math.sqrt(ids.length));
  const rows: MosaicNode[] = [];
  for (let i = 0; i < ids.length; i += cols) rows.push(combine(ids.slice(i, i + cols).map(leafOf), 'row'));
  return combine(rows, 'col');
}

/** Remove a leaf; the parent split collapses so the sibling takes the space. */
export function removeLeaf(n: MosaicNode | null, id: string): MosaicNode | null {
  if (!n) return null;
  if (n.t === 'leaf') return n.id === id ? null : n;
  const a = removeLeaf(n.a, id);
  const b = removeLeaf(n.b, id);
  if (a === null) return b;
  if (b === null) return a;
  if (a === n.a && b === n.b) return n;
  return { ...n, a, b };
}

/** Split the leaf `targetId` by inserting a new leaf `id` on `side` (50/50). The caller
 *  must ensure `id` isn't already in the tree (use moveLeaf for an existing chart). */
export function splitAt(n: MosaicNode, targetId: string, id: string, side: Side): MosaicNode {
  if (n.t === 'leaf') {
    if (n.id !== targetId) return n;
    const dir: 'row' | 'col' = side === 'left' || side === 'right' ? 'row' : 'col';
    const newLeaf: MosaicNode = { t: 'leaf', id };
    const before = side === 'left' || side === 'top';
    return before
      ? { t: 'split', dir, a: newLeaf, b: n, split: 0.5 }
      : { t: 'split', dir, a: n, b: newLeaf, split: 0.5 };
  }
  return { ...n, a: splitAt(n.a, targetId, id, side), b: splitAt(n.b, targetId, id, side) };
}

/** Move an EXISTING leaf `id` to split `targetId` on `side` (remove from its old spot,
 *  then re-insert). No-op if id === targetId or id isn't present. */
export function moveLeaf(n: MosaicNode, id: string, targetId: string, side: Side): MosaicNode {
  if (id === targetId) return n;
  const removed = removeLeaf(n, id);
  if (!removed || !leaves(removed).includes(targetId)) return n;
  return splitAt(removed, targetId, id, side);
}

/** Dock a leaf against an OUTER edge of the WHOLE layout — a full-span strip across every
 *  chart (vs splitAt/moveLeaf, which split a single pane). 'top'/'bottom' wrap the entire
 *  tree in a column split (a full-WIDTH row); 'left'/'right' in a row split (a full-HEIGHT
 *  column). The docked chart takes ~1/3 of the axis so the existing layout stays dominant
 *  (drag the divider to resize). Works for BOTH an existing leaf (relocated) and a brand-new
 *  one (ADDED) — a symbol tab dragged in from the strip docks the same way. */
export function moveLeafToRoot(n: MosaicNode | null, id: string, side: Side): MosaicNode {
  const leaf: MosaicNode = { t: 'leaf', id };
  const rest = removeLeaf(n, id); // strip id if present (no-op if absent); null if it was the whole tree
  if (!rest) return leaf;         // empty tree, or id was the only leaf — the strip becomes the tree
  const dir: 'row' | 'col' = side === 'left' || side === 'right' ? 'row' : 'col';
  const NEW = 1 / 3; // the docked chart's share of the axis
  return side === 'left' || side === 'top'
    ? { t: 'split', dir, a: leaf, b: rest, split: NEW }
    : { t: 'split', dir, a: rest, b: leaf, split: 1 - NEW };
}

/** Append `id` as a new pane by splitting the last leaf on its right (no-op if already
 *  present). Used to bring the active chart / a clicked tab into the mosaic without
 *  disturbing the existing panes' sizes. */
export function appendLeaf(n: MosaicNode | null, id: string): MosaicNode {
  if (!n) return { t: 'leaf', id };
  if (leaves(n).includes(id)) return n;
  const last = leaves(n).at(-1)!;
  return splitAt(n, last, id, 'right');
}

/** Set the split fraction of the split node reached by `path` (a sequence of 'a'/'b'
 *  from the root). Clamped to [0.05, 0.95]. */
export function setSplit(n: MosaicNode, path: ('a' | 'b')[], fraction: number): MosaicNode {
  if (n.t !== 'split') return n;
  if (path.length === 0) return { ...n, split: Math.max(0.05, Math.min(0.95, fraction)) };
  const [head, ...rest] = path;
  return head === 'a' ? { ...n, a: setSplit(n.a, rest, fraction) } : { ...n, b: setSplit(n.b, rest, fraction) };
}

/** Drop any leaf whose id is NOT in `valid` (a tab that was closed, or belongs to another
 *  account), preserving the surviving panes' structure/sizes. UNLIKE the old syncTree it does
 *  NOT add a pane for every open tab — the visible pane set is decoupled from the tab strip,
 *  grown deliberately by dragging tabs in (moveLeaf / moveLeafToRoot) or appendLeaf. */
export function pruneTree(n: MosaicNode | null, valid: Set<string>): MosaicNode | null {
  let tree = n;
  for (const lid of leaves(n)) if (!valid.has(lid)) tree = removeLeaf(tree, lid);
  return tree;
}
