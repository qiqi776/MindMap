import {
  applyEdgeChanges,
  Background,
  Controls,
  type EdgeMouseHandler,
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
  type ChangeEvent,
  type Dispatch,
  type FormEvent,
  type KeyboardEvent,
  type ReactElement,
  type RefObject,
  type SetStateAction,
} from 'react';

import { MindNode } from '@/components/MindNode';
import { SemanticEdge, type SemanticEdgeData, type SemanticMindMapEdge } from '@/components/SemanticEdge';
import { useConnectionCreation } from '@/hooks/useConnectionCreation';
import {
  buildGraphHistorySnapshot,
  canRedoGraphCommand,
  canUndoGraphCommand,
  createChildNodeCommand,
  createRootNodeCommand,
  createSiblingNodeCommand,
  captureGraphHistorySnapshot,
  deleteSelectionCommand,
  pushGraphHistoryEntry,
  redoGraphCommand,
  setGraphShortcutRuntime,
  undoGraphCommand,
  useGraphShortcuts,
} from '@/hooks/useGraphShortcuts';
import {
  useForceLayout,
  type MindMapNode,
  type MindMapNodeData,
} from '@/hooks/useForceLayout';
import { mergeGraphData, type FocusNodeAnchor } from '@/lib/graphUtils';
import { readNodeCollapsedField } from '@/lib/nodeFields';
import {
  buildFlowTopology,
  enrichParallelEdgeData,
  toSemanticEdge,
  type EdgeLike,
} from '@/lib/graphViewModel';
import { collectHiddenDescendantNodeIDs, hasCollapsibleChildren } from '@/lib/graphVisibility';
import {
  createGraphEdge,
  deleteGraphEdge,
  GraphApiError,
  isRequestAbortError,
  updateGraphNode,
  type CreateGraphEdgeRequest,
  type GraphEdgeRecord,
} from '@/services/api';
import { useGraphStore } from '@/store/useGraphStore';

interface GraphCanvasProps {
  className?: string;
}

interface ViewportSize {
  width: number;
  height: number;
}

const DEFAULT_GRAPH_DEPTH = 1;
const FOCUS_SWITCH_DEBOUNCE_MS = 180;
const CAMERA_ANIMATION_DURATION_MS = 800;

