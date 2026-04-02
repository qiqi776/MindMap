import relationDefinitions from '../../../shared/relation_types.json';

export interface RelationDefinition {
  code: string;
  label: string;
  hierarchical: boolean;
  acyclic: boolean;
  allows_multi_parent: boolean;
  can_collapse_children: boolean;
}

export const DEFAULT_HIERARCHY_RELATION_TYPE = 'PARENT_CHILD';

const registry = new Map<string, RelationDefinition>(
  (relationDefinitions as RelationDefinition[]).map((definition) => [definition.code.trim().toUpperCase(), definition]),
);

export function getRelationDefinition(relationType: string): RelationDefinition | null {
  return registry.get(relationType.trim().toUpperCase()) ?? null;
}

export function isHierarchicalRelationType(relationType: string): boolean {
  return getRelationDefinition(relationType)?.hierarchical === true;
}

export function canCollapseChildrenForRelation(relationType: string): boolean {
  return getRelationDefinition(relationType)?.can_collapse_children === true;
}
