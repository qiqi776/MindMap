import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useConnectionCreation } from '@/hooks/useConnectionCreation';
import { useGraphStore } from '@/store/useGraphStore';

const { createGraphEdgeMock } = vi.hoisted(() => ({
  createGraphEdgeMock: vi.fn(),
}));

vi.mock('@/services/api', async () => {
  const actual = await vi.importActual<typeof import('@/services/api')>('@/services/api');
  return {
    ...actual,
    createGraphEdge: createGraphEdgeMock,
  };
});

describe('useConnectionCreation', () => {
  beforeEach(() => {
    createGraphEdgeMock.mockReset();
    useGraphStore.setState({ error: null });
  });

  it('writes API failures into the shared error channel', async () => {
    createGraphEdgeMock.mockRejectedValueOnce(new Error('network failed'));

    const { result } = renderHook(() => useConnectionCreation({
      getOverlayPosition: () => ({ x: 0, y: 0 }),
      onEdgeCreated: () => undefined,
      restartLayout: () => undefined,
    }));

    act(() => {
      result.current.openConnectionPopover({
        source: 'node-a',
        target: 'node-b',
        sourceHandle: null,
        targetHandle: null,
      });
      result.current.updateRelationType('REFERENCE');
    });

    await act(async () => {
      await result.current.confirmConnection();
    });

    expect(useGraphStore.getState().error).toBe('Failed to create edge');
  });
});
