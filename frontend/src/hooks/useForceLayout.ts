import { useCallback, useEffect, useRef } from 'react';
import {
  forceCenter,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import type { Dispatch, SetStateAction } from 'react';
import type { Edge, Node, OnNodeDrag, XYPosition } from '@xyflow/react';

export interface GraphNodeVO {
  id: string;
  type: string;
  content: string;
  properties?: Record<string, unknown> | null;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
}

export interface GraphEdgeVO {
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

export interface GraphVO {
  nodes: GraphNodeVO[];
  edges: GraphEdgeVO[];
}

export interface MindMapNodeData {
  label: string;
  entityType: string;
  raw: GraphNodeVO;
}

export interface MindMapEdgeData {
  relationType: string;
  weight: number;
  raw: GraphEdgeVO;
}

export type MindMapNode = Node<MindMapNodeData>;
export type MindMapEdge = Edge<MindMapEdgeData>;

export type ForceNodeDatum = SimulationNodeDatum & {
  id: string;
  node: MindMapNode;
  x: number;
  y: number;
  fx?: number | null;
  fy?: number | null;
};

export type ForceLinkDatum = SimulationLinkDatum<ForceNodeDatum> & {
  id: string;
  source: string | ForceNodeDatum;
  target: string | ForceNodeDatum;
  edge: MindMapEdge;
  weight: number;
};

export interface UseForceLayoutOptions {
  topologyNodes: MindMapNode[];
  topologyEdges: MindMapEdge[];
  width: number;
  height: number;
  setNodes: Dispatch<SetStateAction<MindMapNode[]>>;
  chargeStrength?: number;
  isolatedChargeStrength?: number;
  linkDistance?: number;
  alphaDecay?: number;
}

export interface UseForceLayoutResult {
  onNodeDragStart: OnNodeDrag<MindMapNode>;
  onNodeDrag: OnNodeDrag<MindMapNode>;
  onNodeDragStop: OnNodeDrag<MindMapNode>;
  restartLayout: (alpha?: number) => void;
}

const DEFAULT_CHARGE_STRENGTH = -900;
const DEFAULT_ISOLATED_CHARGE_STRENGTH = -420;
const DEFAULT_LINK_DISTANCE = 180;
const DEFAULT_ALPHA_DECAY = 0.05;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function readNodePosition(node: MindMapNode): XYPosition | null {
  if (isFiniteNumber(node.position.x) && isFiniteNumber(node.position.y)) {
    return node.position;
  }

  const properties = node.data.raw.properties;
  if (!properties) {
    return null;
  }

  const x = properties.x;
  const y = properties.y;
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) {
    return null;
  }

  return { x, y };
}

function seedNodePosition(index: number, total: number, width: number, height: number): XYPosition {
  const safeTotal = Math.max(total, 1);
  const centerX = width / 2;
  const centerY = height / 2;
  const ringRadius = Math.max(96, Math.min(width, height) * 0.24);
  const angle = (index / safeTotal) * Math.PI * 2;

  return {
    x: centerX + Math.cos(angle) * ringRadius,
    y: centerY + Math.sin(angle) * ringRadius,
  };
}

function buildDegreeMap(nodes: MindMapNode[], edges: MindMapEdge[]): Map<string, number> {
  const degreeMap = new Map<string, number>();

  for (const node of nodes) {
    degreeMap.set(node.id, 0);
  }

  for (const edge of edges) {
    degreeMap.set(edge.source, (degreeMap.get(edge.source) ?? 0) + 1);
    degreeMap.set(edge.target, (degreeMap.get(edge.target) ?? 0) + 1);
  }

  return degreeMap;
}

export function useForceLayout({
  topologyNodes,
  topologyEdges,
  width,
  height,
  setNodes,
  chargeStrength = DEFAULT_CHARGE_STRENGTH,
  isolatedChargeStrength = DEFAULT_ISOLATED_CHARGE_STRENGTH,
  linkDistance = DEFAULT_LINK_DISTANCE,
  alphaDecay = DEFAULT_ALPHA_DECAY,
}: UseForceLayoutOptions): UseForceLayoutResult {
  const simulationRef = useRef<Simulation<ForceNodeDatum, ForceLinkDatum> | null>(null);
  const nodeLookupRef = useRef<Map<string, ForceNodeDatum>>(new Map());
  const rafRef = useRef<number | null>(null);

  const commitNodePositions = useCallback(() => {
    setNodes((currentNodes) => {
      let hasMutation = false;

      const nextNodes = currentNodes.map((node) => {
        const datum = nodeLookupRef.current.get(node.id);
        if (!datum) {
          return node;
        }

        const nextX = isFiniteNumber(datum.x) ? datum.x : node.position.x;
        const nextY = isFiniteNumber(datum.y) ? datum.y : node.position.y;
        if (Math.abs(node.position.x - nextX) < 0.5 && Math.abs(node.position.y - nextY) < 0.5) {
          return node;
        }

        hasMutation = true;
        return {
          ...node,
          position: { x: nextX, y: nextY },
        };
      });

      return hasMutation ? nextNodes : currentNodes;
    });
  }, [setNodes]);

  const restartLayout = useCallback((alpha = 0.6) => {
    const simulation = simulationRef.current;
    if (!simulation) {
      return;
    }

    simulation.alpha(alpha).alphaTarget(0).restart();
  }, []);

  useEffect(() => {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    simulationRef.current?.stop();
    simulationRef.current = null;
    nodeLookupRef.current = new Map();

    if (topologyNodes.length === 0) {
      setNodes([]);
      return undefined;
    }

    if (width <= 0 || height <= 0) {
      return undefined;
    }

    const degreeMap = buildDegreeMap(topologyNodes, topologyEdges);
    const nodeDatums = topologyNodes.map((node, index) => {
      const preferredPosition = readNodePosition(node) ?? seedNodePosition(index, topologyNodes.length, width, height);

      return {
        id: node.id,
        node,
        x: preferredPosition.x,
        y: preferredPosition.y,
      } satisfies ForceNodeDatum;
    });

    const nodeLookup = new Map(nodeDatums.map((datum) => [datum.id, datum]));
    nodeLookupRef.current = nodeLookup;

    const linkDatums = topologyEdges
      .filter((edge) => nodeLookup.has(edge.source) && nodeLookup.has(edge.target))
      .map((edge) => {
        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          edge,
          weight: edge.data?.weight ?? 1,
        } satisfies ForceLinkDatum;
      });

    const chargeForce = forceManyBody<ForceNodeDatum>()
      // forceManyBody 使用负值电荷实现节点间排斥。绝对值越大，图中任意两点的最小间距越大，
      // 可以降低高密度子图的重叠概率；但过大的排斥会显著增加边长方差，使局部团簇被拉散。
      // 对孤立节点降低排斥强度，是为了避免低度数顶点仅因没有边约束就占据过大的画布面积。
      .strength((datum) => {
        const degree = degreeMap.get(datum.id) ?? 0;
        return degree === 0 ? isolatedChargeStrength : chargeStrength;
      });

    const linkForce = forceLink<ForceNodeDatum, ForceLinkDatum>(linkDatums)
      .id((datum) => datum.id)
      // distance 定义相邻顶点的目标边长。较小值会压缩局部邻域，适合强调连通分量；
      // 较大值会增加路径可读性并降低交叉边的视觉干扰，但会消耗更多画布空间。
      .distance(linkDistance);

    const centerForce = forceCenter(width / 2, height / 2);
    // forceCenter 只对整张图施加整体平移，不改变图的相对拓扑结构。
    // 它用于抑制连通分量整体漂移到视口外侧，从而保持循环与交叉连线仍位于可交互区域内。

    const simulation = forceSimulation(nodeDatums)
      // alphaDecay 控制系统能量衰减速度。较高值可以在有限 tick 内结束计算，
      // 避免前端在拓扑稳定后继续占用 CPU；当前值大约会在 100~150 次迭代内完成冷却。
      .alphaDecay(alphaDecay)
      .force('charge', chargeForce)
      .force('link', linkForce)
      .force('center', centerForce)
      .on('tick', () => {
        if (rafRef.current !== null) {
          return;
        }

        rafRef.current = window.requestAnimationFrame(() => {
          rafRef.current = null;
          commitNodePositions();
        });
      });

    simulationRef.current = simulation;
    commitNodePositions();
    simulation.alpha(0.9).restart();

    return () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }

      simulation.on('tick', null);
      simulation.stop();
    };
  }, [
    alphaDecay,
    chargeStrength,
    commitNodePositions,
    height,
    isolatedChargeStrength,
    linkDistance,
    setNodes,
    topologyEdges,
    topologyNodes,
    width,
  ]);

  const pinNode = useCallback((positionedNode: MindMapNode) => {
    const datum = nodeLookupRef.current.get(positionedNode.id);
    if (!datum) {
      return;
    }

    datum.x = positionedNode.position.x;
    datum.y = positionedNode.position.y;
    datum.fx = positionedNode.position.x;
    datum.fy = positionedNode.position.y;

    const simulation = simulationRef.current;
    if (simulation) {
      simulation.alphaTarget(0.18).restart();
    }
  }, []);

  const onNodeDragStart = useCallback<OnNodeDrag<MindMapNode>>((_, node) => {
    pinNode(node);
  }, [pinNode]);

  const onNodeDrag = useCallback<OnNodeDrag<MindMapNode>>((_, node) => {
    pinNode(node);
  }, [pinNode]);

  const onNodeDragStop = useCallback<OnNodeDrag<MindMapNode>>((_, node) => {
    const datum = nodeLookupRef.current.get(node.id);
    if (!datum) {
      return;
    }

    datum.x = node.position.x;
    datum.y = node.position.y;
    datum.fx = null;
    datum.fy = null;

    const simulation = simulationRef.current;
    if (simulation) {
      simulation.alpha(0.35).alphaTarget(0).restart();
    }
  }, []);

  return {
    onNodeDragStart,
    onNodeDrag,
    onNodeDragStop,
    restartLayout,
  };
}
