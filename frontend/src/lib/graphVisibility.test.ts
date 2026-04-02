import { describe, expect, it } from 'vitest';

import { collectHiddenDescendantNodeIDs, hasCollapsibleChildren } from '@/lib/graphVisibility';

describe('graphVisibility', () => {
  it('treats hierarchical relation registry entries as collapsible edges', () => {
    const edges = [
      {
        id: 'edge-1',
        source: 'root',
        target: 'child',
        data: {
          relationType: 'PARENT_CHILD',
          weight: 1,
          raw: {
            id: 'edge-1',
            source_id: 'root',
            target_id: 'child',
            relation_type: 'PARENT_CHILD',
            weight: 1,
            properties: {},
          },
        },
      },
      {
        id: 'edge-2',
        source: 'root',
        target: 'reference',
        data: {
          relationType: 'REFERENCE',
          weight: 1,
          raw: {
            id: 'edge-2',
            source_id: 'root',
            target_id: 'reference',
            relation_type: 'REFERENCE',
            weight: 1,
            properties: {},
          },
        },
      },
    ];

    expect(hasCollapsibleChildren('root', edges as never)).toBe(true);
  });

  it('hides hierarchical descendants but keeps reference edges visible', () => {
    const nodes = [
      {
        id: 'root',
        data: {
          raw: {
            properties: {
              collapsed: true,
            },
          },
        },
      },
      {
        id: 'child',
        data: {
          raw: {
            properties: {},
          },
        },
      },
      {
        id: 'reference',
        data: {
          raw: {
            properties: {},
          },
        },
      },
    ];

    const edges = [
      {
        id: 'edge-1',
        source: 'root',
        target: 'child',
        data: {
          relationType: 'PARENT_CHILD',
          raw: {
            relation_type: 'PARENT_CHILD',
          },
        },
      },
      {
        id: 'edge-2',
        source: 'root',
        target: 'reference',
        data: {
          relationType: 'REFERENCE',
          raw: {
            relation_type: 'REFERENCE',
          },
        },
      },
    ];

    expect(collectHiddenDescendantNodeIDs(nodes as never, edges as never)).toEqual(new Set(['child']));
  });
});
