import type { components } from '@/generated/openapi';

type PersistedGraphNode = components['schemas']['Node'];
type PersistedGraphEdge = components['schemas']['Edge'];

export type GraphNodeRecord = Omit<PersistedGraphNode, 'created_at' | 'updated_at' | 'properties'> & Partial<Pick<PersistedGraphNode, 'created_at' | 'updated_at' | 'properties'>>;
export type GraphEdgeRecord = Omit<PersistedGraphEdge, 'created_at' | 'updated_at' | 'properties'> & Partial<Pick<PersistedGraphEdge, 'created_at' | 'updated_at' | 'properties'>>;
export interface FocusGraphRecord {
  nodes: GraphNodeRecord[];
  edges: GraphEdgeRecord[];
}
export interface NodeDeletionSnapshotRecord {
  node: GraphNodeRecord;
  edges: GraphEdgeRecord[];
}
export type CreateGraphNodeRequest = components['schemas']['CreateNodeRequest'];
export type CreateGraphEdgeRequest = components['schemas']['CreateEdgeRequest'];
export type PatchGraphNodeRequest = components['schemas']['PatchNodeRequest'];
export type UpdateGraphNodePositionRequest = components['schemas']['UpdateNodePositionRequest'];
