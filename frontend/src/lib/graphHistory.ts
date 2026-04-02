import type { SemanticMindMapEdge } from '@/components/SemanticEdge';
import type { MindMapNode } from '@/hooks/useForceLayout';

export interface GraphHistorySnapshot {
  nodes: MindMapNode[];
  edges: SemanticMindMapEdge[];
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  focusNodeId: string | null;
}

export interface GraphHistoryEntry {
  label: string;
  undoSnapshot: GraphHistorySnapshot;
  redoSnapshot: GraphHistorySnapshot;
  undoRemote?: () => Promise<void>;
  redoRemote?: () => Promise<void>;
}
