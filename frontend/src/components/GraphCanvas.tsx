import {
  applyEdgeChanges,
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type EdgeChange,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
  type RefObject,
} from 'react';

import {
  useForceLayout,
  type GraphNodeVO,
  type GraphVO,
  type MindMapNode,
  type MindMapNodeData,
} from '../hooks/useForceLayout';
import { useConnectionCreation } from '../hooks/useConnectionCreation';
import type { GraphEdgeRecord } from '../services/api';
import { SemanticEdge, type SemanticEdgeData, type SemanticMindMapEdge } from './SemanticEdge';

interface GraphCanvasProps {
  graph: GraphVO;
  className?: string;
}

interface ViewportSize {
  width: number;
  height: number;
}

interface EdgeLike {
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

function toFlowEdge(edge: EdgeLike): SemanticMindMapEdge {
  return {
    id: edge.id,
    source: edge.source_id,
    target: edge.target_id,
    type: 'semantic',
    data: {
      relationType: edge.relation_type,
      weight: edge.weight,
      raw: edge,
    } satisfies SemanticEdgeData,
    animated: false,
    style: {
      strokeWidth: Math.min(Math.max(edge.weight, 1), 4),
      stroke: '#64748b',
    },
  } satisfies SemanticMindMapEdge;
}

function buildPairKey(sourceNodeID: string, targetNodeID: string): string {
  return sourceNodeID < targetNodeID ? `${sourceNodeID}::${targetNodeID}` : `${targetNodeID}::${sourceNodeID}`;
}

function buildFallbackRawEdge(edge: SemanticMindMapEdge): EdgeLike {
  return {
    id: edge.id,
    source_id: edge.source,
    target_id: edge.target,
    relation_type: edge.data?.relationType ?? 'UNSPECIFIED',
    weight: edge.data?.weight ?? 1,
    properties: {},
  };
}

function enrichParallelEdgeData(edges: SemanticMindMapEdge[]): SemanticMindMapEdge[] {
  const groupedEdges = new Map<string, SemanticMindMapEdge[]>();

  for (const edge of edges) {
    const groupKey = buildPairKey(edge.source, edge.target);
    const currentGroup = groupedEdges.get(groupKey) ?? [];
    currentGroup.push(edge);
    groupedEdges.set(groupKey, currentGroup);
  }

  const normalizedEdges: SemanticMindMapEdge[] = [];

  for (const edgeGroup of groupedEdges.values()) {
    const sortedGroup = [...edgeGroup].sort((leftEdge, rightEdge) => {
      if (leftEdge.source !== rightEdge.source) {
        return leftEdge.source.localeCompare(rightEdge.source);
      }

      if (leftEdge.target !== rightEdge.target) {
        return leftEdge.target.localeCompare(rightEdge.target);
      }

      return leftEdge.id.localeCompare(rightEdge.id);
    });

    const midpointIndex = (sortedGroup.length - 1) / 2;
    sortedGroup.forEach((edge, index) => {
      normalizedEdges.push({
        ...edge,
        type: 'semantic',
        data: {
          relationType: edge.data?.relationType ?? edge.label?.toString() ?? 'UNSPECIFIED',
          weight: edge.data?.weight ?? 1,
          raw: edge.data?.raw ?? buildFallbackRawEdge(edge),
          parallelCount: sortedGroup.length,
          parallelIndex: index - midpointIndex,
          parallelSpacing: 24,
        },
      });
    });
  }

  return normalizedEdges.sort((leftEdge, rightEdge) => leftEdge.id.localeCompare(rightEdge.id));
}

function buildFlowTopology(graph: GraphVO): { nodes: MindMapNode[]; edges: SemanticMindMapEdge[] } {
  const sourceNodes = graph.nodes ?? [];
  const mappedNodes = sourceNodes.filter((node) => Boolean(node.id)).map((node, index) => toFlowNode(node, index, sourceNodes.length));
  const nodeIDs = new Set(mappedNodes.map((node) => node.id));

  const mappedEdges = (graph.edges ?? [])
    .filter((edge) => Boolean(edge.id) && nodeIDs.has(edge.source_id) && nodeIDs.has(edge.target_id))
    .map(toFlowEdge);

  return {
    nodes: mappedNodes,
    edges: enrichParallelEdgeData(mappedEdges),
  };
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

function ToastMessage(props: {
  intent: 'error' | 'success';
  message: string;
  onClose: () => void;
}): ReactElement {
  const { intent, message, onClose } = props;
  const palette = intent === 'error'
    ? { background: '#fef2f2', border: '#fecaca', color: '#991b1b' }
    : { background: '#ecfdf5', border: '#a7f3d0', color: '#065f46' };

  return (
    <div
      style={{
        position: 'absolute',
        top: 24,
        left: '50%',
        zIndex: 30,
        transform: 'translateX(-50%)',
        minWidth: 320,
        maxWidth: 480,
        padding: '12px 16px',
        borderRadius: 12,
        border: `1px solid ${palette.border}`,
        background: palette.background,
        color: palette.color,
        boxShadow: '0 10px 30px rgba(15, 23, 42, 0.12)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{message}</div>
        <button
          type="button"
          onClick={onClose}
          style={{
            border: 'none',
            background: 'transparent',
            color: 'inherit',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          关闭
        </button>
      </div>
    </div>
  );
}

function RelationInputPopover(props: {
  sourceId: string;
  targetId: string;
  relationType: string;
  position: { x: number; y: number };
  isSubmitting: boolean;
  onRelationTypeChange: (relationType: string) => void;
  onCancel: () => void;
  onSubmit: () => Promise<void>;
}): ReactElement {
  const {
    sourceId,
    targetId,
    relationType,
    position,
    isSubmitting,
    onRelationTypeChange,
    onCancel,
    onSubmit,
  } = props;
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isSubmitting) {
      inputRef.current?.focus();
    }
  }, [isSubmitting]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onSubmit();
  };

  const isConfirmDisabled = isSubmitting || relationType.trim().length === 0;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 20,
        background: 'rgba(15, 23, 42, 0.12)',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: position.x,
          top: position.y,
          width: 360,
          transform: 'translate(-50%, -50%)',
          borderRadius: 16,
          border: '1px solid #cbd5e1',
          background: '#ffffff',
          boxShadow: '0 24px 48px rgba(15, 23, 42, 0.18)',
          padding: 20,
        }}
      >
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 8, fontSize: 15, fontWeight: 700, color: '#0f172a' }}>
            创建语义连线
          </div>
          <div style={{ marginBottom: 16, fontSize: 12, color: '#475569' }}>
            {sourceId} → {targetId}
          </div>
          <label style={{ display: 'block', marginBottom: 8, fontSize: 12, fontWeight: 600, color: '#334155' }}>
            relation_type
          </label>
          <input
            ref={inputRef}
            value={relationType}
            disabled={isSubmitting}
            onChange={(event) => onRelationTypeChange(event.target.value)}
            placeholder="例如: MARRIAGE"
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '10px 12px',
              borderRadius: 10,
              border: '1px solid #cbd5e1',
              fontSize: 14,
              color: '#0f172a',
              outline: 'none',
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 18 }}>
            <button
              type="button"
              onClick={onCancel}
              disabled={isSubmitting}
              style={{
                padding: '10px 14px',
                borderRadius: 10,
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                color: '#334155',
                cursor: isSubmitting ? 'not-allowed' : 'pointer',
              }}
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isConfirmDisabled}
              style={{
                padding: '10px 14px',
                borderRadius: 10,
                border: '1px solid #2563eb',
                background: isConfirmDisabled ? '#bfdbfe' : '#2563eb',
                color: '#ffffff',
                cursor: isConfirmDisabled ? 'not-allowed' : 'pointer',
                fontWeight: 600,
              }}
            >
              {isSubmitting ? '提交中…' : '确认'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function GraphCanvas({ graph, className }: GraphCanvasProps): ReactElement {
  const { containerRef, viewportSize } = useViewportSize<HTMLDivElement>();
  const topology = useMemo(() => buildFlowTopology(graph), [graph]);
  const [topologyNodes, setTopologyNodes] = useState<MindMapNode[]>(topology.nodes);
  const [topologyEdges, setTopologyEdges] = useState<SemanticMindMapEdge[]>(topology.edges);
  const [nodes, setNodes, onNodesChange] = useNodesState<MindMapNode>(topology.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<SemanticMindMapEdge>(topology.edges);

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

  const overlayPosition = useCallback(() => {
    return {
      x: Math.max(viewportSize.width / 2, 180),
      y: Math.max(viewportSize.height / 2, 140),
    };
  }, [viewportSize.height, viewportSize.width]);

  const handlePersistedEdge = useCallback((persistedEdge: GraphEdgeRecord) => {
    const nextFlowEdge = toFlowEdge(persistedEdge);
    setTopologyEdges((currentEdges) => enrichParallelEdgeData([...currentEdges, nextFlowEdge]));
    setEdges((currentEdges) => enrichParallelEdgeData([...currentEdges, nextFlowEdge]));
  }, [setEdges]);

  const {
    relationPopover,
    toast,
    openConnectionPopover,
    updateRelationType,
    confirmConnection,
    cancelConnection,
    dismissToast,
  } = useConnectionCreation({
    getOverlayPosition: overlayPosition,
    onEdgeCreated: handlePersistedEdge,
    restartLayout,
  });

  const edgeTypes = useMemo(() => {
    return {
      semantic: SemanticEdge,
    };
  }, []);

  const handleEdgeChanges = useCallback((changes: EdgeChange<SemanticMindMapEdge>[]) => {
    onEdgesChange(changes);
    setTopologyEdges((currentEdges) => enrichParallelEdgeData(applyEdgeChanges(changes, currentEdges)));
  }, [onEdgesChange]);

  useEffect(() => {
    cancelConnection();
  }, [cancelConnection, graph]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ position: 'relative', width: '100%', height: '100%', minHeight: 560, background: '#f8fafc' }}
    >
      {toast ? <ToastMessage intent={toast.intent} message={toast.message} onClose={dismissToast} /> : null}
      {relationPopover.isConnecting && relationPopover.pendingConnection ? (
        <RelationInputPopover
          sourceId={relationPopover.pendingConnection.sourceId}
          targetId={relationPopover.pendingConnection.targetId}
          relationType={relationPopover.relationType}
          position={relationPopover.position}
          isSubmitting={relationPopover.isSubmitting}
          onRelationTypeChange={updateRelationType}
          onCancel={cancelConnection}
          onSubmit={confirmConnection}
        />
      ) : null}
      <ReactFlow<MindMapNode, SemanticMindMapEdge>
        nodes={nodes}
        edges={edges}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={handleEdgeChanges}
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onConnect={openConnectionPopover}
        fitView
        defaultEdgeOptions={{
          type: 'semantic',
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
