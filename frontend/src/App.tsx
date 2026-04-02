import { useCallback, useEffect, useRef } from 'react';

import { GraphCanvas } from '@/components/GraphCanvas';
import { buildFlowTopology } from '@/lib/graphViewModel';
import { isRequestAbortError } from '@/services/api';
import { useGraphStore } from '@/store/useGraphStore';

const DEFAULT_FOCUS_NODE_ID = '11111111-1111-1111-1111-111111111111';
const DEFAULT_GRAPH_DEPTH = 1;

export default function App() {
  const isLoading = useGraphStore((state) => state.isLoading);
  const error = useGraphStore((state) => state.error);
  const nodes = useGraphStore((state) => state.nodes);
  const fetchFocusGraph = useGraphStore((state) => state.fetchFocusGraph);
  const setGraphData = useGraphStore((state) => state.setGraphData);
  const setError = useGraphStore((state) => state.setError);
  const setFocusNode = useGraphStore((state) => state.setFocusNode);
  const setSelectedNode = useGraphStore((state) => state.setSelectedNode);
  const startGraphSession = useGraphStore((state) => state.startGraphSession);
  const requestControllerRef = useRef<AbortController | null>(null);

  const focusNodeId = import.meta.env.VITE_FOCUS_NODE_ID ?? DEFAULT_FOCUS_NODE_ID;

  const loadGraph = useCallback(async () => {
    requestControllerRef.current?.abort();

    const controller = new AbortController();
    requestControllerRef.current = controller;

    try {
      const nextGraph = await fetchFocusGraph(focusNodeId, DEFAULT_GRAPH_DEPTH, controller.signal);
      const nextTopology = buildFlowTopology(nextGraph);
      setGraphData(nextTopology.nodes, nextTopology.edges);
      setFocusNode(focusNodeId);
      setSelectedNode(focusNodeId);
      startGraphSession();
    } catch (error) {
      if (isRequestAbortError(error)) {
        return;
      }
    } finally {
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null;
      }
    }
  }, [fetchFocusGraph, focusNodeId]);

  useEffect(() => {
    void loadGraph();

    return () => {
      requestControllerRef.current?.abort();
    };
  }, [loadGraph]);

  if (isLoading && nodes.length === 0) {
    return (
      <main className="flex h-full w-full items-center justify-center bg-slate-50 text-sm font-semibold text-slate-700">
        正在加载图谱数据…
      </main>
    );
  }

  if (error) {
    return (
      <main className="flex h-full w-full items-center justify-center bg-slate-50 px-6">
        <div className="w-full max-w-lg rounded-2xl border border-red-200 bg-white p-6 shadow-lg">
          <h1 className="text-lg font-bold text-slate-900">服务不可用</h1>
          <p className="mt-3 text-sm text-slate-600">{error}</p>
          <button
            type="button"
            onClick={() => {
              setError(null);
              void loadGraph();
            }}
            className="mt-5 rounded-xl border border-blue-600 bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            刷新
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="h-full w-full">
      <GraphCanvas />
    </main>
  );
}
