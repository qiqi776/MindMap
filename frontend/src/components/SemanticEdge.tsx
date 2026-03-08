import { memo, type ReactElement } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type Edge,
  type EdgeProps,
} from '@xyflow/react';

import type { MindMapEdgeData } from '../hooks/useForceLayout';

export interface SemanticEdgeData extends MindMapEdgeData {
  parallelCount?: number;
  parallelIndex?: number;
  parallelSpacing?: number;
}

export type SemanticMindMapEdge = Edge<SemanticEdgeData>;

const DEFAULT_PARALLEL_SPACING = 24;
const LABEL_WIDTH = 160;
const LABEL_HEIGHT = 32;

function compareNodeIDs(leftNodeID: string, rightNodeID: string): number {
  if (leftNodeID === rightNodeID) {
    return 0;
  }

  return leftNodeID < rightNodeID ? -1 : 1;
}

export const SemanticEdge = memo(function SemanticEdge(props: EdgeProps<SemanticMindMapEdge>): ReactElement {
  const {
    id,
    source,
    target,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    markerEnd,
    data,
    style,
  } = props;

  const parallelIndex = data?.parallelIndex ?? 0;
  const parallelCount = data?.parallelCount ?? 1;
  const parallelSpacing = data?.parallelSpacing ?? DEFAULT_PARALLEL_SPACING;

  let shiftedSourceX = sourceX;
  let shiftedSourceY = sourceY;
  let shiftedTargetX = targetX;
  let shiftedTargetY = targetY;

  if (parallelCount > 1 && parallelIndex !== 0) {
    // 路径偏移量通过节点对的法向量计算。先基于稳定的节点对顺序确定一条规范向量，
    // 再将每条边的中心化索引乘以固定间距，投影到该规范向量的单位法向量上。
    // 这样在 A->B 与 B->A 同时存在时，两条边会被分布到共享线段的两侧，而不是重叠。
    const useCanonicalSourceAsRenderedSource = compareNodeIDs(source, target) <= 0;
    const canonicalSourceX = useCanonicalSourceAsRenderedSource ? sourceX : targetX;
    const canonicalSourceY = useCanonicalSourceAsRenderedSource ? sourceY : targetY;
    const canonicalTargetX = useCanonicalSourceAsRenderedSource ? targetX : sourceX;
    const canonicalTargetY = useCanonicalSourceAsRenderedSource ? targetY : sourceY;

    const pairDeltaX = canonicalTargetX - canonicalSourceX;
    const pairDeltaY = canonicalTargetY - canonicalSourceY;
    const pairLength = Math.hypot(pairDeltaX, pairDeltaY) || 1;

    const normalX = -pairDeltaY / pairLength;
    const normalY = pairDeltaX / pairLength;
    const offsetDistance = parallelIndex * parallelSpacing;

    shiftedSourceX += normalX * offsetDistance;
    shiftedSourceY += normalY * offsetDistance;
    shiftedTargetX += normalX * offsetDistance;
    shiftedTargetY += normalY * offsetDistance;
  }

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX: shiftedSourceX,
    sourceY: shiftedSourceY,
    sourcePosition,
    targetX: shiftedTargetX,
    targetY: shiftedTargetY,
    targetPosition,
  });

  const relationType = data?.relationType?.trim() || 'UNSPECIFIED';

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'none',
            minWidth: LABEL_WIDTH,
            height: LABEL_HEIGHT,
            padding: '6px 10px',
            borderRadius: 999,
            border: '1px solid #cbd5e1',
            background: 'rgba(255, 255, 255, 0.96)',
            color: '#0f172a',
            fontSize: 12,
            fontWeight: 600,
            lineHeight: '20px',
            textAlign: 'center',
            boxShadow: '0 6px 20px rgba(15, 23, 42, 0.12)',
            whiteSpace: 'nowrap',
          }}
        >
          {relationType}
        </div>
      </EdgeLabelRenderer>
    </>
  );
});
