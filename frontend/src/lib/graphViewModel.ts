import type { Node } from 'reactflow';

import type { SemanticMindMapEdge } from '@/components/SemanticEdge';
import type { GraphNodeVO, GraphVO, MindMapNode, MindMapNodeData } from '@/hooks/useForceLayout';

export interface EdgeLike {
  id: string;
  source_id: string;
  target_id: string;
  relation_type: string;
  weight: number;
  properties?: Record<string, unknown> | null;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function readNodeSeed(node: GraphNodeVO, index: number, total: number): { x: number; y: number } {
  const properties = node.properties;
  if (properties && isFiniteNumber(properties.x) && isFiniteNumber(properties.y)) {
    return { x: properties.x, y: properties.y };
  }

  const safeTotal = Math.max(total, 1);
  const angle = (index / safeTotal) * Math.PI * 2;
  const radius = Math.max(120, safeTotal * 18);

  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  };
}

export function buildNodeClass(entityType: string): Node<MindMapNodeData>['className'] {
  const nodeTypeClass = {
    text: 'graph-node graph-node--text',
    person: 'graph-node graph-node--person',
    image: 'graph-node graph-node--image',
  }[entityType] ?? 'graph-node graph-node--default';

  return nodeTypeClass;
}

export function toFlowNode(node: GraphNodeVO, index: number, total: number): MindMapNode {
  return {
    id: node.id,
    type: 'default',
    data: {
      label: node.content,
      entityType: node.type,
      raw: node,
    },
    position: readNodeSeed(node, index, total),
    className: buildNodeClass(node.type),
  };
}

export function toSemanticEdge(edge: EdgeLike): SemanticMindMapEdge {
  return {
    id: edge.id,
    source: edge.source_id,
    target: edge.target_id,
    type: 'semantic',
    className: 'semantic-edge',
    data: {
      relationType: edge.relation_type,
      weight: edge.weight,
      raw: edge,
    },
    animated: false,
  };
}

export function buildPairKey(sourceNodeID: string, targetNodeID: string): string {
  return sourceNodeID < targetNodeID ? `${sourceNodeID}::${targetNodeID}` : `${targetNodeID}::${sourceNodeID}`;
}

export function buildFallbackRawEdge(edge: SemanticMindMapEdge): EdgeLike {
  return {
    id: edge.id,
    source_id: edge.source,
    target_id: edge.target,
    relation_type: edge.data?.relationType ?? 'UNSPECIFIED',
    weight: edge.data?.weight ?? 1,
    properties: {},
  };
}

export function enrichParallelEdgeData(edges: SemanticMindMapEdge[]): SemanticMindMapEdge[] {
  const groupedEdges = new Map<string, SemanticMindMapEdge[]>();

  for (const edge of edges) {
    const groupKey = buildPairKey(edge.source, edge.target);
    const currentGroup = groupedEdges.get(groupKey);

    if (currentGroup) {
      currentGroup.push(edge);
      continue;
    }

    groupedEdges.set(groupKey, [edge]);
  }

  const normalizedEdges: SemanticMindMapEdge[] = [];

  for (const edgeGroup of groupedEdges.values()) {
    const midpointIndex = (edgeGroup.length - 1) / 2;

    edgeGroup.forEach((edge, index) => {
      edge.className = 'semantic-edge';
      edge.data = {
        relationType: edge.data?.relationType ?? edge.label?.toString() ?? 'UNSPECIFIED',
        weight: edge.data?.weight ?? 1,
        raw: edge.data?.raw ?? buildFallbackRawEdge(edge),
        parallelCount: edgeGroup.length,
        parallelIndex: index - midpointIndex,
        parallelSpacing: 24,
      };

      normalizedEdges.push(edge);
    });
  }

  return normalizedEdges;
}

export function buildFlowTopology(graph: GraphVO): { nodes: MindMapNode[]; edges: SemanticMindMapEdge[] } {
  const sourceNodes = graph.nodes ?? [];
  const mappedNodes = sourceNodes
    .filter((node) => Boolean(node.id))
    .map((node, index) => toFlowNode(node, index, sourceNodes.length));
  const nodeIDs = new Set(mappedNodes.map((node) => node.id));

  const mappedEdges = (graph.edges ?? [])
    .filter((edge) => Boolean(edge.id) && nodeIDs.has(edge.source_id) && nodeIDs.has(edge.target_id))
    .map(toSemanticEdge);

  return {
    nodes: mappedNodes,
    edges: enrichParallelEdgeData(mappedEdges),
  };
}
