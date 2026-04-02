import { create } from 'zustand';

import type { SemanticMindMapEdge } from '@/components/SemanticEdge';
import type { GraphVO, MindMapNode } from '@/hooks/useForceLayout';
import type { GraphHistoryEntry } from '@/lib/graphHistory';
import { sanitizeNodeProperties } from '@/lib/nodeFields';
import { enrichParallelEdgeData } from '@/lib/graphViewModel';
import { fetchFocusGraph, GraphApiError, isRequestAbortError } from '@/services/api';

export interface NodePositionUpdate {
  nodeId: string;
  x: number;
  y: number;
}

export interface GraphStoreState {
  nodes: MindMapNode[];
  edges: SemanticMindMapEdge[];
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  focusNodeId: string | null;
  isLoading: boolean;
  error: string | null;
  graphSessionId: number;
  undoStack: GraphHistoryEntry[];
  redoStack: GraphHistoryEntry[];
}

export interface GraphStoreActions {
  setGraphData: (nodes: MindMapNode[], edges: SemanticMindMapEdge[]) => void;
  addNode: (node: MindMapNode) => MindMapNode[];
  updateNodePosition: (nodeId: string, x: number, y: number) => void;
  updateNodePositions: (updates: NodePositionUpdate[]) => void;
  addSemanticEdge: (edge: SemanticMindMapEdge) => SemanticMindMapEdge[];
  removeNode: (nodeId: string) => void;
  removeEdge: (edgeId: string) => void;
  updateNodeContent: (nodeId: string, content: string) => void;
  updateNodeCollapsed: (nodeId: string, collapsed: boolean) => void;
  updateNodeProperties: (nodeId: string, properties: Record<string, unknown>) => void;
  setSelectedNode: (nodeId: string | null) => void;
  setSelectedEdge: (edgeId: string | null) => void;
  clearSelection: () => void;
  setFocusNode: (nodeId: string | null) => void;
  setLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;
  startGraphSession: () => number;
  clearHistory: () => void;
  pushHistoryEntry: (entry: GraphHistoryEntry) => void;
  popUndoHistoryEntry: () => GraphHistoryEntry | undefined;
  pushRedoHistoryEntry: (entry: GraphHistoryEntry) => void;
  popRedoHistoryEntry: () => GraphHistoryEntry | undefined;
  restoreUndoHistoryEntry: (entry: GraphHistoryEntry) => void;
  restoreRedoHistoryEntry: (entry: GraphHistoryEntry) => void;
  fetchFocusGraph: (focusNodeId: string, depth?: number, signal?: AbortSignal) => Promise<GraphVO>;
}

export type GraphStore = GraphStoreState & GraphStoreActions;

const POSITION_EPSILON = 0.5;

