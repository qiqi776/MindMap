import {
  applyEdgeChanges,
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeMouseHandler,
} from 'reactflow';
import 'reactflow/dist/style.css';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type ReactElement,
  type RefObject,
  type SetStateAction,
} from 'react';

import { useConnectionCreation } from '@/hooks/useConnectionCreation';
import {
  useForceLayout,
  type GraphVO,
  type MindMapNode,
  type MindMapNodeData,
} from '@/hooks/useForceLayout';
import {
  buildFlowTopology,
  enrichParallelEdgeData,
  toSemanticEdge,
  type EdgeLike,
} from '@/lib/graphViewModel';
import type { GraphEdgeRecord } from '@/services/api';
import { useGraphStore } from '@/store/useGraphStore';
import { SemanticEdge, type SemanticEdgeData, type SemanticMindMapEdge } from '@/components/SemanticEdge';

interface GraphCanvasProps {
  graph: GraphVO;
  className?: string;
}

interface ViewportSize {
  width: number;
  height: number;
}

function useViewportSize<T extends HTMLElement>(): {
  containerRef: RefObject<T>;
  viewportSize: ViewportSize;
} {
  const containerRef = useRef<T>(null);
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
  const paletteClassName = intent === 'error' ? 'graph-toast graph-toast--error' : 'graph-toast graph-toast--success';

  return (
    <div className={paletteClassName}>
      <div className="graph-toast__content">
        <div className="graph-toast__message">{message}</div>
        <button
          type="button"
          onClick={onClose}
          className="graph-toast__close"
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
  const inputRef = useRef<HTMLInputElement>(null);

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
    <div className="graph-popover-overlay">
      <div
        className="graph-popover-panel"
        style={{
          left: position.x,
          top: position.y,
          transform: 'translate(-50%, -50%)',
        }}
      >
        <form onSubmit={handleSubmit}>
          <div className="graph-popover__title">创建语义连线</div>
          <div className="graph-popover__subtitle">{sourceId} → {targetId}</div>
          <label className="graph-form-label">relation_type</label>
          <input
            ref={inputRef}
            value={relationType}
            disabled={isSubmitting}
            onChange={(event) => onRelationTypeChange(event.target.value)}
            placeholder="例如: MARRIAGE"
            className="graph-input"
          />
          <div className="graph-action-row">
            <button
              type="button"
              onClick={onCancel}
              disabled={isSubmitting}
              className="graph-btn-secondary"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isConfirmDisabled}
              className="graph-btn-primary"
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
  const focusNodeId = useGraphStore((state) => state.focusNodeId);
  const isLoading = useGraphStore((state) => state.isLoading);
  const error = useGraphStore((state) => state.error);
  const setError = useGraphStore((state) => state.setError);

  const { containerRef, viewportSize } = useViewportSize<HTMLDivElement>();
  const topology = useMemo(() => buildFlowTopology(graph), [graph]);
  const [layoutNodes, setLayoutNodes] = useState<MindMapNode[]>(topology.nodes);
  const [layoutEdges, setLayoutEdges] = useState<SemanticMindMapEdge[]>(topology.edges);
  const [nodes, setNodes, onNodesChange] = useNodesState<MindMapNodeData>(topology.nodes);
  const [edges, setEdges] = useEdgesState<SemanticEdgeData>(topology.edges);
  const nodesRef = useRef<MindMapNode[]>(topology.nodes);

  useEffect(() => {
    nodesRef.current = topology.nodes;
    setLayoutNodes(topology.nodes);
    setLayoutEdges(topology.edges);
    setNodes(topology.nodes);
    setEdges(topology.edges);
    useGraphStore.getState().setGraphData(topology.nodes, topology.edges);
    useGraphStore.getState().setFocusNode(topology.nodes[0]?.id ?? null);
    useGraphStore.getState().setError(null);
  }, [setEdges, setNodes, topology]);

  useEffect(() => {
    nodesRef.current = nodes as MindMapNode[];
  }, [nodes]);

  const { onNodeDragStart, onNodeDrag, onNodeDragStop, restartLayout } = useForceLayout({
    topologyNodes: layoutNodes,
    topologyEdges: layoutEdges,
    width: viewportSize.width,
    height: viewportSize.height,
    setNodes: setNodes as Dispatch<SetStateAction<MindMapNode[]>>,
  });

  const overlayPosition = useCallback(() => {
    return {
      x: Math.max(viewportSize.width / 2, 180),
      y: Math.max(viewportSize.height / 2, 140),
    };
  }, [viewportSize.height, viewportSize.width]);

  const handlePersistedEdge = useCallback((persistedEdge: GraphEdgeRecord) => {
    const nextFlowEdge = toSemanticEdge(persistedEdge as EdgeLike);
    const nextEdges = useGraphStore.getState().addSemanticEdge(nextFlowEdge);
    setLayoutEdges(nextEdges);
    setEdges(nextEdges);
  }, [setEdges]);

  const {
    relationPopover,
    openConnectionPopover,
    updateRelationType,
    confirmConnection,
    cancelConnection,
  } = useConnectionCreation({
    getOverlayPosition: overlayPosition,
    onEdgeCreated: handlePersistedEdge,
    restartLayout,
  });

  const edgeTypes = useMemo(() => ({
    semantic: SemanticEdge,
  }), []);

  const handleEdgeChanges = useCallback((changes: EdgeChange[]) => {
    setEdges((currentEdges) => {
      const nextEdges = enrichParallelEdgeData(
        applyEdgeChanges(changes, currentEdges as Edge<SemanticEdgeData>[]) as SemanticMindMapEdge[],
      );
      useGraphStore.getState().setGraphData(nodesRef.current, nextEdges);
      setLayoutEdges(nextEdges);
      return nextEdges;
    });
  }, [setEdges]);

  const handleNodeClick = useCallback<NodeMouseHandler>((_, node: Node) => {
    useGraphStore.getState().setFocusNode(node.id);
  }, []);

  useEffect(() => {
    cancelConnection();
  }, [cancelConnection, graph]);

  const rootClassName = ['graph-canvas', className].filter(Boolean).join(' ');

  return (
    <div ref={containerRef} className={rootClassName}>
      {focusNodeId ? <div className="graph-focus-badge">焦点节点：{focusNodeId}</div> : null}
      {error ? <ToastMessage intent="error" message={error} onClose={() => setError(null)} /> : null}
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
      <ReactFlow
        nodes={nodes}
        edges={edges}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={handleEdgeChanges}
        onNodeClick={handleNodeClick}
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onConnect={openConnectionPopover}
        fitView
        defaultEdgeOptions={{
          type: 'semantic',
          className: 'semantic-edge',
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#e2e8f0" gap={24} />
        <MiniMap zoomable pannable nodeStrokeWidth={3} />
        <Controls />
      </ReactFlow>
      {isLoading ? <div className="graph-loading-mask">正在同步图谱数据…</div> : null}
    </div>
  );
}
