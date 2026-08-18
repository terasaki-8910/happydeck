/**
 * A layout tree for the multi-pane view — supports arbitrary nested splits
 * (drag a session onto the bottom edge of an existing pane and just that
 * pane splits top/bottom, leaving its sibling untouched — the "1/4, 1/4,
 * 1/2" shape) alongside true even N-way splits at any single split level
 * (drag to the outer edge of the whole area, or drop directly on a
 * divider). Mirrors how VSCode/tmux/i3 build arbitrary layouts out of
 * splits, while still allowing a plain N-up row/column where that's what
 * was actually asked for.
 */
export type PaneNode = PaneLeaf | PaneSplit;

export interface PaneLeaf {
  type: 'leaf';
  sessionId: string;
}

export interface PaneSplit {
  type: 'split';
  orientation: 'horizontal' | 'vertical';
  /** 2 or more. A plain 2-child split from insertAtZone can be arbitrarily unequal (irregular nesting); insertAtOuterEdge/insertAtGap force every child in the split they touch to an even share via rebalanceNonce below. */
  children: PaneNode[];
  /** Bumped only by insertAtOuterEdge/insertAtGap on the exact split they modify — PaneTreeView folds it into that Group's `key`, forcing a clean remount so every child (including ones carried over from before) actually lands on an even share instead of keeping stale manual-resize proportions. Untouched splits elsewhere in the tree never get a nonce and keep their existing mount identity (and manual sizing) as-is. */
  rebalanceNonce?: number;
}

/** Where a drop landed relative to the target pane's own rectangle. */
export type DropZone = 'left' | 'right' | 'top' | 'bottom' | 'center';

/** The whole pane area's own outer boundary — distinct from any single pane's edge zone. */
export type OuterEdge = 'left' | 'right' | 'top' | 'bottom';

let rebalanceCounter = 0;
function nextRebalanceNonce(): number {
  rebalanceCounter += 1;
  return rebalanceCounter;
}

export function leaf(sessionId: string): PaneLeaf {
  return { type: 'leaf', sessionId };
}

export function paneTreeSessionIds(node: PaneNode | null): string[] {
  if (!node) return [];
  if (node.type === 'leaf') return [node.sessionId];
  return node.children.flatMap(paneTreeSessionIds);
}

export function paneTreeHas(node: PaneNode | null, sessionId: string): boolean {
  if (!node) return false;
  if (node.type === 'leaf') return node.sessionId === sessionId;
  return node.children.some((c) => paneTreeHas(c, sessionId));
}

/**
 * Splits the leaf matching `targetSessionId` into two, placing `sessionId`
 * on the side `zone` names. 'center' replaces the target's session in
 * place instead of splitting. Always produces a plain 2-child split with
 * no rebalanceNonce — this is the "irregular nesting" gesture (dropping
 * on an individual pane's own inner edge/corner), deliberately left
 * unequal-capable and unaffected by the even-split gestures below.
 * Returns the tree unchanged if the target isn't found.
 */
export function insertAtZone(node: PaneNode, targetSessionId: string, zone: DropZone, sessionId: string): PaneNode {
  if (node.type === 'leaf') {
    if (node.sessionId !== targetSessionId) return node;
    if (zone === 'center') return leaf(sessionId);
    const newLeaf = leaf(sessionId);
    const orientation: PaneSplit['orientation'] = zone === 'left' || zone === 'right' ? 'horizontal' : 'vertical';
    const children: PaneNode[] = zone === 'left' || zone === 'top' ? [newLeaf, node] : [node, newLeaf];
    return { type: 'split', orientation, children };
  }
  return { ...node, children: node.children.map((c) => insertAtZone(c, targetSessionId, zone, sessionId)) };
}

export function replaceLeaf(node: PaneNode, targetSessionId: string, sessionId: string): PaneNode {
  if (node.type === 'leaf') {
    return node.sessionId === targetSessionId ? leaf(sessionId) : node;
  }
  return { ...node, children: node.children.map((c) => replaceLeaf(c, targetSessionId, sessionId)) };
}

