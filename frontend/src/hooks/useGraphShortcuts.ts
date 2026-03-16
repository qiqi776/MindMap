import { useEffect } from 'react';

import type { SemanticMindMapEdge } from '@/components/SemanticEdge';
import type { MindMapNode } from '@/hooks/useForceLayout';
import { toFlowNode, toSemanticEdge, type EdgeLike } from '@/lib/graphViewModel';
import {
  createGraphEdge,
  createGraphNode,
  deleteGraphEdge,
  deleteGraphNode,
  GraphApiError,
  type CreateGraphEdgeRequest,
  type CreateGraphNodeRequest,
  type GraphNodeRecord,
} from '@/services/api';
import { useGraphStore } from '@/store/useGraphStore';

interface GraphShortcutRuntime {
  getNodes: () => MindMapNode[];
  getEdges: () => SemanticMindMapEdge[];
  commitTopology: (nodes: MindMapNode[], edges: SemanticMindMapEdge[]) => void;
  restartLayout: (alpha?: number) => void;
}

let graphShortcutRuntime: GraphShortcutRuntime | null = null;

const DEFAULT_RELATION_TYPE = 'CHILD';
const DEFAULT_NODE_TYPE = 'text';
const DEFAULT_NODE_CONTENT = '新节点';
const NODE_OFFSET_X = 50;
const NODE_OFFSET_Y = 50;
const NODE_OFFSET_JITTER = 12;

export function setGraphShortcutRuntime(runtime: GraphShortcutRuntime | null): void {
  graphShortcutRuntime = runtime;
}

function createClientUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const randomValue = Math.floor(Math.random() * 16);
    const normalizedValue = character === 'x' ? randomValue : (randomValue & 0x3) | 0x8;
    return normalizedValue.toString(16);
  });
}

function isTextInputElement(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || target.hasAttribute('contenteditable')
    || target.closest('input, textarea, select, [contenteditable="true"]') !== null;
}

function buildShortcutNodeRecord(nodeID: string, x: number, y: number): GraphNodeRecord {
  return {
    id: nodeID,
    type: DEFAULT_NODE_TYPE,
    content: DEFAULT_NODE_CONTENT,
    properties: {
      x,
      y,
    },
  };
}

function buildShortcutEdgeRequest(edgeID: string, sourceID: string, targetID: string): CreateGraphEdgeRequest {
  return {
    id: edgeID,
    source_id: sourceID,
    target_id: targetID,
    relation_type: DEFAULT_RELATION_TYPE,
    weight: 1,
    properties: {},
  };
}

function buildCreateNodeRequest(node: GraphNodeRecord): CreateGraphNodeRequest {
  return {
    id: node.id,
    type: node.type,
    content: node.content,
    properties: node.properties ?? {},
  };
}

function buildErrorMessage(error: unknown, fallbackMessage: string): string {
  return error instanceof GraphApiError ? error.message : fallbackMessage;
}

function computeInitialOffset(value: number): number {
  return value + NODE_OFFSET_X + Math.random() * NODE_OFFSET_JITTER;
}

async function createNodeFromShortcut(
  selectedNodeId: string,
  parentNodeId: string | null,
): Promise<void> {
  const runtime = graphShortcutRuntime;
  if (!runtime) {
    return;
  }

  const currentNodes = runtime.getNodes();
  const currentEdges = runtime.getEdges();
  const selectedNode = currentNodes.find((node) => node.id === selectedNodeId);
  if (!selectedNode) {
    return;
  }

  const previousSelectedNodeId = useGraphStore.getState().selectedNodeId;
  const previousSelectedEdgeId = useGraphStore.getState().selectedEdgeId;
  const newNodeId = createClientUUID();
  const newEdgeId = createClientUUID();
  const newNodeRecord = buildShortcutNodeRecord(
    newNodeId,
    computeInitialOffset(selectedNode.position.x),
    selectedNode.position.y + NODE_OFFSET_Y + Math.random() * NODE_OFFSET_JITTER,
  );
  const newNode = toFlowNode(newNodeRecord, currentNodes.length, currentNodes.length + 1);
  const nextNodes = useGraphStore.getState().addNode(newNode);

  let nextEdges = currentEdges;
  let edgePayload: CreateGraphEdgeRequest | null = null;
  if (parentNodeId) {
    edgePayload = buildShortcutEdgeRequest(newEdgeId, parentNodeId, newNodeId);
    nextEdges = useGraphStore.getState().addSemanticEdge(toSemanticEdge(edgePayload as EdgeLike));
  }

  runtime.commitTopology(nextNodes, nextEdges);
  runtime.restartLayout(0.88);
  useGraphStore.getState().setSelectedNode(newNodeId);
  useGraphStore.getState().setError(null);

  try {
    await createGraphNode(buildCreateNodeRequest(newNodeRecord));

    if (edgePayload) {
      try {
        await createGraphEdge(edgePayload);
      } catch (error) {
        await deleteGraphNode(newNodeId).catch(() => undefined);
        throw error;
      }
    }
  } catch (error) {
    useGraphStore.getState().setGraphData(currentNodes, currentEdges);
    runtime.commitTopology(currentNodes, currentEdges);
    if (previousSelectedEdgeId) {
      useGraphStore.getState().setSelectedEdge(previousSelectedEdgeId);
    } else {
      useGraphStore.getState().setSelectedNode(previousSelectedNodeId);
    }
    useGraphStore.getState().setError(buildErrorMessage(error, 'Failed to create node'));
  }
}

