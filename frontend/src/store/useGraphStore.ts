import { create } from 'zustand';

import type { SemanticMindMapEdge } from '@/components/SemanticEdge';
import type { GraphVO, MindMapNode } from '@/hooks/useForceLayout';
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
  focusNodeId: string | null;
  isLoading: boolean;
  error: string | null;
}

export interface GraphStoreActions {
  setGraphData: (nodes: MindMapNode[], edges: SemanticMindMapEdge[]) => void;
  updateNodePosition: (nodeId: string, x: number, y: number) => void;
  updateNodePositions: (updates: NodePositionUpdate[]) => void;
  addSemanticEdge: (edge: SemanticMindMapEdge) => SemanticMindMapEdge[];
  removeNode: (nodeId: string) => void;
  removeEdge: (edgeId: string) => void;
  updateNodeContent: (nodeId: string, content: string) => void;
  setFocusNode: (nodeId: string | null) => void;
  setLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;
  fetchFocusGraph: (focusNodeId: string, depth?: number, signal?: AbortSignal) => Promise<GraphVO>;
}

export type GraphStore = GraphStoreState & GraphStoreActions;

const POSITION_EPSILON = 0.5;

export const useGraphStore = create<GraphStore>((set) => ({
  nodes: [],
  edges: [],
  focusNodeId: null,
  isLoading: false,
  error: null,

  setGraphData: (nodes, edges) => {
    set({
      nodes,
      edges: enrichParallelEdgeData(edges),
    });
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
        focusNodeId: state.focusNodeId === nodeId ? null : state.focusNodeId,
      };
    });
  },

  removeEdge: (edgeId) => {
    set((state) => ({
      edges: enrichParallelEdgeData(state.edges.filter((edge) => edge.id !== edgeId)),
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

  setFocusNode: (nodeId) => {
    set({ focusNodeId: nodeId });
  },

  setLoading: (isLoading) => {
    set({ isLoading });
  },

  setError: (error) => {
    set({ error });
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
