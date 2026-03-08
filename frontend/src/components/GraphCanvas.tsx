import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement, type RefObject } from 'react';
import {
  addEdge,
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import {
  useForceLayout,
  type GraphEdgeVO,
  type GraphNodeVO,
  type GraphVO,
  type MindMapEdge,
  type MindMapEdgeData,
  type MindMapNode,
  type MindMapNodeData,
} from '../hooks/useForceLayout';

interface GraphCanvasProps {
  graph: GraphVO;
  className?: string;
}

interface ViewportSize {
  width: number;
  height: number;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function readNodeSeed(node: GraphNodeVO, index: number, total: number): { x: number; y: number } {
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

function buildNodeStyle(entityType: string): Node<MindMapNodeData>['style'] {
  const palette: Record<string, { border: string; background: string }> = {
    text: { border: '#2563eb', background: '#eff6ff' },
    person: { border: '#7c3aed', background: '#f5f3ff' },
    image: { border: '#059669', background: '#ecfdf5' },
  };

  const currentPalette = palette[entityType] ?? { border: '#475569', background: '#ffffff' };
  return {
    minWidth: 180,
    padding: 12,
    borderRadius: 12,
    border: `1px solid ${currentPalette.border}`,
    background: currentPalette.background,
    boxShadow: '0 6px 18px rgba(15, 23, 42, 0.08)',
  };
}

function toFlowNode(node: GraphNodeVO, index: number, total: number): MindMapNode {
  return {
    id: node.id,
    type: 'default',
    data: {
      label: node.content,
      entityType: node.type,
      raw: node,
    },
    position: readNodeSeed(node, index, total),
    style: buildNodeStyle(node.type),
  } satisfies MindMapNode;
}

function toFlowEdge(edge: GraphEdgeVO): MindMapEdge {
  return {
    id: edge.id,
    source: edge.source_id,
    target: edge.target_id,
    type: 'smoothstep',
    label: edge.relation_type,
    data: {
      relationType: edge.relation_type,
      weight: edge.weight,
      raw: edge,
    } satisfies MindMapEdgeData,
    animated: false,
    style: {
      strokeWidth: Math.min(Math.max(edge.weight, 1), 4),
      stroke: '#64748b',
    },
    labelStyle: {
      fill: '#334155',
      fontSize: 12,
      fontWeight: 500,
    },
  } satisfies MindMapEdge;
}

function buildFlowTopology(graph: GraphVO): { nodes: MindMapNode[]; edges: MindMapEdge[] } {
  const sourceNodes = graph.nodes ?? [];
  const mappedNodes = sourceNodes.filter((node) => Boolean(node.id)).map((node, index) => toFlowNode(node, index, sourceNodes.length));
  const nodeIDs = new Set(mappedNodes.map((node) => node.id));

  const mappedEdges = (graph.edges ?? [])
    .filter((edge) => Boolean(edge.id) && nodeIDs.has(edge.source_id) && nodeIDs.has(edge.target_id))
    .map(toFlowEdge);

  return {
    nodes: mappedNodes,
    edges: mappedEdges,
  };
}

function createLocalEdge(connection: Connection): MindMapEdge | null {
  if (!connection.source || !connection.target) {
    return null;
  }

  const rawEdge: GraphEdgeVO = {
    id: connection.id ?? `local:${connection.source}:${connection.target}:${Date.now()}`,
    source_id: connection.source,
    target_id: connection.target,
    relation_type: 'RELATED',
    weight: 1,
    properties: {},
  };

  return toFlowEdge(rawEdge);
}

function useViewportSize<T extends HTMLElement>(): {
  containerRef: RefObject<T | null>;
  viewportSize: ViewportSize;
} {
  const containerRef = useRef<T | null>(null);
  const [viewportSize, setViewportSize] = useState<ViewportSize>({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return undefined;
    }

    const updateSize = (width: number, height: number) => {
      setViewportSize((current) => {
        if (current.width === width && current.height === height) {
          return current;
        }

        return { width, height };
      });
    };

    updateSize(element.clientWidth, element.clientHeight);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }

      updateSize(entry.contentRect.width, entry.contentRect.height);
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { containerRef, viewportSize };
}

export function GraphCanvas({ graph, className }: GraphCanvasProps): ReactElement {
  const { containerRef, viewportSize } = useViewportSize<HTMLDivElement>();
  const topology = useMemo(() => buildFlowTopology(graph), [graph]);
  const [topologyNodes, setTopologyNodes] = useState<MindMapNode[]>(topology.nodes);
  const [topologyEdges, setTopologyEdges] = useState<MindMapEdge[]>(topology.edges);
  const [nodes, setNodes, onNodesChange] = useNodesState<MindMapNode>(topology.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<MindMapEdge>(topology.edges);

  useEffect(() => {
    setTopologyNodes(topology.nodes);
    setTopologyEdges(topology.edges);
    setNodes(topology.nodes);
    setEdges(topology.edges);
  }, [setEdges, setNodes, topology]);

  const { onNodeDragStart, onNodeDrag, onNodeDragStop, restartLayout } = useForceLayout({
    topologyNodes,
    topologyEdges,
    width: viewportSize.width,
    height: viewportSize.height,
    setNodes,
  });

  const handleConnect = (connection: Connection) => {
    const nextEdge = createLocalEdge(connection);
    if (!nextEdge) {
      return;
    }

    setEdges((currentEdges) => addEdge(nextEdge, currentEdges));
    setTopologyEdges((currentEdges) => addEdge(nextEdge, currentEdges));
    restartLayout(0.65);
  };

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ width: '100%', height: '100%', minHeight: 560, background: '#f8fafc' }}
    >
      <ReactFlow<MindMapNode, MindMapEdge>
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onConnect={handleConnect}
        fitView
        defaultEdgeOptions={{
          type: 'smoothstep',
          style: { stroke: '#64748b', strokeWidth: 1.5 },
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#e2e8f0" gap={24} />
        <MiniMap zoomable pannable nodeStrokeWidth={3} />
        <Controls />
      </ReactFlow>
    </div>
  );
}