async function deleteSelectedNode(selectedNodeId: string): Promise<void> {
  const runtime = graphShortcutRuntime;
  if (!runtime) {
    return;
  }

  const previousNodes = runtime.getNodes();
  const previousEdges = runtime.getEdges();
  const previousSelectedNodeId = useGraphStore.getState().selectedNodeId;
  const previousSelectedEdgeId = useGraphStore.getState().selectedEdgeId;
  const previousFocusNodeId = useGraphStore.getState().focusNodeId;

  useGraphStore.getState().removeNode(selectedNodeId);
  runtime.commitTopology(useGraphStore.getState().nodes, useGraphStore.getState().edges);
  runtime.restartLayout(0.7);

  try {
    await deleteGraphNode(selectedNodeId);
  } catch (error) {
    useGraphStore.getState().setGraphData(previousNodes, previousEdges);
    useGraphStore.getState().setFocusNode(previousFocusNodeId);
    if (previousSelectedEdgeId) {
      useGraphStore.getState().setSelectedEdge(previousSelectedEdgeId);
    } else {
      useGraphStore.getState().setSelectedNode(previousSelectedNodeId);
    }
    runtime.commitTopology(previousNodes, previousEdges);
    useGraphStore.getState().setError(buildErrorMessage(error, 'Failed to delete node'));
  }
}

async function deleteSelectedEdge(selectedEdgeId: string): Promise<void> {
  const runtime = graphShortcutRuntime;
  if (!runtime) {
    return;
  }

  const previousNodes = runtime.getNodes();
  const previousEdges = runtime.getEdges();
  const previousSelectedNodeId = useGraphStore.getState().selectedNodeId;
  const previousSelectedEdgeState = useGraphStore.getState().selectedEdgeId;

  useGraphStore.getState().removeEdge(selectedEdgeId);
  runtime.commitTopology(useGraphStore.getState().nodes, useGraphStore.getState().edges);
  runtime.restartLayout(0.55);

  try {
    await deleteGraphEdge(selectedEdgeId);
  } catch (error) {
    useGraphStore.getState().setGraphData(previousNodes, previousEdges);
    if (previousSelectedEdgeState) {
      useGraphStore.getState().setSelectedEdge(previousSelectedEdgeState);
    } else {
      useGraphStore.getState().setSelectedNode(previousSelectedNodeId);
    }
    runtime.commitTopology(previousNodes, previousEdges);
    useGraphStore.getState().setError(buildErrorMessage(error, 'Failed to delete edge'));
  }
}

export function useGraphShortcuts(
  selectedNodeId: string | null,
  selectedEdgeId: string | null,
): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.repeat) {
        return;
      }

      if (isTextInputElement(event.target)) {
        return;
      }

      if (!selectedNodeId && !selectedEdgeId) {
        return;
      }

      const runtime = graphShortcutRuntime;
      if (!runtime) {
        return;
      }

      if (event.key === 'Tab' && selectedNodeId) {
        event.preventDefault();
        void createNodeFromShortcut(selectedNodeId, selectedNodeId);
        return;
      }

      if (event.key === 'Enter' && !event.shiftKey && selectedNodeId) {
        event.preventDefault();

        const currentEdges = runtime.getEdges();
        let parentNodeId: string | null = null;
        for (const edge of currentEdges) {
          if (edge.target === selectedNodeId) {
            parentNodeId = edge.source;
            break;
          }
        }

        void createNodeFromShortcut(selectedNodeId, parentNodeId);
        return;
      }

      if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault();

        if (selectedEdgeId) {
          void deleteSelectedEdge(selectedEdgeId);
          return;
        }

        if (selectedNodeId) {
          void deleteSelectedNode(selectedNodeId);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedEdgeId, selectedNodeId]);
}
