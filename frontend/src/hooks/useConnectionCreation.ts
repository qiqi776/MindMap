import { useCallback, useState } from 'react';
import type { Connection } from 'reactflow';

import {
  GraphApiError,
  createGraphEdge,
  type CreateGraphEdgeRequest,
  type GraphEdgeRecord,
} from '@/services/api';
import { useGraphStore } from '@/store/useGraphStore';

export interface OverlayPosition {
  x: number;
  y: number;
}

export interface PendingConnection {
  sourceId: string;
  targetId: string;
  sourceHandleId: string | null;
  targetHandleId: string | null;
}

export interface RelationPopoverState {
  isConnecting: boolean;
  isSubmitting: boolean;
  relationType: string;
  position: OverlayPosition;
  pendingConnection: PendingConnection | null;
}

export interface UseConnectionCreationOptions {
  getOverlayPosition: () => OverlayPosition;
  onEdgeCreated: (edge: GraphEdgeRecord) => void;
  restartLayout: (alpha?: number) => void;
  restartAlpha?: number;
}

export interface UseConnectionCreationResult {
  relationPopover: RelationPopoverState;
  openConnectionPopover: (connection: Connection) => void;
  updateRelationType: (relationType: string) => void;
  confirmConnection: () => Promise<void>;
  cancelConnection: () => void;
}

function createClientUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const randomValue = Math.floor(Math.random() * 16);
    const normalizedValue = character === 'x' ? randomValue : (randomValue & 0x3) | 0x8;
    return normalizedValue.toString(16);
  });
}

function buildInitialState(position: OverlayPosition): RelationPopoverState {
  return {
    isConnecting: false,
    isSubmitting: false,
    relationType: '',
    position,
    pendingConnection: null,
  };
}

export function useConnectionCreation({
  getOverlayPosition,
  onEdgeCreated,
  restartLayout,
  restartAlpha = 0.65,
}: UseConnectionCreationOptions): UseConnectionCreationResult {
  const [relationPopover, setRelationPopover] = useState<RelationPopoverState>(() => buildInitialState(getOverlayPosition()));

  const cancelConnection = useCallback(() => {
    setRelationPopover(buildInitialState(getOverlayPosition()));
  }, [getOverlayPosition]);

  const openConnectionPopover = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) {
      return;
    }

    useGraphStore.getState().setError(null);
    setRelationPopover({
      isConnecting: true,
      isSubmitting: false,
      relationType: '',
      position: getOverlayPosition(),
      pendingConnection: {
        sourceId: connection.source,
        targetId: connection.target,
        sourceHandleId: connection.sourceHandle ?? null,
        targetHandleId: connection.targetHandle ?? null,
      },
    });
  }, [getOverlayPosition]);

  const updateRelationType = useCallback((relationType: string) => {
    setRelationPopover((currentState) => ({
      ...currentState,
      relationType,
    }));
  }, []);

  const confirmConnection = useCallback(async () => {
    const pendingConnection = relationPopover.pendingConnection;
    const trimmedRelationType = relationPopover.relationType.trim();

    if (!pendingConnection) {
      return;
    }

    if (trimmedRelationType.length === 0) {
      useGraphStore.getState().setError('relation_type is required');
      return;
    }

    useGraphStore.getState().setLoading(true);
    useGraphStore.getState().setError(null);
    setRelationPopover((currentState) => ({
      ...currentState,
      isSubmitting: true,
      relationType: trimmedRelationType,
    }));

    const requestPayload: CreateGraphEdgeRequest = {
      id: createClientUUID(),
      source_id: pendingConnection.sourceId,
      target_id: pendingConnection.targetId,
      relation_type: trimmedRelationType,
      weight: 1,
      properties: {},
    };

    try {
      const persistedEdge = await createGraphEdge(requestPayload);
      onEdgeCreated(persistedEdge);
      restartLayout(restartAlpha);
      setRelationPopover(buildInitialState(getOverlayPosition()));
    } catch (error) {
      const message = error instanceof GraphApiError ? error.message : 'Failed to create edge';
      useGraphStore.getState().setError(message);
      setRelationPopover(buildInitialState(getOverlayPosition()));
    } finally {
      useGraphStore.getState().setLoading(false);
    }
  }, [getOverlayPosition, onEdgeCreated, relationPopover.pendingConnection, relationPopover.relationType, restartAlpha, restartLayout]);

  return {
    relationPopover,
    openConnectionPopover,
    updateRelationType,
    confirmConnection,
    cancelConnection,
  };
}
