/**
 * A recursive binary layout tree for the multi-pane view — supports
 * arbitrary nested splits (drag a session onto the bottom-left quarter of
 * an existing pane and you get left=[top,bottom], right=whole, not just a
 * flat row). Mirrors how VSCode/tmux/i3 build arbitrary layouts out of
 * repeated binary horizontal/vertical splits rather than a single grid.
 */
export type PaneNode = PaneLeaf | PaneSplit;

export interface PaneLeaf {
  type: 'leaf';
  sessionId: string;
}

export interface PaneSplit {
  type: 'split';
  orientation: 'horizontal' | 'vertical';
  children: [PaneNode, PaneNode];
}

/** Where a drop landed relative to the target pane's own rectangle. */
export type DropZone = 'left' | 'right' | 'top' | 'bottom' | 'center';

export function leaf(sessionId: string): PaneLeaf {
  return { type: 'leaf', sessionId };
}

export function paneTreeSessionIds(node: PaneNode | null): string[] {
  if (!node) return [];
  if (node.type === 'leaf') return [node.sessionId];
  return [...paneTreeSessionIds(node.children[0]), ...paneTreeSessionIds(node.children[1])];
}

export function paneTreeHas(node: PaneNode | null, sessionId: string): boolean {
  if (!node) return false;
  if (node.type === 'leaf') return node.sessionId === sessionId;
  return paneTreeHas(node.children[0], sessionId) || paneTreeHas(node.children[1], sessionId);
}

/**
 * Splits the leaf matching `targetSessionId` into two, placing `sessionId`
 * on the side `zone` names. 'center' replaces the target's session in
 * place instead of splitting (used for both the ghost-preview center zone
 * and as the shared implementation of "replace this pane"). Returns the
 * tree unchanged if the target isn't found.
 */
export function insertAtZone(node: PaneNode, targetSessionId: string, zone: DropZone, sessionId: string): PaneNode {
  if (node.type === 'leaf') {
    if (node.sessionId !== targetSessionId) return node;
    if (zone === 'center') return leaf(sessionId);
    const newLeaf = leaf(sessionId);
    const orientation: PaneSplit['orientation'] = zone === 'left' || zone === 'right' ? 'horizontal' : 'vertical';
    const children: [PaneNode, PaneNode] = zone === 'left' || zone === 'top' ? [newLeaf, node] : [node, newLeaf];
    return { type: 'split', orientation, children };
  }
  return {
    ...node,
    children: [insertAtZone(node.children[0], targetSessionId, zone, sessionId), insertAtZone(node.children[1], targetSessionId, zone, sessionId)],
  };
}

export function replaceLeaf(node: PaneNode, targetSessionId: string, sessionId: string): PaneNode {
  if (node.type === 'leaf') {
    return node.sessionId === targetSessionId ? leaf(sessionId) : node;
  }
  return { ...node, children: [replaceLeaf(node.children[0], targetSessionId, sessionId), replaceLeaf(node.children[1], targetSessionId, sessionId)] };
}

/**
 * Removes a leaf, collapsing any split that's left with only one side —
 * that side takes the collapsed split's place in the tree. Returns null if
 * removing the last leaf empties the tree entirely.
 */
export function removeFromPaneTree(node: PaneNode, sessionId: string): PaneNode | null {
  if (node.type === 'leaf') {
    return node.sessionId === sessionId ? null : node;
  }
  const left = removeFromPaneTree(node.children[0], sessionId);
  const right = removeFromPaneTree(node.children[1], sessionId);
  if (left && right) return { ...node, children: [left, right] };
  return left ?? right ?? null;
}

/** Appends as a new top-level sibling — used only as a fallback when a drop lands outside every pane's rect (e.g. the tree is currently empty). */
export function appendAsRootSibling(node: PaneNode | null, sessionId: string): PaneNode {
  if (!node) return leaf(sessionId);
  return { type: 'split', orientation: 'horizontal', children: [node, leaf(sessionId)] };
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
