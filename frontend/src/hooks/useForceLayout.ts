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
import type { Edge, Node, NodeDragHandler, XYPosition } from 'reactflow';

import type { FocusNodeAnchor } from '@/lib/graphUtils';
import { useGraphStore } from '@/store/useGraphStore';

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
  onNodeDragStart: NodeDragHandler;
  onNodeDrag: NodeDragHandler;
  onNodeDragStop: NodeDragHandler;
  restartLayout: (alpha?: number) => void;
  scheduleFocusReheat: (focusNode: FocusNodeAnchor) => void;
}

const DEFAULT_CHARGE_STRENGTH = -900;
const DEFAULT_ISOLATED_CHARGE_STRENGTH = -420;
const DEFAULT_LINK_DISTANCE = 180;
const DEFAULT_ALPHA_DECAY = 0.05;
const FOCUS_LOCK_DURATION_MS = 800;

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
  const focusUnlockTimerRef = useRef<number | null>(null);
  const pendingFocusRef = useRef<FocusNodeAnchor | null>(null);

  const clearAnimationFrame = useCallback(() => {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const clearFocusUnlockTimer = useCallback(() => {
    if (focusUnlockTimerRef.current !== null) {
      window.clearTimeout(focusUnlockTimerRef.current);
      focusUnlockTimerRef.current = null;
    }
  }, []);

  const commitNodePositions = useCallback(() => {
    const nodePositionUpdates: Array<{ nodeId: string; x: number; y: number }> = [];

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
        nodePositionUpdates.push({
          nodeId: node.id,
          x: nextX,
          y: nextY,
        });

        return {
          ...node,
          position: { x: nextX, y: nextY },
        };
      });

      return hasMutation ? nextNodes : currentNodes;
    });

    if (nodePositionUpdates.length > 0) {
      useGraphStore.getState().updateNodePositions(nodePositionUpdates);
    }
  }, [setNodes]);

  const restartLayout = useCallback((alpha = 0.6) => {
    const simulation = simulationRef.current;
    if (!simulation) {
      return;
    }

    simulation.alpha(alpha).alphaTarget(0).restart();
  }, []);

  const scheduleFocusReheat = useCallback((focusNode: FocusNodeAnchor) => {
    pendingFocusRef.current = focusNode;
  }, []);

  useEffect(() => {
    return () => {
      clearAnimationFrame();
      clearFocusUnlockTimer();
      simulationRef.current?.on('tick', null);
      simulationRef.current?.stop();
      simulationRef.current = null;
      nodeLookupRef.current = new Map();
    };
  }, [clearAnimationFrame, clearFocusUnlockTimer]);

  useEffect(() => {
    if (topologyNodes.length === 0) {
      clearAnimationFrame();
      clearFocusUnlockTimer();
      simulationRef.current?.stop();
      simulationRef.current = null;
      nodeLookupRef.current = new Map();
      setNodes([]);
      return;
    }

    if (width <= 0 || height <= 0) {
      return;
    }

    const previousNodeLookup = nodeLookupRef.current;
    const degreeMap = buildDegreeMap(topologyNodes, topologyEdges);
    const nextNodeDatums = topologyNodes.map((node, index) => {
      const existingDatum = previousNodeLookup.get(node.id);
      if (existingDatum) {
        existingDatum.node = node;

        if (!isFiniteNumber(existingDatum.x) || !isFiniteNumber(existingDatum.y)) {
          const preferredPosition = readNodePosition(node) ?? seedNodePosition(index, topologyNodes.length, width, height);
          existingDatum.x = preferredPosition.x;
          existingDatum.y = preferredPosition.y;
        }

        return existingDatum;
      }

      const preferredPosition = readNodePosition(node) ?? seedNodePosition(index, topologyNodes.length, width, height);
      return {
        id: node.id,
        node,
        x: preferredPosition.x,
        y: preferredPosition.y,
        vx: 0,
        vy: 0,
      } satisfies ForceNodeDatum;
    });

    const nextNodeLookup = new Map(nextNodeDatums.map((datum) => [datum.id, datum]));
    nodeLookupRef.current = nextNodeLookup;

    const linkDatums = topologyEdges
      .filter((edge) => nextNodeLookup.has(edge.source) && nextNodeLookup.has(edge.target))
      .map((edge) => {
        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          edge,
          weight: edge.data?.weight ?? 1,
        } satisfies ForceLinkDatum;
      });

    const chargeForce = forceManyBody<ForceNodeDatum>().strength((datum) => {
      const degree = degreeMap.get(datum.id) ?? 0;
      return degree === 0 ? isolatedChargeStrength : chargeStrength;
    });

    const linkForce = forceLink<ForceNodeDatum, ForceLinkDatum>(linkDatums)
      .id((datum) => datum.id)
      .distance(linkDistance);

    let simulation = simulationRef.current;
    const isNewSimulation = simulation === null;

    if (simulation === null) {
      simulation = forceSimulation<ForceNodeDatum, ForceLinkDatum>()
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
    }

    simulation
      .nodes(nextNodeDatums)
      .alphaDecay(alphaDecay)
      .force('charge', chargeForce)
      .force('link', linkForce)
      .force('center', forceCenter(width / 2, height / 2));

    const pendingFocus = pendingFocusRef.current;
    if (pendingFocus) {
      const focusDatum = nextNodeLookup.get(pendingFocus.id);
      pendingFocusRef.current = null;

      if (focusDatum) {
        const centerX = width / 2;
        const centerY = height / 2;

        focusDatum.x = centerX;
        focusDatum.y = centerY;
        focusDatum.fx = centerX;
        focusDatum.fy = centerY;
        focusDatum.vx = 0;
        focusDatum.vy = 0;

        commitNodePositions();
        clearFocusUnlockTimer();
        simulation.alpha(1).alphaTarget(0).restart();

        focusUnlockTimerRef.current = window.setTimeout(() => {
          const latestFocusDatum = nodeLookupRef.current.get(pendingFocus.id);
          if (!latestFocusDatum) {
            return;
          }

          latestFocusDatum.fx = null;
          latestFocusDatum.fy = null;
          simulationRef.current?.alpha(0.24).alphaTarget(0).restart();
        }, FOCUS_LOCK_DURATION_MS);

        return;
      }
    }

    commitNodePositions();
    simulation.alpha(isNewSimulation ? 0.9 : 0.45).alphaTarget(0).restart();
  }, [
    alphaDecay,
    chargeStrength,
    clearAnimationFrame,
    clearFocusUnlockTimer,
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

  const onNodeDragStart = useCallback<NodeDragHandler>((_, node) => {
    pinNode(node as MindMapNode);
  }, [pinNode]);

  const onNodeDrag = useCallback<NodeDragHandler>((_, node) => {
    pinNode(node as MindMapNode);
  }, [pinNode]);

  const onNodeDragStop = useCallback<NodeDragHandler>((_, node) => {
    const positionedNode = node as MindMapNode;
    const datum = nodeLookupRef.current.get(positionedNode.id);
    if (!datum) {
      return;
    }

    datum.x = positionedNode.position.x;
    datum.y = positionedNode.position.y;
    datum.fx = null;
    datum.fy = null;

    useGraphStore.getState().updateNodePosition(positionedNode.id, positionedNode.position.x, positionedNode.position.y);

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
    scheduleFocusReheat,
  };
}
