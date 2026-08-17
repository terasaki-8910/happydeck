import type { ReactNode } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import type { PaneNode } from '../lib/paneTree';

interface PaneTreeViewProps {
  node: PaneNode;
  renderLeaf: (sessionId: string) => ReactNode;
  registerLeafRef: (sessionId: string, el: HTMLElement | null) => void;
  /** Path of child-indices from the root, used to build stable-but-unique Panel ids for split (non-leaf) children — a leaf just uses its own sessionId. */
  path?: string;
}

function panelId(node: PaneNode, path: string): string {
  return node.type === 'leaf' ? node.sessionId : `split-${path}`;
}

/**
 * Renders a paneTree recursively as nested react-resizable-panels Groups.
 * Panel/Separator must be direct JSX children of their own Group (the
 * library only inspects immediate children, not the full render tree) —
 * satisfied here because each split's two Panels + Separator are written
 * directly inside that split's own <Group>, even though each Panel's
 * content is itself another PaneTreeView call that may render a further
 * nested Group.
 */
export function PaneTreeView({ node, renderLeaf, registerLeafRef, path = '' }: PaneTreeViewProps) {
  if (node.type === 'leaf') {
    return (
      <div className="pane-leaf" ref={(el) => registerLeafRef(node.sessionId, el)}>
        {renderLeaf(node.sessionId)}
      </div>
    );
  }
  return (
    <Group orientation={node.orientation} className="pane-split">
      <Panel id={panelId(node.children[0], `${path}0`)} minSize={160}>
        <PaneTreeView node={node.children[0]} renderLeaf={renderLeaf} registerLeafRef={registerLeafRef} path={`${path}0`} />
      </Panel>
      <Separator className="pane-separator" />
      <Panel id={panelId(node.children[1], `${path}1`)} minSize={160}>
        <PaneTreeView node={node.children[1]} renderLeaf={renderLeaf} registerLeafRef={registerLeafRef} path={`${path}1`} />
      </Panel>
    </Group>
  );
}
