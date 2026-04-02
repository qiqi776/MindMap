// Package service defines application services for graph traversal and query orchestration.
package service

import (
	"context"
	"errors"
	"fmt"

	model "treemindmap/internal/graph"
)

var (
	// ErrNilContext indicates that the caller passed a nil context, which would
	// prevent cancellation and deadline propagation during traversal.
	ErrNilContext = errors.New("service: nil context")

	// ErrNodeNotFound indicates that the requested node does not exist in storage.
	ErrNodeNotFound = errors.New("service: node not found")

	// ErrEmptyFocusNodeID indicates that the focus node identifier is missing.
	ErrEmptyFocusNodeID = errors.New("service: empty focus node ID")

	// ErrNegativeMaxDepth indicates that the traversal depth argument is invalid.
	ErrNegativeMaxDepth = errors.New("service: negative max depth")

	// ErrFocusNodeNotFound indicates that the focus node does not exist in storage.
	// It aliases ErrNodeNotFound so callers can match either identifier.
	ErrFocusNodeNotFound = ErrNodeNotFound

	// ErrSourceNodeNotFound indicates that the source endpoint of an edge is missing.
	ErrSourceNodeNotFound = errors.New("service: source node not found")

	// ErrTargetNodeNotFound indicates that the target endpoint of an edge is missing.
	ErrTargetNodeNotFound = errors.New("service: target node not found")

	// ErrEdgeNotFound indicates that the requested edge does not exist in storage.
	ErrEdgeNotFound = errors.New("service: edge not found")

	// ErrCyclicDependency indicates that a write operation would violate
	// a domain rule that forbids a cycle for a constrained relation type.
	ErrCyclicDependency = errors.New("service: cyclic dependency")
)

// SubGraphDTO contains the unique nodes and edges collected during a bounded
// breadth-first traversal around one focus node.
type SubGraphDTO struct {
	// Nodes stores the unique node set keyed by UUID so repeated discovery does
	// not duplicate payloads in cyclic or multi-path traversals.
	Nodes map[string]*model.Node `json:"nodes"`

	// Edges stores the unique edge set keyed by UUID so parallel relations
	// between the same node pair remain distinguishable.
	Edges map[string]*model.Edge `json:"edges"`
}

// GraphQueryService coordinates graph traversal against the repository layer.
type GraphQueryService struct {
	repository model.GraphQueryRepository
}

// NewGraphQueryService constructs a query service with the repository used for
// batched node and edge retrieval.
func NewGraphQueryService(repository model.GraphQueryRepository) *GraphQueryService {
	return &GraphQueryService{repository: repository}
}