function normalizeSearchValue(value: string): string {
  return value.trim().toLowerCase();
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

function GraphCanvasContent({ className }: GraphCanvasProps): ReactElement {
  const storeNodes = useGraphStore((state) => state.nodes);
  const storeEdges = useGraphStore((state) => state.edges);
  const focusNodeId = useGraphStore((state) => state.focusNodeId);
  const selectedNodeId = useGraphStore((state) => state.selectedNodeId);
  const selectedEdgeId = useGraphStore((state) => state.selectedEdgeId);
  const isLoading = useGraphStore((state) => state.isLoading);
  const error = useGraphStore((state) => state.error);
  const graphSessionId = useGraphStore((state) => state.graphSessionId);
  const setError = useGraphStore((state) => state.setError);
  const setSelectedNode = useGraphStore((state) => state.setSelectedNode);
  const setSelectedEdge = useGraphStore((state) => state.setSelectedEdge);
  const clearSelection = useGraphStore((state) => state.clearSelection);
  const fetchFocusGraph = useGraphStore((state) => state.fetchFocusGraph);
  const startGraphSession = useGraphStore((state) => state.startGraphSession);
  const { setCenter } = useReactFlow();

  useGraphShortcuts(selectedNodeId, selectedEdgeId);

  const { containerRef, viewportSize } = useViewportSize<HTMLDivElement>();
  const [layoutNodes, setLayoutNodes] = useState<MindMapNode[]>(storeNodes);
  const [layoutEdges, setLayoutEdges] = useState<SemanticMindMapEdge[]>(storeEdges);
  const [nodes, setNodes, onNodesChange] = useNodesState<MindMapNodeData>(storeNodes);
  const [edges, setEdges] = useEdgesState<SemanticEdgeData>(storeEdges);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const hiddenDescendantNodeIDs = useMemo(() => collectHiddenDescendantNodeIDs(layoutNodes, layoutEdges), [layoutEdges, layoutNodes]);
  const visibleLayoutNodes = useMemo(() => layoutNodes.filter((node) => !hiddenDescendantNodeIDs.has(node.id)), [hiddenDescendantNodeIDs, layoutNodes]);
  const visibleLayoutEdges = useMemo(() => {
    const visibleNodeIDs = new Set(visibleLayoutNodes.map((node) => node.id));
    return layoutEdges.filter((edge) => visibleNodeIDs.has(edge.source) && visibleNodeIDs.has(edge.target));
  }, [layoutEdges, visibleLayoutNodes]);
  const nodesRef = useRef<MindMapNode[]>(storeNodes);
  const edgesRef = useRef<SemanticMindMapEdge[]>(storeEdges);
  const requestControllerRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<number | null>(null);
  const requestSequenceRef = useRef(0);

  useEffect(() => {
    nodesRef.current = storeNodes;
    edgesRef.current = storeEdges;
    setLayoutNodes(storeNodes);
    setLayoutEdges(storeEdges);
    setNodes(storeNodes);
    setEdges(storeEdges);
  }, [graphSessionId, setEdges, setNodes, storeEdges, storeNodes]);

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
    topologyNodes: visibleLayoutNodes,
    topologyEdges: visibleLayoutEdges,
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
    const beforeSnapshot = captureGraphHistorySnapshot();
    const nextFlowEdge = toSemanticEdge(persistedEdge as EdgeLike);
    const nextEdges = useGraphStore.getState().addSemanticEdge(nextFlowEdge);
    edgesRef.current = nextEdges;
    setLayoutEdges(nextEdges);
    setEdges(nextEdges);
    const afterSnapshot = buildGraphHistorySnapshot(
      nodesRef.current,
      nextEdges,
      useGraphStore.getState().selectedNodeId,
      useGraphStore.getState().selectedEdgeId,
      useGraphStore.getState().focusNodeId,
    );

    if (beforeSnapshot) {
      const edgePayload: CreateGraphEdgeRequest = {
        id: persistedEdge.id,
        source_id: persistedEdge.source_id,
        target_id: persistedEdge.target_id,
        relation_type: persistedEdge.relation_type,
        weight: persistedEdge.weight,
        properties: persistedEdge.properties ?? {},
      };

      pushGraphHistoryEntry({
        label: 'create-edge',
        undoSnapshot: beforeSnapshot,
        redoSnapshot: afterSnapshot,
        undoRemote: async () => {
          await deleteGraphEdge(persistedEdge.id);
        },
        redoRemote: async () => {
          await createGraphEdge(edgePayload);
        },
      });
    }
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
      getViewportCenter: () => ({
        x: viewportSize.width > 0 ? viewportSize.width / 2 : 0,
        y: viewportSize.height > 0 ? viewportSize.height / 2 : 0,
      }),
      restartLayout,
    });

    return () => {
      setGraphShortcutRuntime(null);
    };
  }, [commitMergedTopology, restartLayout, viewportSize.height, viewportSize.width]);

  const renderedNodes = useMemo(() => {
    return nodes.map((node) => ({
      ...node,
      selected: node.id === selectedNodeId,
    }));
  }, [nodes, selectedNodeId]);

  const renderedEdges = useMemo(() => {
    return edges.map((edge) => ({
      ...edge,
      selected: edge.id === selectedEdgeId,
    }));
  }, [edges, selectedEdgeId]);

  const panCameraToCenter = useCallback(() => {
    const centerX = viewportSize.width > 0 ? viewportSize.width / 2 : 0;
    const centerY = viewportSize.height > 0 ? viewportSize.height / 2 : 0;
    setCenter(centerX, centerY, { duration: CAMERA_ANIMATION_DURATION_MS });
  }, [setCenter, viewportSize.height, viewportSize.width]);

  const handleCreateRootNode = useCallback(() => {
    void createRootNodeCommand();
  }, []);

  const handleCreateChildNode = useCallback(() => {
    if (!selectedNodeId) {
      return;
    }

    void createChildNodeCommand(selectedNodeId);
  }, [selectedNodeId]);

  const handleCreateSiblingNode = useCallback(() => {
    if (!selectedNodeId) {
      return;
    }

    void createSiblingNodeCommand(selectedNodeId);
  }, [selectedNodeId]);

  const handleDeleteSelection = useCallback(() => {
    void deleteSelectionCommand(selectedNodeId, selectedEdgeId);
  }, [selectedEdgeId, selectedNodeId]);

  const handleUndo = useCallback(() => {
    void undoGraphCommand();
  }, []);

  const handleRedo = useCallback(() => {
    void redoGraphCommand();
  }, []);

  const handleToggleCollapse = useCallback(async () => {
    if (!selectedNodeId) {
      return;
    }

    const selectedNode = nodesRef.current.find((node) => node.id === selectedNodeId);
    if (!selectedNode) {
      return;
    }

    const currentCollapsed = readNodeCollapsedField(selectedNode.data.raw);
    const nextCollapsed = !currentCollapsed;

    useGraphStore.getState().updateNodeCollapsed(selectedNodeId, nextCollapsed);
    setNodes((currentNodes) => currentNodes.map((node) => {
      if (node.id !== selectedNodeId) {
        return node;
      }

      return {
        ...node,
        data: {
          ...node.data,
          raw: {
            ...node.data.raw,
            collapsed: nextCollapsed,
          },
        },
      };
    }));
    setLayoutNodes((currentNodes) => currentNodes.map((node) => {
      if (node.id !== selectedNodeId) {
        return node;
      }

      return {
        ...node,
        data: {
          ...node.data,
          raw: {
            ...node.data.raw,
            collapsed: nextCollapsed,
          },
        },
      };
    }));

    try {
      await updateGraphNode(selectedNodeId, {
        collapsed: nextCollapsed,
      });
    } catch (error) {
      useGraphStore.getState().updateNodeCollapsed(selectedNodeId, currentCollapsed);
      setNodes((currentNodes) => currentNodes.map((node) => {
        if (node.id !== selectedNodeId) {
          return node;
        }

        return {
          ...node,
          data: {
            ...node.data,
            raw: {
              ...node.data.raw,
              collapsed: currentCollapsed,
            },
          },
        };
      }));
      setLayoutNodes((currentNodes) => currentNodes.map((node) => {
        if (node.id !== selectedNodeId) {
          return node;
        }

        return {
          ...node,
          data: {
            ...node.data,
            raw: {
              ...node.data.raw,
              collapsed: currentCollapsed,
            },
          },
        };
      }));
      const message = error instanceof GraphApiError ? error.message : 'Failed to update collapse state';
      useGraphStore.getState().setError(message);
    }
  }, [selectedNodeId, setLayoutNodes, setNodes]);

  const performFocusSwitch = useCallback(async (
    focusAnchor: FocusNodeAnchor,
    controller: AbortController,
    requestSequence: number,
    previousFocusNodeId: string | null,
  ) => {
    try {
      const nextGraph = await fetchFocusGraph(focusAnchor.id, DEFAULT_GRAPH_DEPTH, controller.signal);

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
      useGraphStore.getState().setSelectedNode(focusAnchor.id);
      startGraphSession();
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
    cancelConnection();
    setSelectedNode(node.id);
  }, [cancelConnection, setSelectedNode]);

  const handleEdgeClick = useCallback<EdgeMouseHandler>((_, edge) => {
    cancelConnection();
    setSelectedEdge(edge.id);
  }, [cancelConnection, setSelectedEdge]);

  const handleOpenSelectedNode = useCallback(() => {
    if (!selectedNodeId || selectedNodeId === focusNodeId) {
      return;
    }

    const selectedNode = nodesRef.current.find((node) => node.id === selectedNodeId);
    if (!selectedNode) {
      return;
    }

    const previousFocusNodeId = useGraphStore.getState().focusNodeId;
    const focusAnchor: FocusNodeAnchor = {
      id: selectedNode.id,
      x: selectedNode.position.x,
      y: selectedNode.position.y,
    };

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
  }, [focusNodeId, performFocusSwitch, selectedNodeId]);

  useEffect(() => {
    cancelConnection();
  }, [cancelConnection, graphSessionId]);

  const rootClassName = ['graph-canvas', className].filter(Boolean).join(' ');
  const canOpenSelectedNode = Boolean(selectedNodeId && selectedNodeId !== focusNodeId);
  const hasSelection = Boolean(selectedNodeId || selectedEdgeId);
  const canUndo = canUndoGraphCommand();
  const canRedo = canRedoGraphCommand();
  const selectedNode = useMemo(() => nodes.find((node) => node.id === selectedNodeId) ?? null, [nodes, selectedNodeId]);
  const canToggleCollapse = Boolean(selectedNodeId && hasCollapsibleChildren(selectedNodeId, layoutEdges));
  const isSelectedNodeCollapsed = selectedNode ? readNodeCollapsedField(selectedNode.data.raw) : false;
  const normalizedSearchQuery = normalizeSearchValue(searchQuery);
  const searchResults = useMemo(() => {
    if (normalizedSearchQuery.length === 0) {
      return [] as MindMapNode[];
    }

    return visibleLayoutNodes
      .filter((node) => {
        const content = normalizeSearchValue(node.data.raw.content);
        const entityType = normalizeSearchValue(node.data.entityType);
        return content.includes(normalizedSearchQuery) || entityType.includes(normalizedSearchQuery);
      })
      .slice(0, 8) as MindMapNode[];
  }, [normalizedSearchQuery, visibleLayoutNodes]);

  const handleLocateNode = useCallback((nodeId: string) => {
    const targetNode = nodesRef.current.find((node) => node.id === nodeId);
    if (!targetNode) {
      return;
    }

    setSelectedNode(nodeId);
    setCenter(targetNode.position.x, targetNode.position.y, { duration: CAMERA_ANIMATION_DURATION_MS });
  }, [setCenter, setSelectedNode]);

  const handleSearchChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(event.target.value);
  }, []);

  const handleSearchKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setSearchQuery('');
      return;
    }

    if (event.key === 'Enter' && searchResults.length > 0) {
      event.preventDefault();
      const [firstResult] = searchResults;
      if (!firstResult) {
        return;
      }

      handleLocateNode(firstResult.id);
    }
  }, [handleLocateNode, searchResults]);

  return (
    <div ref={containerRef} className={rootClassName}>
      {focusNodeId ? <div className="graph-focus-badge">焦点节点：{focusNodeId}</div> : null}
      <div className="absolute right-4 top-4 z-10 flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white/90 p-2 shadow-sm backdrop-blur">
        <button
          type="button"
          onClick={handleUndo}
          disabled={!canUndo}
          className="graph-toolbar-btn"
        >
          撤销
        </button>
        <button
          type="button"
          onClick={handleRedo}
          disabled={!canRedo}
          className="graph-toolbar-btn"
        >
          重做
        </button>
        <button
          type="button"
          onClick={handleCreateRootNode}
          className="graph-toolbar-btn"
        >
          新建根节点
        </button>
        <button
          type="button"
          onClick={handleCreateChildNode}
          disabled={!selectedNodeId}
          className="graph-toolbar-btn"
        >
          新建子节点
        </button>
        <button
          type="button"
          onClick={handleCreateSiblingNode}
          disabled={!selectedNodeId}
          className="graph-toolbar-btn"
        >
          新建同级节点
        </button>
        <button
          type="button"
          onClick={handleDeleteSelection}
          disabled={!hasSelection}
          className="graph-toolbar-btn graph-toolbar-btn--danger"
        >
          删除选中
        </button>
        <button
          type="button"
          onClick={handleToggleCollapse}
          disabled={!canToggleCollapse}
          className="graph-toolbar-btn"
        >
          {isSelectedNodeCollapsed ? '展开子树' : '折叠子树'}
        </button>
      </div>
      <div className="graph-search-panel">
        <input
          type="text"
          value={searchQuery}
          onChange={handleSearchChange}
          onKeyDown={handleSearchKeyDown}
          placeholder="搜索节点内容"
          className="graph-search-input"
        />
        {normalizedSearchQuery.length > 0 ? (
          <div className="graph-search-results">
            {searchResults.length > 0 ? searchResults.map((node) => (
              <button
                key={node.id}
                type="button"
                onClick={() => handleLocateNode(node.id)}
                className="graph-search-result"
              >
                <span className="graph-search-result__title">{node.data.raw.content}</span>
                <span className="graph-search-result__meta">{node.data.entityType}</span>
              </button>
            )) : (
              <div className="graph-search-empty">没有匹配节点</div>
            )}
          </div>
        ) : null}
      </div>
      {selectedNodeId ? (
        <div className="absolute left-4 top-14 z-10 flex items-center gap-3 rounded-full border border-slate-200 bg-white/90 px-3 py-1 text-xs font-medium text-slate-700 shadow-sm backdrop-blur">
          <span>选中节点：{selectedNodeId}</span>
          <button
            type="button"
            onClick={handleOpenSelectedNode}
            disabled={!canOpenSelectedNode || isLoading}
            className="rounded-full border border-blue-600 bg-blue-600 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:border-blue-200 disabled:bg-blue-200"
          >
            进入子图
          </button>
        </div>
      ) : null}
      {!selectedNodeId && selectedEdgeId ? (
        <div className="absolute left-4 top-14 z-10 rounded-full border border-slate-200 bg-white/90 px-3 py-1 text-xs font-medium text-slate-700 shadow-sm backdrop-blur">
          选中连线：{selectedEdgeId}
        </div>
      ) : null}
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
        nodes={renderedNodes.filter((node) => !hiddenDescendantNodeIDs.has(node.id))}
        edges={renderedEdges.filter((edge) => !hiddenDescendantNodeIDs.has(edge.source) && !hiddenDescendantNodeIDs.has(edge.target))}
        edgeTypes={edgeTypes}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={handleEdgeChanges}
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        onPaneClick={clearSelection}
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onConnect={openConnectionPopover}
        deleteKeyCode={null}
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
