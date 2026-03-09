import { useEffect } from 'react';

import type { SemanticMindMapEdge } from '@/components/SemanticEdge';
import type { MindMapNode } from '@/hooks/useForceLayout';
import { toFlowNode, toSemanticEdge, type EdgeLike } from '@/lib/graphViewModel';
import {
  createGraphEdge,
  createGraphNode,
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
  focusNodeId: string,
  parentNodeId: string | null,
): Promise<void> {
  const runtime = graphShortcutRuntime;
  if (!runtime) {
    return;
  }

  const currentNodes = runtime.getNodes();
  const currentEdges = runtime.getEdges();
  const focusNode = currentNodes.find((node) => node.id === focusNodeId);
  if (!focusNode) {
    return;
  }

  const previousFocusNodeId = useGraphStore.getState().focusNodeId;
  const newNodeId = createClientUUID();
  const newEdgeId = createClientUUID();
  const newNodeRecord = buildShortcutNodeRecord(
    newNodeId,
    computeInitialOffset(focusNode.position.x),
    focusNode.position.y + NODE_OFFSET_Y + Math.random() * NODE_OFFSET_JITTER,
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
  useGraphStore.getState().setFocusNode(newNodeId);
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
    useGraphStore.getState().setFocusNode(previousFocusNodeId);
    runtime.commitTopology(currentNodes, currentEdges);
    useGraphStore.getState().setError(buildErrorMessage(error, 'Failed to create node'));
  }
}

async function deleteFocusedNode(focusNodeId: string): Promise<void> {
  const runtime = graphShortcutRuntime;
  if (!runtime) {
    return;
  }

  const previousNodes = runtime.getNodes();
  const previousEdges = runtime.getEdges();
  const previousFocusNodeId = useGraphStore.getState().focusNodeId;

  useGraphStore.getState().removeNode(focusNodeId);
  runtime.commitTopology(useGraphStore.getState().nodes, useGraphStore.getState().edges);
  runtime.restartLayout(0.7);

  try {
    await deleteGraphNode(focusNodeId);
  } catch (error) {
    useGraphStore.getState().setGraphData(previousNodes, previousEdges);
    useGraphStore.getState().setFocusNode(previousFocusNodeId);
    runtime.commitTopology(previousNodes, previousEdges);
    useGraphStore.getState().setError(buildErrorMessage(error, 'Failed to delete node'));
  }
}

export function useGraphShortcuts(focusNodeId: string | null): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.repeat) {
        return;
      }

      if (isTextInputElement(event.target)) {
        return;
      }

      if (!focusNodeId) {
        return;
      }

      const runtime = graphShortcutRuntime;
      if (!runtime) {
        return;
      }

      if (event.key === 'Tab') {
        event.preventDefault();
        void createNodeFromShortcut(focusNodeId, focusNodeId);
        return;
      }

      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();

        const currentEdges = runtime.getEdges();
        let parentNodeId: string | null = null;
        for (const edge of currentEdges) {
          if (edge.target === focusNodeId) {
            parentNodeId = edge.source;
            break;
          }
        }

        void createNodeFromShortcut(focusNodeId, parentNodeId);
        return;
      }

      if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault();
        void deleteFocusedNode(focusNodeId);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [focusNodeId]);
}
