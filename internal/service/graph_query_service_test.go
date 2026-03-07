package service

import (
	"context"
	"errors"
	"testing"

	model "treemindmap/internal/graph"
)

type stubGraphRepository struct {
	nodes             map[string]*model.Node
	edges             map[string]*model.Edge
	nodeBatchCalls    int
	edgeBatchCalls    int
	failOnEdgeBatch   int
	failWithError     error
	lastNodeBatchSize []int
	lastEdgeBatchSize []int
}

func (s *stubGraphRepository) CreateNode(ctx context.Context, node *model.Node) error {
	return nil
}

func (s *stubGraphRepository) CreateEdge(ctx context.Context, edge *model.Edge) error {
	return nil
}

func (s *stubGraphRepository) GetNodesByIDs(ctx context.Context, nodeIDs []string) ([]*model.Node, error) {
	s.nodeBatchCalls++
	s.lastNodeBatchSize = append(s.lastNodeBatchSize, len(nodeIDs))

	result := make([]*model.Node, 0, len(nodeIDs))
	seen := make(map[string]struct{}, len(nodeIDs))
	for _, nodeID := range nodeIDs {
		if nodeID == "" {
			continue
		}

		if _, exists := seen[nodeID]; exists {
			continue
		}

		seen[nodeID] = struct{}{}
		if node, exists := s.nodes[nodeID]; exists {
			result = append(result, node)
		}
	}

	return result, nil
}

func (s *stubGraphRepository) GetEdgesByNodeIDs(ctx context.Context, nodeIDs []string) ([]*model.Edge, error) {
	s.edgeBatchCalls++
	s.lastEdgeBatchSize = append(s.lastEdgeBatchSize, len(nodeIDs))

	if s.failOnEdgeBatch > 0 && s.edgeBatchCalls == s.failOnEdgeBatch {
		if s.failWithError != nil {
			return nil, s.failWithError
		}
		return nil, errors.New("forced edge batch failure")
	}

	nodeSet := make(map[string]struct{}, len(nodeIDs))
	for _, nodeID := range nodeIDs {
		if nodeID == "" {
			continue
		}

		nodeSet[nodeID] = struct{}{}
	}

	result := make([]*model.Edge, 0, len(s.edges))
	for _, edge := range s.edges {
		if edge == nil || edge.ID == "" {
			continue
		}

		if _, exists := nodeSet[edge.SourceID]; exists {
			result = append(result, edge)
			continue
		}

		if _, exists := nodeSet[edge.TargetID]; exists {
			result = append(result, edge)
		}
	}

	return result, nil
}

func (s *stubGraphRepository) GetAdjoiningNodes(ctx context.Context, nodeID string, relationType string, direction string) ([]*model.Node, error) {
	return nil, nil
}

func TestFetchFocusGraphHandlesCycleAndBoundaryEdges(t *testing.T) {
	repository := &stubGraphRepository{
		nodes: map[string]*model.Node{
			"A": {ID: "A", Type: "text", Content: "focus"},
			"B": {ID: "B", Type: "text", Content: "left"},
			"C": {ID: "C", Type: "text", Content: "right"},
		},
		edges: map[string]*model.Edge{
			"AB": {ID: "AB", SourceID: "A", TargetID: "B", RelationType: "REFERENCE", Weight: 1},
			"AC": {ID: "AC", SourceID: "A", TargetID: "C", RelationType: "REFERENCE", Weight: 1},
			"BC": {ID: "BC", SourceID: "B", TargetID: "C", RelationType: "REFERENCE", Weight: 1},
			"CA": {ID: "CA", SourceID: "C", TargetID: "A", RelationType: "REFERENCE", Weight: 1},
		},
	}

	service := NewGraphQueryService(repository)
	result, err := service.FetchFocusGraph(context.Background(), "A", 1)
	if err != nil {
		t.Fatalf("FetchFocusGraph returned error: %v", err)
	}

	if len(result.Nodes) != 3 {
		t.Fatalf("expected 3 nodes, got %d", len(result.Nodes))
	}

	if len(result.Edges) != 4 {
		t.Fatalf("expected 4 edges, got %d", len(result.Edges))
	}

	if repository.edgeBatchCalls != 2 {
		t.Fatalf("expected 2 edge batch calls, got %d", repository.edgeBatchCalls)
	}

	if repository.nodeBatchCalls != 2 {
		t.Fatalf("expected 2 node batch calls, got %d", repository.nodeBatchCalls)
	}
}

func TestFetchFocusGraphReturnsOnlyFocusNodeAtDepthZero(t *testing.T) {
	repository := &stubGraphRepository{
		nodes: map[string]*model.Node{
			"A": {ID: "A", Type: "text", Content: "focus"},
			"B": {ID: "B", Type: "text", Content: "linked"},
		},
		edges: map[string]*model.Edge{
			"AB": {ID: "AB", SourceID: "A", TargetID: "B", RelationType: "REFERENCE", Weight: 1},
		},
	}

	service := NewGraphQueryService(repository)
	result, err := service.FetchFocusGraph(context.Background(), "A", 0)
	if err != nil {
		t.Fatalf("FetchFocusGraph returned error: %v", err)
	}

	if len(result.Nodes) != 1 {
		t.Fatalf("expected 1 node, got %d", len(result.Nodes))
	}

	if len(result.Edges) != 0 {
		t.Fatalf("expected 0 edges, got %d", len(result.Edges))
	}

	if repository.edgeBatchCalls != 0 {
		t.Fatalf("expected 0 edge batch calls, got %d", repository.edgeBatchCalls)
	}
}

func TestFetchFocusGraphStopsOnContextCancellation(t *testing.T) {
	repository := &stubGraphRepository{
		nodes: map[string]*model.Node{
			"A": {ID: "A", Type: "text", Content: "focus"},
			"B": {ID: "B", Type: "text", Content: "linked"},
		},
		edges: map[string]*model.Edge{
			"AB": {ID: "AB", SourceID: "A", TargetID: "B", RelationType: "REFERENCE", Weight: 1},
		},
		failOnEdgeBatch: 2,
		failWithError:   context.Canceled,
	}

	service := NewGraphQueryService(repository)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := service.FetchFocusGraph(ctx, "A", 2)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context canceled, got %v", err)
	}
}

func TestFetchFocusGraphReturnsErrorWhenFocusNodeMissing(t *testing.T) {
	repository := &stubGraphRepository{
		nodes: map[string]*model.Node{},
		edges: map[string]*model.Edge{},
	}

	service := NewGraphQueryService(repository)
	_, err := service.FetchFocusGraph(context.Background(), "missing", 1)
	if !errors.Is(err, ErrFocusNodeNotFound) {
		t.Fatalf("expected ErrFocusNodeNotFound, got %v", err)
	}
}