// FetchFocusGraph performs a breadth-first traversal centered on focusNodeID
// and returns the unique nodes and edges reachable within maxDepth hops.
//
// The method uses level-based batching to avoid N+1 queries and maintains
// visited node and edge sets to cut traversal cycles in O(1) time per lookup.
// Time complexity is O(Vr + Er) in memory processing for the visited radius,
// assuming batch repository calls scale with the size of each frontier. Space
// complexity is O(Vr + Er) for the DTO, visited sets, and frontier buffers.
func (s *GraphQueryService) FetchFocusGraph(ctx context.Context, focusNodeID string, maxDepth int) (*SubGraphDTO, error) {
	if ctx == nil {
		return nil, ErrNilContext
	}

	if s == nil || s.repository == nil {
		return nil, fmt.Errorf("service: nil repository")
	}

	if focusNodeID == "" {
		return nil, ErrEmptyFocusNodeID
	}

	if maxDepth < 0 {
		return nil, ErrNegativeMaxDepth
	}

	if err := ctx.Err(); err != nil {
		return nil, err
	}

	result := &SubGraphDTO{
		Nodes: make(map[string]*model.Node),
		Edges: make(map[string]*model.Edge),
	}

	visitedNodes := make(map[string]struct{})
	visitedEdges := make(map[string]struct{})

	focusNodes, err := s.repository.GetNodesByIDs(ctx, []string{focusNodeID})
	if err != nil {
		return nil, err
	}

	focusNode := firstNodeByID(focusNodes, focusNodeID)
	if focusNode == nil {
		return nil, ErrFocusNodeNotFound
	}

	visitedNodes[focusNode.ID] = struct{}{}
	result.Nodes[focusNode.ID] = focusNode

	frontier := []string{focusNode.ID}

	for depth := 0; depth < maxDepth; depth++ {
		if err := ctx.Err(); err != nil {
			return nil, err
		}

		if len(frontier) == 0 {
			break
		}

		currentLevelNodeIDs := uniqueNonEmptyStrings(frontier)
		if len(currentLevelNodeIDs) == 0 {
			break
		}

		adjacentEdges, err := s.repository.GetEdgesByNodeIDs(ctx, currentLevelNodeIDs)
		if err != nil {
			return nil, err
		}

		frontierSet := makeStringSet(currentLevelNodeIDs)
		levelEdges := make([]*model.Edge, 0, len(adjacentEdges))
		nextLevelNodeIDs := make([]string, 0, len(adjacentEdges))
		nextLevelNodeIDSet := make(map[string]struct{})

		for _, edge := range adjacentEdges {
			if edge == nil || edge.ID == "" {
				continue
			}

			sourceInFrontier := containsString(frontierSet, edge.SourceID)
			targetInFrontier := containsString(frontierSet, edge.TargetID)
			if !sourceInFrontier && !targetInFrontier {
				continue
			}

			if edge.SourceID == "" || edge.TargetID == "" {
				continue
			}

			levelEdges = append(levelEdges, edge)
			collectUnvisitedNodeID(edge.SourceID, visitedNodes, nextLevelNodeIDSet, &nextLevelNodeIDs)
			collectUnvisitedNodeID(edge.TargetID, visitedNodes, nextLevelNodeIDSet, &nextLevelNodeIDs)
		}

		frontier = frontier[:0]
		levelVisibleNodes := cloneStringSet(visitedNodes, len(nextLevelNodeIDSet))

		if len(nextLevelNodeIDs) > 0 {
			nextLevelNodes, err := s.repository.GetNodesByIDs(ctx, nextLevelNodeIDs)
			if err != nil {
				return nil, err
			}

			for _, node := range nextLevelNodes {
				if node == nil || node.ID == "" {
					continue
				}

				if _, exists := nextLevelNodeIDSet[node.ID]; !exists {
					continue
				}

				if _, exists := levelVisibleNodes[node.ID]; exists {
					continue
				}

				levelVisibleNodes[node.ID] = struct{}{}
				visitedNodes[node.ID] = struct{}{}
				result.Nodes[node.ID] = node
				frontier = append(frontier, node.ID)
			}
		}

		for _, edge := range levelEdges {
			if edge == nil || edge.ID == "" {
				continue
			}

			if _, sourceVisible := levelVisibleNodes[edge.SourceID]; !sourceVisible {
				continue
			}

			if _, targetVisible := levelVisibleNodes[edge.TargetID]; !targetVisible {
				continue
			}

			if _, exists := visitedEdges[edge.ID]; exists {
				continue
			}

			visitedEdges[edge.ID] = struct{}{}
			result.Edges[edge.ID] = edge
		}
	}

	if maxDepth == 0 {
		return result, nil
	}

	if err := ctx.Err(); err != nil {
		return nil, err
	}

	if len(frontier) == 0 {
		return result, nil
	}

	boundaryEdges, err := s.repository.GetEdgesByNodeIDs(ctx, uniqueNonEmptyStrings(frontier))
	if err != nil {
		return nil, err
	}

	for _, edge := range boundaryEdges {
		if edge == nil || edge.ID == "" || edge.SourceID == "" || edge.TargetID == "" {
			continue
		}

		if _, sourceVisited := visitedNodes[edge.SourceID]; !sourceVisited {
			continue
		}

		if _, targetVisited := visitedNodes[edge.TargetID]; !targetVisited {
			continue
		}

		if _, exists := visitedEdges[edge.ID]; exists {
			continue
		}

		visitedEdges[edge.ID] = struct{}{}
		result.Edges[edge.ID] = edge
	}

	return result, nil
}

func cloneStringSet(source map[string]struct{}, extraCapacity int) map[string]struct{} {
	if extraCapacity < 0 {
		extraCapacity = 0
	}

	result := make(map[string]struct{}, len(source)+extraCapacity)
	for key := range source {
		result[key] = struct{}{}
	}

	return result
}

func firstNodeByID(nodes []*model.Node, nodeID string) *model.Node {
	if nodeID == "" {
		return nil
	}

	for _, node := range nodes {
		if node == nil || node.ID == "" {
			continue
		}

		if node.ID == nodeID {
			return node
		}
	}

	return nil
}

func uniqueNonEmptyStrings(values []string) []string {
	if len(values) == 0 {
		return nil
	}

	result := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		if value == "" {
			continue
		}

		if _, exists := seen[value]; exists {
			continue
		}

		seen[value] = struct{}{}
		result = append(result, value)
	}

	return result
}

func makeStringSet(values []string) map[string]struct{} {
	result := make(map[string]struct{}, len(values))
	for _, value := range values {
		if value == "" {
			continue
		}

		result[value] = struct{}{}
	}

	return result
}

func containsString(values map[string]struct{}, value string) bool {
	if value == "" {
		return false
	}

	_, exists := values[value]
	return exists
}

func collectUnvisitedNodeID(nodeID string, visitedNodes map[string]struct{}, levelNodeIDSet map[string]struct{}, levelNodeIDs *[]string) {
	if nodeID == "" || levelNodeIDs == nil {
		return
	}

	if _, visited := visitedNodes[nodeID]; visited {
		return
	}

	if _, queued := levelNodeIDSet[nodeID]; queued {
		return
	}

	levelNodeIDSet[nodeID] = struct{}{}
	*levelNodeIDs = append(*levelNodeIDs, nodeID)
}
