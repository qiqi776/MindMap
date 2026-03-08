import { useCallback, useEffect, useState } from 'react';

import { GraphCanvas } from '@/components/GraphCanvas';
import type { GraphVO } from '@/hooks/useForceLayout';
import { useGraphStore } from '@/store/useGraphStore';

const DEFAULT_FOCUS_NODE_ID = '11111111-1111-1111-1111-111111111111';
const DEFAULT_GRAPH_DEPTH = 1;

function buildEmptyGraph(): GraphVO {
  return {
    nodes: [],
    edges: [],
  };
}

export default function App() {
  const isLoading = useGraphStore((state) => state.isLoading);
  const error = useGraphStore((state) => state.error);
  const fetchFocusGraph = useGraphStore((state) => state.fetchFocusGraph);
  const [graph, setGraph] = useState<GraphVO>(buildEmptyGraph());

  const focusNodeId = import.meta.env.VITE_FOCUS_NODE_ID ?? DEFAULT_FOCUS_NODE_ID;

  const loadGraph = useCallback(async () => {
    const nextGraph = await fetchFocusGraph(focusNodeId, DEFAULT_GRAPH_DEPTH);
    setGraph(nextGraph);
  }, [fetchFocusGraph, focusNodeId]);

  useEffect(() => {
    void loadGraph();
  }, [loadGraph]);

  if (isLoading && graph.nodes.length === 0) {
    return (
      <main className="flex h-full w-full items-center justify-center bg-slate-50 text-sm font-semibold text-slate-700">
        正在加载图谱数据…
      </main>
    );
  }

  if (error && graph.nodes.length === 0) {
    return (
      <main className="flex h-full w-full items-center justify-center bg-slate-50 px-6">
        <div className="w-full max-w-lg rounded-2xl border border-red-200 bg-white p-6 shadow-lg">
          <h1 className="text-lg font-bold text-slate-900">图谱加载失败</h1>
          <p className="mt-3 text-sm text-slate-600">{error}</p>
          <button
            type="button"
            onClick={() => {
              void loadGraph();
            }}
            className="mt-5 rounded-xl border border-blue-600 bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            重试
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="h-full w-full">
      <GraphCanvas graph={graph} />
    </main>
  );
}
