import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type SyntheticEvent,
} from 'react';
import {
  Handle,
  Position,
  useReactFlow,
  type NodeProps,
} from 'reactflow';

import type { SemanticEdgeData } from '@/components/SemanticEdge';
import type { MindMapNodeData } from '@/hooks/useForceLayout';
import { GraphApiError, updateGraphNode } from '@/services/api';
import { useGraphStore } from '@/store/useGraphStore';

function buildNodeClass(entityType: string, isSelected: boolean): string {
  const baseClassName = {
    text: 'graph-node graph-node--text',
    person: 'graph-node graph-node--person',
    image: 'graph-node graph-node--image',
  }[entityType] ?? 'graph-node graph-node--default';

  return isSelected ? `${baseClassName} graph-node--selected` : baseClassName;
}

export function MindNode(props: NodeProps<MindMapNodeData>): ReactElement {
  const { id, data, selected } = props;
  const { setNodes } = useReactFlow<MindMapNodeData, SemanticEdgeData>();
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [editValue, setEditValue] = useState<string>(data.raw.content);
  const isSubmittingRef = useRef<boolean>(false);
  const skipBlurCommitRef = useRef<boolean>(false);

  const nodeClassName = useMemo(() => buildNodeClass(data.entityType, selected), [data.entityType, selected]);

  useEffect(() => {
    if (!isEditing) {
      setEditValue(data.raw.content);
    }
  }, [data.raw.content, isEditing]);

  const stopPropagation = useCallback((event: SyntheticEvent<Element>) => {
    event.stopPropagation();
  }, []);

  const syncCanvasNodeContent = useCallback((content: string) => {
    setNodes((currentNodes) => currentNodes.map((node) => {
      if (node.id !== id) {
        return node;
      }

      return {
        ...node,
        data: {
          ...node.data,
          label: content,
          raw: {
            ...node.data.raw,
            content,
          },
        },
      };
    }));
  }, [id, setNodes]);

  const cancelEditing = useCallback(() => {
    skipBlurCommitRef.current = true;
    setEditValue(data.raw.content);
    setIsEditing(false);
  }, [data.raw.content]);

  const commitEditing = useCallback(async () => {
    if (isSubmittingRef.current) {
      return;
    }

    isSubmittingRef.current = true;
    const previousContent = data.raw.content;
    const nextContent = editValue;

    try {
      if (nextContent === previousContent) {
        setIsEditing(false);
        return;
      }

      syncCanvasNodeContent(nextContent);
      useGraphStore.getState().updateNodeContent(id, nextContent);
      useGraphStore.getState().setError(null);
      setIsEditing(false);

      await updateGraphNode(id, {
        content: nextContent,
        properties: data.raw.properties ?? {},
      });
    } catch (error) {
      syncCanvasNodeContent(previousContent);
      useGraphStore.getState().updateNodeContent(id, previousContent);
      const message = error instanceof GraphApiError ? error.message : 'Failed to update node';
      useGraphStore.getState().setError(message);
    } finally {
      isSubmittingRef.current = false;
    }
  }, [data.raw.content, data.raw.properties, editValue, id, syncCanvasNodeContent]);

  const handleStartEditing = useCallback(() => {
    setEditValue(data.raw.content);
    setIsEditing(true);
  }, [data.raw.content]);

  const handleBlur = useCallback(() => {
    if (skipBlurCommitRef.current) {
      skipBlurCommitRef.current = false;
      return;
    }

    void commitEditing();
  }, [commitEditing]);

  const handleEditorKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    event.stopPropagation();

    if (event.key === 'Escape') {
      event.preventDefault();
      cancelEditing();
      return;
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void commitEditing();
    }
  }, [cancelEditing, commitEditing]);

  if (isEditing) {
    return (
      <div className={nodeClassName}>
        <Handle type="target" position={Position.Top} className="mind-node__handle" />
        <textarea
          value={editValue}
          autoFocus
          rows={2}
          className="mind-node__editor"
          onChange={(event) => setEditValue(event.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleEditorKeyDown}
          onKeyUp={stopPropagation}
          onKeyPress={stopPropagation}
          onClick={stopPropagation}
          onDoubleClick={stopPropagation}
        />
        <Handle type="source" position={Position.Bottom} className="mind-node__handle" />
      </div>
    );
  }

  return (
    <div className={nodeClassName} onDoubleClick={handleStartEditing}>
      <Handle type="target" position={Position.Top} className="mind-node__handle" />
      <div className="mind-node__type">{data.entityType}</div>
      <div className="mind-node__content">{data.raw.content}</div>
      <Handle type="source" position={Position.Bottom} className="mind-node__handle" />
    </div>
  );
}