export const useGraphStore = create<GraphStore>((set) => ({
  nodes: [],
  edges: [],
  selectedNodeId: null,
  selectedEdgeId: null,
  focusNodeId: null,
  isLoading: false,
  error: null,
  graphSessionId: 0,
  undoStack: [],
  redoStack: [],

  setGraphData: (nodes, edges) => {
    set((state) => {
      const nextEdges = enrichParallelEdgeData(edges);
      const nodeIDSet = new Set(nodes.map((node) => node.id));
      const edgeIDSet = new Set(nextEdges.map((edge) => edge.id));

      return {
        nodes,
        edges: nextEdges,
        selectedNodeId: state.selectedNodeId && nodeIDSet.has(state.selectedNodeId) ? state.selectedNodeId : null,
        selectedEdgeId: state.selectedEdgeId && edgeIDSet.has(state.selectedEdgeId) ? state.selectedEdgeId : null,
      };
    });
  },

  addNode: (node) => {
    let nextNodes: MindMapNode[] = [];

    set((state) => {
      const deduplicatedNodes = state.nodes.filter((currentNode) => currentNode.id !== node.id);
      nextNodes = [...deduplicatedNodes, node];

      return {
        nodes: nextNodes,
      };
    });

    return nextNodes;
  },

  updateNodePosition: (nodeId, x, y) => {
    set((state) => {
      let hasChanged = false;

      const nextNodes = state.nodes.map((node) => {
        if (node.id !== nodeId) {
          return node;
        }

        if (Math.abs(node.position.x - x) < POSITION_EPSILON && Math.abs(node.position.y - y) < POSITION_EPSILON) {
          return node;
        }

        hasChanged = true;
        return {
          ...node,
          data: {
            ...node.data,
            raw: {
              ...node.data.raw,
              x,
              y,
            },
          },
          position: { x, y },
        };
      });

      return hasChanged ? { nodes: nextNodes } : state;
    });
  },

  updateNodePositions: (updates) => {
    if (updates.length === 0) {
      return;
    }

    set((state) => {
      const updateMap = new Map(updates.map((update) => [update.nodeId, update]));
      let hasChanged = false;

      const nextNodes = state.nodes.map((node) => {
        const nextPosition = updateMap.get(node.id);
        if (!nextPosition) {
          return node;
        }

        if (
          Math.abs(node.position.x - nextPosition.x) < POSITION_EPSILON
          && Math.abs(node.position.y - nextPosition.y) < POSITION_EPSILON
        ) {
          return node;
        }

        hasChanged = true;
        return {
          ...node,
          data: {
            ...node.data,
            raw: {
              ...node.data.raw,
              x: nextPosition.x,
              y: nextPosition.y,
            },
          },
          position: { x: nextPosition.x, y: nextPosition.y },
        };
      });

      return hasChanged ? { nodes: nextNodes } : state;
    });
  },

  addSemanticEdge: (edge) => {
    let nextEdges: SemanticMindMapEdge[] = [];

    set((state) => {
      const deduplicatedEdges = state.edges.filter((currentEdge) => currentEdge.id !== edge.id);
      nextEdges = enrichParallelEdgeData([...deduplicatedEdges, edge]);

      return {
        edges: nextEdges,
      };
    });

    return nextEdges;
  },

  removeNode: (nodeId) => {
    set((state) => {
      const nextNodes = state.nodes.filter((node) => node.id !== nodeId);

      // Filter incident edges to prevent dangling references and preserve
      // referential integrity in the in-memory topology.
      const nextEdges = enrichParallelEdgeData(
        state.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
      );

      return {
        nodes: nextNodes,
        edges: nextEdges,
        selectedNodeId: state.selectedNodeId === nodeId ? null : state.selectedNodeId,
        selectedEdgeId: state.selectedEdgeId && nextEdges.some((edge) => edge.id === state.selectedEdgeId) ? state.selectedEdgeId : null,
        focusNodeId: state.focusNodeId === nodeId ? null : state.focusNodeId,
      };
    });
  },

  removeEdge: (edgeId) => {
    set((state) => ({
      edges: enrichParallelEdgeData(state.edges.filter((edge) => edge.id !== edgeId)),
      selectedEdgeId: state.selectedEdgeId === edgeId ? null : state.selectedEdgeId,
    }));
  },

  updateNodeContent: (nodeId, content) => {
    set((state) => ({
      nodes: state.nodes.map((node) => {
        if (node.id !== nodeId) {
          return node;
        }

        if (node.data.label === content && node.data.raw.content === content) {
          return node;
        }

        return {
          ...node,
          data: {
            ...node.data,
            label: content,
            raw: {
              ...node.data.raw,
              content,
            },
          },
        };
      }),
    }));
  },

  updateNodeCollapsed: (nodeId, collapsed) => {
    set((state) => ({
      nodes: state.nodes.map((node) => {
        if (node.id !== nodeId) {
          return node;
        }

        if (node.data.raw.collapsed === collapsed) {
          return node;
        }

        return {
          ...node,
          data: {
            ...node.data,
            raw: {
              ...node.data.raw,
              collapsed,
            },
          },
        };
      }),
    }));
  },

  updateNodeProperties: (nodeId, properties) => {
    set((state) => ({
      nodes: state.nodes.map((node) => {
        if (node.id !== nodeId) {
          return node;
        }

        return {
          ...node,
          data: {
            ...node.data,
            raw: {
              ...node.data.raw,
              properties: sanitizeNodeProperties(properties),
            },
          },
        };
      }),
    }));
  },

  setSelectedNode: (nodeId) => {
    set({
      selectedNodeId: nodeId,
      selectedEdgeId: null,
    });
  },

  setSelectedEdge: (edgeId) => {
    set({
      selectedNodeId: null,
      selectedEdgeId: edgeId,
    });
  },

  clearSelection: () => {
    set({
      selectedNodeId: null,
      selectedEdgeId: null,
    });
  },

  setFocusNode: (nodeId) => {
    set({ focusNodeId: nodeId });
  },

  setLoading: (isLoading) => {
    set({ isLoading });
  },

  setError: (error) => {
    set({ error });
  },

  startGraphSession: () => {
    let nextSessionID = 0;

    set((state) => {
      nextSessionID = state.graphSessionId + 1;
      return {
        graphSessionId: nextSessionID,
        undoStack: [],
        redoStack: [],
      };
    });

    return nextSessionID;
  },

  clearHistory: () => {
    set({
      undoStack: [],
      redoStack: [],
    });
  },

  pushHistoryEntry: (entry) => {
    set((state) => ({
      undoStack: [...state.undoStack, entry],
      redoStack: [],
    }));
  },

  popUndoHistoryEntry: () => {
    let entry: GraphHistoryEntry | undefined;

    set((state) => {
      entry = state.undoStack[state.undoStack.length - 1];
      if (!entry) {
        return state;
      }

      return {
        undoStack: state.undoStack.slice(0, -1),
      };
    });

    return entry;
  },

  pushRedoHistoryEntry: (entry) => {
    set((state) => ({
      redoStack: [...state.redoStack, entry],
    }));
  },

  popRedoHistoryEntry: () => {
    let entry: GraphHistoryEntry | undefined;

    set((state) => {
      entry = state.redoStack[state.redoStack.length - 1];
      if (!entry) {
        return state;
      }

      return {
        redoStack: state.redoStack.slice(0, -1),
      };
    });

    return entry;
  },

  restoreUndoHistoryEntry: (entry) => {
    set((state) => ({
      undoStack: [...state.undoStack, entry],
    }));
  },

  restoreRedoHistoryEntry: (entry) => {
    set((state) => ({
      redoStack: [...state.redoStack, entry],
    }));
  },

  fetchFocusGraph: async (focusNodeId, depth = 1, signal) => {
    set({ isLoading: true, error: null, focusNodeId });

    try {
      const graph = await fetchFocusGraph(focusNodeId, depth, { signal });
      set({
        isLoading: false,
        error: null,
        focusNodeId,
      });
      return graph;
    } catch (error) {
      if (isRequestAbortError(error)) {
        set({ isLoading: false });
        throw error;
      }

      const message = error instanceof GraphApiError ? error.message : 'Failed to fetch focus graph';
      set({ isLoading: false, error: message });
      throw error;
    }
  },
}));
