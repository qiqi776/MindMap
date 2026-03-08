export interface ApiEnvelope<TData> {
  code: number;
  message: string;
  data: TData;
}

export interface GraphNodeRecord {
  id: string;
  type: string;
  content: string;
  properties?: Record<string, unknown> | null;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
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
  deleted_at?: string | null;
}

export interface FocusGraphRecord {
  nodes: GraphNodeRecord[];
  edges: GraphEdgeRecord[];
}

export interface CreateGraphEdgeRequest {
  id: string;
  source_id: string;
  target_id: string;
  relation_type: string;
  weight?: number;
  properties?: Record<string, unknown>;
}

export interface ApiRequestOptions {
  signal?: AbortSignal;
}

export class GraphApiError extends Error {
  readonly status: number;
  readonly code: number;

  constructor(message: string, status: number, code: number) {
    super(message);
    this.name = 'GraphApiError';
    this.status = status;
    this.code = code;
  }
}

const DEFAULT_API_BASE_URL = '/api/v1';
const REQUEST_TIMEOUT_MS = 5000;

async function readEnvelope<TData>(response: Response): Promise<ApiEnvelope<TData> | null> {
  const responseText = await response.text();
  if (!responseText) {
    return null;
  }

  return JSON.parse(responseText) as ApiEnvelope<TData>;
}

function createRequestSignal(options: ApiRequestOptions): {
  signal: AbortSignal;
  cleanup: () => void;
  didTimeout: () => boolean;
} {
  const controller = new AbortController();
  let timedOut = false;
  let abortListener: (() => void) | null = null;

  const timeoutId = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  if (options.signal) {
    if (options.signal.aborted) {
      controller.abort();
    } else {
      abortListener = () => {
        controller.abort();
      };
      options.signal.addEventListener('abort', abortListener, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      window.clearTimeout(timeoutId);
      if (options.signal && abortListener) {
        options.signal.removeEventListener('abort', abortListener);
      }
    },
    didTimeout: () => timedOut,
  };
}

export async function fetchFocusGraph(
  focusNodeId: string,
  depth = 1,
  options: ApiRequestOptions = {},
): Promise<FocusGraphRecord> {
  const search = new URLSearchParams({ depth: String(depth) });
  const requestSignal = createRequestSignal(options);

  try {
    const response = await fetch(`${DEFAULT_API_BASE_URL}/graph/${focusNodeId}?${search.toString()}`, {
      method: 'GET',
      signal: requestSignal.signal,
    });

    const envelope = await readEnvelope<FocusGraphRecord | null>(response);
    if (!response.ok) {
      throw new GraphApiError(
        envelope?.message ?? 'Request failed while fetching graph',
        response.status,
        envelope?.code ?? response.status,
      );
    }

    if (!envelope?.data) {
      throw new GraphApiError('Graph response payload is empty', response.status, envelope?.code ?? response.status);
    }

    return envelope.data;
  } catch (error) {
    if (requestSignal.didTimeout()) {
      throw new GraphApiError(`Request timed out after ${REQUEST_TIMEOUT_MS}ms`, 408, 408);
    }

    throw error;
  } finally {
    requestSignal.cleanup();
  }
}

export async function createGraphEdge(
  payload: CreateGraphEdgeRequest,
  options: ApiRequestOptions = {},
): Promise<GraphEdgeRecord> {
  const requestSignal = createRequestSignal(options);

  try {
    const response = await fetch(`${DEFAULT_API_BASE_URL}/edges`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...payload,
        weight: payload.weight ?? 1,
        properties: payload.properties ?? {},
      }),
      signal: requestSignal.signal,
    });

    const envelope = await readEnvelope<GraphEdgeRecord | null>(response);
    if (!response.ok) {
      throw new GraphApiError(
        envelope?.message ?? 'Request failed while creating edge',
        response.status,
        envelope?.code ?? response.status,
      );
    }

    if (!envelope?.data) {
      throw new GraphApiError('Edge response payload is empty', response.status, envelope?.code ?? response.status);
    }

    return envelope.data;
  } catch (error) {
    if (requestSignal.didTimeout()) {
      throw new GraphApiError(`Request timed out after ${REQUEST_TIMEOUT_MS}ms`, 408, 408);
    }

    throw error;
  } finally {
    requestSignal.cleanup();
  }
}
