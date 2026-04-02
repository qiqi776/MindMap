import type { SemanticMindMapEdge } from '@/components/SemanticEdge';
import type { MindMapNode } from '@/hooks/useForceLayout';
import { canCollapseChildrenForRelation } from '@/lib/relationRegistry';

function isCollapsedNode(node: MindMapNode): boolean {
  return node.data.raw.properties?.collapsed === true;
}

function isHierarchyEdge(edge: SemanticMindMapEdge): boolean {
  const relationType = edge.data?.raw?.relation_type ?? edge.data?.relationType ?? '';
  return canCollapseChildrenForRelation(relationType);
}

export function hasCollapsibleChildren(nodeId: string, edges: SemanticMindMapEdge[]): boolean {
  return edges.some((edge) => edge.source === nodeId && isHierarchyEdge(edge));
}

export function collectHiddenDescendantNodeIDs(
  nodes: MindMapNode[],
  edges: SemanticMindMapEdge[],
): Set<string> {
  const collapsedNodeIDs = nodes.filter(isCollapsedNode).map((node) => node.id);
  if (collapsedNodeIDs.length === 0) {
    return new Set<string>();
  }

  const adjacencyMap = new Map<string, string[]>();
  for (const edge of edges) {
    if (!isHierarchyEdge(edge)) {
      continue;
    }

    const adjacentNodeIDs = adjacencyMap.get(edge.source) ?? [];
    adjacentNodeIDs.push(edge.target);
    adjacencyMap.set(edge.source, adjacentNodeIDs);
  }

  const hiddenNodeIDs = new Set<string>();
  const queue = [...collapsedNodeIDs];

  while (queue.length > 0) {
    const currentNodeId = queue.shift();
    if (!currentNodeId) {
      continue;
    }

    const adjacentNodeIDs = adjacencyMap.get(currentNodeId) ?? [];
    for (const adjacentNodeId of adjacentNodeIDs) {
      if (hiddenNodeIDs.has(adjacentNodeId)) {
        continue;
      }

      hiddenNodeIDs.add(adjacentNodeId);
      queue.push(adjacentNodeId);
    }
  }

  return hiddenNodeIDs;
}
