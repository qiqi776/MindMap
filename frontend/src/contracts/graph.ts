export interface GraphNodeRecord {
  id: string;
  type: string;
  content: string;
  properties?: Record<string, unknown> | null;
  created_at?: string;
  updated_at?: string;
}

export interface GraphEdgeRecord {
  id: string;
  source_id: string;
  target_id: string;
  relation_type: string;
  weight: number;
  properties?: Record<string, unknown> | null;
  created_at?: string;
  updated_at?: string;
}

export interface FocusGraphRecord {
  nodes: GraphNodeRecord[];
  edges: GraphEdgeRecord[];
}

export interface NodeDeletionSnapshotRecord {
  node: GraphNodeRecord;
  edges: GraphEdgeRecord[];
}

export interface CreateGraphNodeRequest {
  id: string;
  type: string;
  content: string;
  properties?: Record<string, unknown>;
}

export interface CreateGraphEdgeRequest {
  id: string;
  source_id: string;
  target_id: string;
  relation_type: string;
  weight?: number;
  properties?: Record<string, unknown>;
}

export interface PatchGraphNodeRequest {
  content?: string;
  properties?: Record<string, unknown>;
}

export interface UpdateGraphNodePositionRequest {
  x: number;
  y: number;
}
