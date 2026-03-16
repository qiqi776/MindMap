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
  getViewportCenter: () => { x: number; y: number };
}

interface GraphHistorySnapshot {
  nodes: MindMapNode[];
  edges: SemanticMindMapEdge[];
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  focusNodeId: string | null;
}

interface GraphHistoryEntry {
  label: string;
  undoSnapshot: GraphHistorySnapshot;
  redoSnapshot: GraphHistorySnapshot;
  undoRemote?: () => Promise<void>;
  redoRemote?: () => Promise<void>;
}

let graphShortcutRuntime: GraphShortcutRuntime | null = null;
const undoStack: GraphHistoryEntry[] = [];
const redoStack: GraphHistoryEntry[] = [];

const DEFAULT_RELATION_TYPE = 'CHILD';
const DEFAULT_NODE_TYPE = 'text';
const DEFAULT_NODE_CONTENT = '新节点';
const NODE_OFFSET_X = 50;
const NODE_OFFSET_Y = 50;
const NODE_OFFSET_JITTER = 12;

export function setGraphShortcutRuntime(runtime: GraphShortcutRuntime | null): void {
  graphShortcutRuntime = runtime;
}

function cloneHistorySnapshot(snapshot: GraphHistorySnapshot): GraphHistorySnapshot {
  return structuredClone(snapshot);
}

export function buildGraphHistorySnapshot(
  nodes: MindMapNode[],
  edges: SemanticMindMapEdge[],
  selectedNodeId: string | null,
  selectedEdgeId: string | null,
  focusNodeId: string | null,
): GraphHistorySnapshot {
  return cloneHistorySnapshot({
    nodes,
    edges,
    selectedNodeId,
    selectedEdgeId,
    focusNodeId,
  });
}

export function captureGraphHistorySnapshot(): GraphHistorySnapshot | null {
  const runtime = graphShortcutRuntime;
  if (!runtime) {
    return null;
  }

  const store = useGraphStore.getState();
  return buildGraphHistorySnapshot(
    runtime.getNodes(),
    runtime.getEdges(),
    store.selectedNodeId,
    store.selectedEdgeId,
    store.focusNodeId,
  );
}

function applyGraphHistorySnapshot(snapshot: GraphHistorySnapshot): void {
  const runtime = graphShortcutRuntime;
  if (!runtime) {
    return;
  }

  const nextSnapshot = cloneHistorySnapshot(snapshot);
  runtime.commitTopology(nextSnapshot.nodes, nextSnapshot.edges);
  useGraphStore.getState().setFocusNode(nextSnapshot.focusNodeId);

  if (nextSnapshot.selectedEdgeId) {
    useGraphStore.getState().setSelectedEdge(nextSnapshot.selectedEdgeId);
  } else if (nextSnapshot.selectedNodeId) {
    useGraphStore.getState().setSelectedNode(nextSnapshot.selectedNodeId);
  } else {
    useGraphStore.getState().clearSelection();
  }

  runtime.restartLayout(0.65);
  useGraphStore.getState().setError(null);
}

export function pushGraphHistoryEntry(entry: GraphHistoryEntry): void {
  undoStack.push(entry);
  redoStack.length = 0;
}

export function canUndoGraphCommand(): boolean {
  return undoStack.length > 0;
}

