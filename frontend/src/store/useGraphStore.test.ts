import { describe, expect, it, beforeEach } from 'vitest';

import type { GraphHistoryEntry } from '@/lib/graphHistory';
import { useGraphStore } from '@/store/useGraphStore';

function resetGraphStore(): void {
  useGraphStore.setState({
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
  });
}

describe('useGraphStore', () => {
  beforeEach(() => {
    resetGraphStore();
  });

  it('updates node positions and mirrors coordinates into raw properties', () => {
    useGraphStore.getState().setGraphData([
      {
        id: 'node-1',
        type: 'mind',
        position: { x: 0, y: 0 },
        data: {
          label: 'Node 1',
          entityType: 'text',
          raw: {
            id: 'node-1',
            type: 'text',
            content: 'Node 1',
            properties: { color: 'blue' },
          },
        },
      },
    ], []);

    useGraphStore.getState().updateNodePosition('node-1', 120.5, 240.25);

    const [node] = useGraphStore.getState().nodes;
    expect(node?.position).toEqual({ x: 120.5, y: 240.25 });
    expect(node?.data.raw.properties).toMatchObject({
      color: 'blue',
      x: 120.5,
      y: 240.25,
    });
  });

  it('clears history when a new graph session starts', () => {
    const historyEntry: GraphHistoryEntry = {
      label: 'update-node',
      undoSnapshot: {
        nodes: [],
        edges: [],
        selectedNodeId: null,
        selectedEdgeId: null,
        focusNodeId: null,
      },
      redoSnapshot: {
        nodes: [],
        edges: [],
        selectedNodeId: null,
        selectedEdgeId: null,
        focusNodeId: null,
      },
    };

    useGraphStore.getState().pushHistoryEntry(historyEntry);
    useGraphStore.getState().pushRedoHistoryEntry(historyEntry);

    const nextSessionID = useGraphStore.getState().startGraphSession();

    expect(nextSessionID).toBe(1);
    expect(useGraphStore.getState().graphSessionId).toBe(1);
    expect(useGraphStore.getState().undoStack).toHaveLength(0);
    expect(useGraphStore.getState().redoStack).toHaveLength(0);
  });
});