/**
 * Removes a leaf, collapsing any split that's left with only one child —
 * that child takes the collapsed split's place in the tree. Returns null
 * if removing the last leaf empties the tree entirely.
 */
export function removeFromPaneTree(node: PaneNode, sessionId: string): PaneNode | null {
  if (node.type === 'leaf') {
    return node.sessionId === sessionId ? null : node;
  }
  const children = node.children.map((c) => removeFromPaneTree(c, sessionId)).filter((c): c is PaneNode => c !== null);
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];
  return { ...node, children };
}

/** Appends as a new top-level sibling — used only as a fallback when a drop lands outside every pane's rect and every divider (e.g. the tree is currently empty). Not an even-split gesture: the new pane and the entire existing tree just split 50/50. */
export function appendAsRootSibling(node: PaneNode | null, sessionId: string): PaneNode {
  if (!node) return leaf(sessionId);
  return { type: 'split', orientation: 'horizontal', children: [node, leaf(sessionId)] };
}

/**
 * Drag to the outer edge of the WHOLE pane area (not any single pane's
 * own edge zone): adds a new evenly-sized top-level pane on that side.
 * If the root is already a same-axis split, the new leaf just joins its
 * children (rebalanceNonce forces every existing child — even ones that
 * had been manually resized — onto an even share too, e.g. 2 uneven
 * columns dropped onto here become 3 even ones). Otherwise the whole
 * existing tree is wrapped as one opaque unit alongside the new leaf.
 */
export function insertAtOuterEdge(node: PaneNode | null, edge: OuterEdge, sessionId: string): PaneNode {
  if (!node) return leaf(sessionId);
  const orientation: PaneSplit['orientation'] = edge === 'left' || edge === 'right' ? 'horizontal' : 'vertical';
  const newLeaf = leaf(sessionId);
  const atStart = edge === 'left' || edge === 'top';
  if (node.type === 'split' && node.orientation === orientation) {
    return { ...node, children: atStart ? [newLeaf, ...node.children] : [...node.children, newLeaf], rebalanceNonce: nextRebalanceNonce() };
  }
  return { type: 'split', orientation, children: atStart ? [newLeaf, node] : [node, newLeaf], rebalanceNonce: nextRebalanceNonce() };
}

/**
 * Drop directly on the divider between two panes (identified by the split
 * node's path — see PaneTreeView — and which gap between its children):
 * inserts the new pane at that gap and evenly rebalances every child of
 * that specific split (not the whole tree — a divider inside a nested
 * sub-split only rebalances that sub-split).
 */
export function insertAtGap(node: PaneNode, splitPath: string, gapIndex: number, sessionId: string, path = ''): PaneNode {
  if (node.type === 'leaf') return node;
  if (path === splitPath) {
    const children = [...node.children];
    children.splice(gapIndex, 0, leaf(sessionId));
    return { ...node, children, rebalanceNonce: nextRebalanceNonce() };
  }
  return { ...node, children: node.children.map((c, i) => insertAtGap(c, splitPath, gapIndex, sessionId, `${path}${i}`)) };
}

/**
 * Reads the pointer position (0..1 within the target's own rect) and picks
 * which of the 5 drop zones it falls in: a 50%-width/height center zone,
 * with the remaining ring split into left/right/top/bottom quarters —
 * matches VSCode's editor-group drop-zone shape.
 */
export function zoneFromPointer(fracX: number, fracY: number): DropZone {
  const x = Math.min(1, Math.max(0, fracX));
  const y = Math.min(1, Math.max(0, fracY));
  if (x > 0.25 && x < 0.75 && y > 0.25 && y < 0.75) return 'center';
  const distFromEdge = { left: x, right: 1 - x, top: y, bottom: 1 - y } as const;
  return (Object.entries(distFromEdge) as [DropZone, number][]).reduce((a, b) => (b[1] < a[1] ? b : a))[0];
}
