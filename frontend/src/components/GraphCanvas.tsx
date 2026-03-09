import {
  applyEdgeChanges,
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
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

import { MindNode } from '@/components/MindNode';
import { SemanticEdge, type SemanticEdgeData, type SemanticMindMapEdge } from '@/components/SemanticEdge';
import { useConnectionCreation } from '@/hooks/useConnectionCreation';
import { setGraphShortcutRuntime, useGraphShortcuts } from '@/hooks/useGraphShortcuts';
import {
  useForceLayout,
  type GraphVO,
  type MindMapNode,
  type MindMapNodeData,
} from '@/hooks/useForceLayout';
import { mergeGraphData, type FocusNodeAnchor } from '@/lib/graphUtils';
import {
  buildFlowTopology,
  enrichParallelEdgeData,
  toSemanticEdge,
  type EdgeLike,
} from '@/lib/graphViewModel';
import {
  fetchFocusGraph,
  GraphApiError,
  isRequestAbortError,
  type GraphEdgeRecord,
} from '@/services/api';
import { useGraphStore } from '@/store/useGraphStore';

interface GraphCanvasProps {
  graph: GraphVO;
  className?: string;
}

interface ViewportSize {
  width: number;
  height: number;
}

const DEFAULT_GRAPH_DEPTH = 1;
const FOCUS_SWITCH_DEBOUNCE_MS = 180;
const CAMERA_ANIMATION_DURATION_MS = 800;

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

function GraphCanvasContent({ graph, className }: GraphCanvasProps): ReactElement {
  const focusNodeId = useGraphStore((state) => state.focusNodeId);
  const isLoading = useGraphStore((state) => state.isLoading);
  const error = useGraphStore((state) => state.error);
  const setError = useGraphStore((state) => state.setError);
  const { setCenter } = useReactFlow();

  useGraphShortcuts(focusNodeId);

  const { containerRef, viewportSize } = useViewportSize<HTMLDivElement>();
  const topology = useMemo(() => buildFlowTopology(graph), [graph]);
  const [layoutNodes, setLayoutNodes] = useState<MindMapNode[]>(topology.nodes);
  const [layoutEdges, setLayoutEdges] = useState<SemanticMindMapEdge[]>(topology.edges);
  const [nodes, setNodes, onNodesChange] = useNodesState<MindMapNodeData>(topology.nodes);
  const [edges, setEdges] = useEdgesState<SemanticEdgeData>(topology.edges);
  const nodesRef = useRef<MindMapNode[]>(topology.nodes);
  const edgesRef = useRef<SemanticMindMapEdge[]>(topology.edges);
  const requestControllerRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<number | null>(null);
  const requestSequenceRef = useRef(0);

  useEffect(() => {
    const nextFocusNodeId = useGraphStore.getState().focusNodeId ?? topology.nodes[0]?.id ?? null;

    nodesRef.current = topology.nodes;
    edgesRef.current = topology.edges;
    setLayoutNodes(topology.nodes);
    setLayoutEdges(topology.edges);
    setNodes(topology.nodes);
    setEdges(topology.edges);
    useGraphStore.getState().setGraphData(topology.nodes, topology.edges);
    useGraphStore.getState().setFocusNode(nextFocusNodeId);
    useGraphStore.getState().setError(null);
  }, [setEdges, setNodes, topology]);

  useEffect(() => {
    nodesRef.current = nodes as MindMapNode[];
  }, [nodes]);

  useEffect(() => {
    edgesRef.current = edges as SemanticMindMapEdge[];
  }, [edges]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
      }
      requestControllerRef.current?.abort();
    };
  }, []);

  const {
    onNodeDragStart,
    onNodeDrag,
    onNodeDragStop,
    restartLayout,
    scheduleFocusReheat,
  } = useForceLayout({
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

  const nodeTypes = useMemo(() => ({
    mind: MindNode,
  }), []);

  const commitMergedTopology = useCallback((nextNodes: MindMapNode[], nextEdges: SemanticMindMapEdge[]) => {
    nodesRef.current = nextNodes;
    edgesRef.current = nextEdges;
    setLayoutNodes(nextNodes);
    setLayoutEdges(nextEdges);
    setNodes(nextNodes);
    setEdges(nextEdges);
    useGraphStore.getState().setGraphData(nextNodes, nextEdges);
  }, [setEdges, setNodes]);

  useEffect(() => {
    setGraphShortcutRuntime({
      getNodes: () => nodesRef.current,
      getEdges: () => edgesRef.current,
      commitTopology: commitMergedTopology,
      restartLayout,
    });

    return () => {
      setGraphShortcutRuntime(null);
    };
  }, [commitMergedTopology, restartLayout]);

  const panCameraToCenter = useCallback(() => {
    const centerX = viewportSize.width > 0 ? viewportSize.width / 2 : 0;
    const centerY = viewportSize.height > 0 ? viewportSize.height / 2 : 0;
    setCenter(centerX, centerY, { duration: CAMERA_ANIMATION_DURATION_MS });
  }, [setCenter, viewportSize.height, viewportSize.width]);

  const performFocusSwitch = useCallback(async (
    focusAnchor: FocusNodeAnchor,
    controller: AbortController,
    requestSequence: number,
    previousFocusNodeId: string | null,
  ) => {
    try {
      const nextGraph = await fetchFocusGraph(focusAnchor.id, DEFAULT_GRAPH_DEPTH, {
        signal: controller.signal,
      });

      if (requestControllerRef.current !== controller || requestSequenceRef.current !== requestSequence) {
        return;
      }

      const nextTopology = buildFlowTopology(nextGraph);
      const mergedTopology = mergeGraphData({
        oldNodes: nodesRef.current,
        oldEdges: edgesRef.current,
        newNodes: nextTopology.nodes,
        newEdges: nextTopology.edges,
        currentFocusNode: focusAnchor,
      });
      const normalizedEdges = enrichParallelEdgeData(mergedTopology.edges);

      commitMergedTopology(mergedTopology.nodes, normalizedEdges);
      scheduleFocusReheat(focusAnchor);
      useGraphStore.getState().setFocusNode(focusAnchor.id);
      useGraphStore.getState().setLoading(false);
      useGraphStore.getState().setError(null);
      panCameraToCenter();
    } catch (error) {
      if (isRequestAbortError(error)) {
        return;
      }

      const message = error instanceof GraphApiError && error.status === 404
        ? '焦点节点不存在或已被删除'
        : error instanceof GraphApiError
          ? error.message
          : 'Failed to switch focus node';

      useGraphStore.getState().setFocusNode(previousFocusNodeId);
      useGraphStore.getState().setLoading(false);
      useGraphStore.getState().setError(message);
    } finally {
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null;
      }
    }
  }, [commitMergedTopology, panCameraToCenter, scheduleFocusReheat]);

  const handleEdgeChanges = useCallback((changes: EdgeChange[]) => {
    setEdges((currentEdges) => {
      const nextEdges = enrichParallelEdgeData(
        applyEdgeChanges(changes, currentEdges as Edge<SemanticEdgeData>[]) as SemanticMindMapEdge[],
      );
      edgesRef.current = nextEdges;
      useGraphStore.getState().setGraphData(nodesRef.current, nextEdges);
      setLayoutEdges(nextEdges);
      return nextEdges;
    });
  }, [setEdges]);

  const handleNodeClick = useCallback<NodeMouseHandler>((_, node: Node) => {
    if (node.id === focusNodeId) {
      useGraphStore.getState().setFocusNode(node.id);
      return;
    }

    const previousFocusNodeId = useGraphStore.getState().focusNodeId;
    const focusAnchor: FocusNodeAnchor = {
      id: node.id,
      x: node.position.x,
      y: node.position.y,
    };

    cancelConnection();
    useGraphStore.getState().setFocusNode(node.id);
    useGraphStore.getState().setLoading(true);
    useGraphStore.getState().setError(null);

    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    requestControllerRef.current?.abort();

    const controller = new AbortController();
    requestControllerRef.current = controller;
    const nextRequestSequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = nextRequestSequence;

    debounceTimerRef.current = window.setTimeout(() => {
      debounceTimerRef.current = null;
      void performFocusSwitch(focusAnchor, controller, nextRequestSequence, previousFocusNodeId);
    }, FOCUS_SWITCH_DEBOUNCE_MS);
  }, [cancelConnection, focusNodeId, performFocusSwitch]);

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
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={handleEdgeChanges}
        onNodeClick={handleNodeClick}
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onConnect={openConnectionPopover}
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

export function GraphCanvas(props: GraphCanvasProps): ReactElement {
  return (
    <ReactFlowProvider>
      <GraphCanvasContent {...props} />
    </ReactFlowProvider>
  );
}
