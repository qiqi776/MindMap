import { memo, type ReactElement } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type Edge,
  type EdgeProps,
} from 'reactflow';

import type { MindMapEdgeData } from '@/hooks/useForceLayout';

export interface SemanticEdgeData extends MindMapEdgeData {
  parallelCount?: number;
  parallelIndex?: number;
  parallelSpacing?: number;
}

export type SemanticMindMapEdge = Edge<SemanticEdgeData>;

const DEFAULT_PARALLEL_SPACING = 24;

function compareNodeIDs(leftNodeID: string, rightNodeID: string): number {
  if (leftNodeID === rightNodeID) {
    return 0;
  }

  return leftNodeID < rightNodeID ? -1 : 1;
}

export const SemanticEdge = memo(function SemanticEdge(props: EdgeProps<SemanticEdgeData>): ReactElement {
  const {
    id,
    selected,
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
  const labelClassName = selected ? 'semantic-edge-label semantic-edge-label--selected' : 'semantic-edge-label';

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} />
      <EdgeLabelRenderer>
        <div
          className={labelClassName}
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
        >
          {relationType}
        </div>
      </EdgeLabelRenderer>
    </>
  );
});
