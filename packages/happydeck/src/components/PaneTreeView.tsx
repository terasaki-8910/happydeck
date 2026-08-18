import { Fragment, type ReactNode } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import type { PaneNode } from '../lib/paneTree';

interface PaneTreeViewProps {
  node: PaneNode;
  renderLeaf: (sessionId: string) => ReactNode;
  registerLeafRef: (sessionId: string, el: HTMLElement | null) => void;
  /** Registers a divider's DOM element, keyed by the split's own path and which gap (between children[gapIndex-1] and children[gapIndex]) it sits at — used to detect divider-drops for the even-rebalance gesture. */
  registerGapRef: (splitPath: string, gapIndex: number, el: HTMLDivElement | null) => void;
  /** Path of child-indices from the root, used to build stable-but-unique Panel ids for split (non-leaf) children — a leaf just uses its own sessionId, and also identifies which split a divider-drop's gap belongs to. */
  path?: string;
}

function panelId(node: PaneNode, path: string): string {
  return node.type === 'leaf' ? node.sessionId : `split-${path}`;
}

/**
 * Renders a paneTree recursively as nested react-resizable-panels Groups.
 * Panel/Separator must be direct JSX children of their own Group (the
 * library only inspects immediate children, not the full render tree) —
 * satisfied here because each split's Panels + Separators are written
 * directly inside that split's own <Group>, even though each Panel's
 * content is itself another PaneTreeView call that may render a further
 * nested Group.
 */
export function PaneTreeView({ node, renderLeaf, registerLeafRef, registerGapRef, path = '' }: PaneTreeViewProps) {
  if (node.type === 'leaf') {
    return (
      <div className="pane-leaf" ref={(el) => registerLeafRef(node.sessionId, el)}>
        {renderLeaf(node.sessionId)}
      </div>
    );
  }
  return (
    // rebalanceNonce forces a clean remount when this exact split was just
    // touched by an even-split gesture, so every child (including ones
    // carried over with stale manual-resize sizing) actually lands on an
    // even share instead of keeping its old proportions.
    <Group key={node.rebalanceNonce ?? 'stable'} orientation={node.orientation} className="pane-split">
      {node.children.map((child, i) => (
        <Fragment key={child.type === 'leaf' ? child.sessionId : `${path}${i}`}>
          {i > 0 && <Separator className="pane-separator" elementRef={(el) => registerGapRef(path, i, el)} />}
          <Panel id={panelId(child, `${path}${i}`)} minSize={160}>
            <PaneTreeView node={child} renderLeaf={renderLeaf} registerLeafRef={registerLeafRef} registerGapRef={registerGapRef} path={`${path}${i}`} />
          </Panel>
        </Fragment>
      ))}
    </Group>
  );
}
