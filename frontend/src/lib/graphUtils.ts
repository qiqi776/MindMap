export interface GraphPosition {
  x: number;
  y: number;
}

export interface GraphNodeLike {
  id: string;
  position: GraphPosition;
}

export interface GraphEdgeLike {
  id: string;
  source: string;
  target: string;
}

export interface FocusNodeAnchor {
  id: string;
  x: number;
  y: number;
}

export interface MergeGraphDataParams<TNode extends GraphNodeLike, TEdge extends GraphEdgeLike> {
  oldNodes: TNode[];
  oldEdges: TEdge[];
  newNodes: TNode[];
  newEdges: TEdge[];
  currentFocusNode: FocusNodeAnchor;
}

export interface GraphMergeResult<TNode extends GraphNodeLike, TEdge extends GraphEdgeLike> {
  nodes: TNode[];
  edges: TEdge[];
}

function synchronizeNodeReference<TNode extends GraphNodeLike>(existingNode: TNode, incomingNode: TNode): TNode {
  const preservedPosition = existingNode.position;

  Object.assign(existingNode, incomingNode);
  existingNode.position = preservedPosition;

  return existingNode;
}

function synchronizeEdgeReference<TEdge extends GraphEdgeLike>(existingEdge: TEdge, incomingEdge: TEdge): TEdge {
  Object.assign(existingEdge, incomingEdge);
  return existingEdge;
}

function initializeAddedNode<TNode extends GraphNodeLike>(incomingNode: TNode, focusNode: FocusNodeAnchor): TNode {
  incomingNode.position = {
    x: focusNode.x,
    y: focusNode.y,
  };

  return incomingNode;
}

export function mergeGraphData<TNode extends GraphNodeLike, TEdge extends GraphEdgeLike>({
  oldNodes,
  oldEdges,
  newNodes,
  newEdges,
  currentFocusNode,
}: MergeGraphDataParams<TNode, TEdge>): GraphMergeResult<TNode, TEdge> {
  const oldNodeMap = new Map<string, TNode>();
  const oldEdgeMap = new Map<string, TEdge>();
  const newNodeMap = new Map<string, TNode>();
  const mergedNodeMap = new Map<string, TNode>();

  for (const oldNode of oldNodes) {
    oldNodeMap.set(oldNode.id, oldNode);
  }

  for (const oldEdge of oldEdges) {
    oldEdgeMap.set(oldEdge.id, oldEdge);
  }

  const mergedNodes: TNode[] = [];

  for (const incomingNode of newNodes) {
    newNodeMap.set(incomingNode.id, incomingNode);

    const existingNode = oldNodeMap.get(incomingNode.id);
    const nextNode = existingNode
      ? synchronizeNodeReference(existingNode, incomingNode)
      : initializeAddedNode(incomingNode, currentFocusNode);

    mergedNodes.push(nextNode);
    mergedNodeMap.set(nextNode.id, nextNode);
  }

  if (!newNodeMap.has(currentFocusNode.id)) {
    const retainedFocusNode = oldNodeMap.get(currentFocusNode.id);
    if (retainedFocusNode) {
      mergedNodes.push(retainedFocusNode);
      mergedNodeMap.set(retainedFocusNode.id, retainedFocusNode);
    }
  }

  const mergedEdges: TEdge[] = [];

  for (const incomingEdge of newEdges) {
    if (!mergedNodeMap.has(incomingEdge.source) || !mergedNodeMap.has(incomingEdge.target)) {
      continue;
    }

    const existingEdge = oldEdgeMap.get(incomingEdge.id);
    const nextEdge = existingEdge
      ? synchronizeEdgeReference(existingEdge, incomingEdge)
      : incomingEdge;

    mergedEdges.push(nextEdge);
  }

  return {
    nodes: mergedNodes,
    edges: mergedEdges,
  };
}