export function canRedoGraphCommand(): boolean {
  return redoStack.length > 0;
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

function buildNodeRecordFromMindNode(node: MindMapNode): GraphNodeRecord {
  return {
    ...node.data.raw,
    content: node.data.raw.content,
    properties: {
      ...(node.data.raw.properties ?? {}),
      x: node.position.x,
      y: node.position.y,
    },
  };
}

function buildEdgeRequestFromMindMapEdge(edge: SemanticMindMapEdge): CreateGraphEdgeRequest {
  const rawEdge = edge.data?.raw;

  if (!rawEdge) {
    return {
      id: edge.id,
      source_id: edge.source,
      target_id: edge.target,
      relation_type: DEFAULT_RELATION_TYPE,
      weight: 1,
      properties: {},
    };
  }

  return {
    id: rawEdge.id,
    source_id: rawEdge.source_id,
    target_id: rawEdge.target_id,
    relation_type: rawEdge.relation_type,
    weight: rawEdge.weight,
    properties: rawEdge.properties ?? {},
  };
}

function computeInitialOffset(value: number): number {
  return value + NODE_OFFSET_X + Math.random() * NODE_OFFSET_JITTER;
}

function computeRootPosition(runtime: GraphShortcutRuntime): { x: number; y: number } {
  const viewportCenter = runtime.getViewportCenter();
  return {
    x: viewportCenter.x + Math.random() * NODE_OFFSET_JITTER,
    y: viewportCenter.y + Math.random() * NODE_OFFSET_JITTER,
  };
}

async function createNodeCommand(
  position: { x: number; y: number },
  parentNodeId: string | null,
): Promise<void> {
  const runtime = graphShortcutRuntime;
  if (!runtime) {
    return;
  }

  const currentNodes = runtime.getNodes();
  const currentEdges = runtime.getEdges();
  const beforeSnapshot = captureGraphHistorySnapshot();
  const previousSelectedNodeId = useGraphStore.getState().selectedNodeId;
  const previousSelectedEdgeId = useGraphStore.getState().selectedEdgeId;
  const currentFocusNodeId = useGraphStore.getState().focusNodeId;
  const newNodeId = createClientUUID();
  const newEdgeId = createClientUUID();
  const newNodeRecord = buildShortcutNodeRecord(
    newNodeId,
    position.x,
    position.y,
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
  const afterSnapshot = buildGraphHistorySnapshot(
    nextNodes,
    nextEdges,
    newNodeId,
    null,
    currentFocusNodeId,
  );

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

    if (beforeSnapshot) {
      pushGraphHistoryEntry({
        label: 'create-node',
        undoSnapshot: beforeSnapshot,
        redoSnapshot: afterSnapshot,
        undoRemote: async () => {
          await deleteGraphNode(newNodeId);
        },
        redoRemote: async () => {
          await createGraphNode(buildCreateNodeRequest(newNodeRecord));
          if (edgePayload) {
            await createGraphEdge(edgePayload);
          }
        },
      });
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

export async function createChildNodeCommand(selectedNodeId: string): Promise<void> {
  const runtime = graphShortcutRuntime;
  if (!runtime) {
    return;
  }

  const selectedNode = runtime.getNodes().find((node) => node.id === selectedNodeId);
  if (!selectedNode) {
    return;
  }

  await createNodeCommand({
    x: computeInitialOffset(selectedNode.position.x),
    y: selectedNode.position.y + NODE_OFFSET_Y + Math.random() * NODE_OFFSET_JITTER,
  }, selectedNodeId);
}

export async function createSiblingNodeCommand(selectedNodeId: string): Promise<void> {
  const runtime = graphShortcutRuntime;
  if (!runtime) {
    return;
  }

  const selectedNode = runtime.getNodes().find((node) => node.id === selectedNodeId);
  if (!selectedNode) {
    return;
  }

  const currentEdges = runtime.getEdges();
  let parentNodeId: string | null = null;
  for (const edge of currentEdges) {
    if (edge.target === selectedNodeId) {
      parentNodeId = edge.source;
      break;
    }
  }

  await createNodeCommand({
    x: computeInitialOffset(selectedNode.position.x),
    y: selectedNode.position.y + NODE_OFFSET_Y + Math.random() * NODE_OFFSET_JITTER,
  }, parentNodeId);
}

export async function createRootNodeCommand(): Promise<void> {
  const runtime = graphShortcutRuntime;
  if (!runtime) {
    return;
  }

  await createNodeCommand(computeRootPosition(runtime), null);
}

async function deleteSelectedNode(selectedNodeId: string): Promise<void> {
  const runtime = graphShortcutRuntime;
  if (!runtime) {
    return;
  }

  const previousNodes = runtime.getNodes();
  const previousEdges = runtime.getEdges();
  const beforeSnapshot = captureGraphHistorySnapshot();
  const previousSelectedNodeId = useGraphStore.getState().selectedNodeId;
  const previousSelectedEdgeId = useGraphStore.getState().selectedEdgeId;
  const previousFocusNodeId = useGraphStore.getState().focusNodeId;
  const deletedNode = previousNodes.find((node) => node.id === selectedNodeId);
  const deletedEdges = previousEdges.filter((edge) => edge.source === selectedNodeId || edge.target === selectedNodeId);

  useGraphStore.getState().removeNode(selectedNodeId);
  runtime.commitTopology(useGraphStore.getState().nodes, useGraphStore.getState().edges);
  runtime.restartLayout(0.7);
  const afterSnapshot = captureGraphHistorySnapshot();

  try {
    await deleteGraphNode(selectedNodeId);

    if (beforeSnapshot && afterSnapshot && deletedNode) {
      pushGraphHistoryEntry({
        label: 'delete-node',
        undoSnapshot: beforeSnapshot,
        redoSnapshot: afterSnapshot,
        undoRemote: async () => {
          await createGraphNode(buildCreateNodeRequest(buildNodeRecordFromMindNode(deletedNode)));
          for (const edge of deletedEdges) {
            await createGraphEdge(buildEdgeRequestFromMindMapEdge(edge));
          }
        },
        redoRemote: async () => {
          await deleteGraphNode(selectedNodeId);
        },
      });
    }
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
  const beforeSnapshot = captureGraphHistorySnapshot();
  const previousSelectedNodeId = useGraphStore.getState().selectedNodeId;
  const previousSelectedEdgeState = useGraphStore.getState().selectedEdgeId;
  const deletedEdge = previousEdges.find((edge) => edge.id === selectedEdgeId);

  useGraphStore.getState().removeEdge(selectedEdgeId);
  runtime.commitTopology(useGraphStore.getState().nodes, useGraphStore.getState().edges);
  runtime.restartLayout(0.55);
  const afterSnapshot = captureGraphHistorySnapshot();

  try {
    await deleteGraphEdge(selectedEdgeId);

    if (beforeSnapshot && afterSnapshot && deletedEdge) {
      const edgeRequest = buildEdgeRequestFromMindMapEdge(deletedEdge);
      pushGraphHistoryEntry({
        label: 'delete-edge',
        undoSnapshot: beforeSnapshot,
        redoSnapshot: afterSnapshot,
        undoRemote: async () => {
          await createGraphEdge(edgeRequest);
        },
        redoRemote: async () => {
          await deleteGraphEdge(selectedEdgeId);
        },
      });
    }
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

export async function deleteSelectionCommand(
  selectedNodeId: string | null,
  selectedEdgeId: string | null,
): Promise<void> {
  if (selectedEdgeId) {
    await deleteSelectedEdge(selectedEdgeId);
    return;
  }

  if (selectedNodeId) {
    await deleteSelectedNode(selectedNodeId);
  }
}

export async function undoGraphCommand(): Promise<void> {
  const entry = undoStack.pop();
  if (!entry) {
    return;
  }

  applyGraphHistorySnapshot(entry.undoSnapshot);

  try {
    if (entry.undoRemote) {
      await entry.undoRemote();
    }
    redoStack.push(entry);
  } catch (error) {
    applyGraphHistorySnapshot(entry.redoSnapshot);
    undoStack.push(entry);
    useGraphStore.getState().setError(buildErrorMessage(error, 'Failed to undo graph command'));
  }
}

export async function redoGraphCommand(): Promise<void> {
  const entry = redoStack.pop();
  if (!entry) {
    return;
  }

  applyGraphHistorySnapshot(entry.redoSnapshot);

  try {
    if (entry.redoRemote) {
      await entry.redoRemote();
    }
    undoStack.push(entry);
  } catch (error) {
    applyGraphHistorySnapshot(entry.undoSnapshot);
    redoStack.push(entry);
    useGraphStore.getState().setError(buildErrorMessage(error, 'Failed to redo graph command'));
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

      const runtime = graphShortcutRuntime;
      if (!runtime) {
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();

        if (event.shiftKey) {
          void redoGraphCommand();
        } else {
          void undoGraphCommand();
        }
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        void redoGraphCommand();
        return;
      }

      if (!selectedNodeId && !selectedEdgeId) {
        return;
      }

      if (event.key === 'Tab' && selectedNodeId) {
        event.preventDefault();
        void createChildNodeCommand(selectedNodeId);
        return;
      }

      if (event.key === 'Enter' && !event.shiftKey && selectedNodeId) {
        event.preventDefault();
        void createSiblingNodeCommand(selectedNodeId);
        return;
      }

      if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault();
        void deleteSelectionCommand(selectedNodeId, selectedEdgeId);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedEdgeId, selectedNodeId]);
}
