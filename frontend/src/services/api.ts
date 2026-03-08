export interface ApiEnvelope<TData> {
  code: number;
  message: string;
  data: TData;
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

async function readEnvelope<TData>(response: Response): Promise<ApiEnvelope<TData> | null> {
  const responseText = await response.text();
  if (!responseText) {
    return null;
  }

  return JSON.parse(responseText) as ApiEnvelope<TData>;
}

export async function createGraphEdge(
  payload: CreateGraphEdgeRequest,
  options: ApiRequestOptions = {},
): Promise<GraphEdgeRecord> {
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
    signal: options.signal,
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
}
