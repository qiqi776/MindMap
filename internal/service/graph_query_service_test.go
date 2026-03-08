package service

import (
	"context"
	"errors"
	"sort"
	"testing"
	"time"

	model "treemindmap/internal/graph"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type stubGraphRepository struct {
	nodes             map[string]*model.Node
	edges             map[string]*model.Edge
	nodeBatchCalls    int
	edgeBatchCalls    int
	failOnNodeBatch   int
	failOnEdgeBatch   int
	failWithError     error
	nodeBatchRequests [][]string
	edgeBatchRequests [][]string
}

func newStubGraphRepository(nodes []*model.Node, edges []*model.Edge) *stubGraphRepository {
	nodeMap := make(map[string]*model.Node, len(nodes))
	for _, node := range nodes {
		if node == nil || node.ID == "" {
			continue
		}

		nodeMap[node.ID] = node
	}

	edgeMap := make(map[string]*model.Edge, len(edges))
	for _, edge := range edges {
		if edge == nil || edge.ID == "" {
			continue
		}

		edgeMap[edge.ID] = edge
	}

	return &stubGraphRepository{
		nodes: nodeMap,
		edges: edgeMap,
	}
}

func (s *stubGraphRepository) CreateNode(ctx context.Context, node *model.Node) error {
	return nil
}

func (s *stubGraphRepository) CreateEdge(ctx context.Context, edge *model.Edge) error {
	return nil
}

func (s *stubGraphRepository) GetNodesByIDs(ctx context.Context, nodeIDs []string) ([]*model.Node, error) {
	s.nodeBatchCalls++
	s.nodeBatchRequests = append(s.nodeBatchRequests, append([]string(nil), nodeIDs...))

	if s.failOnNodeBatch > 0 && s.nodeBatchCalls == s.failOnNodeBatch {
		if s.failWithError != nil {
			return nil, s.failWithError
		}
		return nil, errors.New("forced node batch failure")
	}

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
	s.edgeBatchRequests = append(s.edgeBatchRequests, append([]string(nil), nodeIDs...))

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

func TestFetchFocusGraphTopologyCases(t *testing.T) {
	linearNodes := []*model.Node{
		{ID: "A", Type: "text", Content: "A"},
		{ID: "B", Type: "text", Content: "B"},
		{ID: "C", Type: "text", Content: "C"},
		{ID: "D", Type: "text", Content: "D"},
	}
	linearEdges := []*model.Edge{
		{ID: "AB", SourceID: "A", TargetID: "B", RelationType: "REFERENCE", Weight: 1},
		{ID: "BC", SourceID: "B", TargetID: "C", RelationType: "REFERENCE", Weight: 1},
		{ID: "CD", SourceID: "C", TargetID: "D", RelationType: "REFERENCE", Weight: 1},
	}

	cyclicNodes := []*model.Node{
		{ID: "A", Type: "text", Content: "A"},
		{ID: "B", Type: "text", Content: "B"},
		{ID: "C", Type: "text", Content: "C"},
	}
	cyclicEdges := []*model.Edge{
		{ID: "AB", SourceID: "A", TargetID: "B", RelationType: "REFERENCE", Weight: 1},
		{ID: "BC", SourceID: "B", TargetID: "C", RelationType: "REFERENCE", Weight: 1},
		{ID: "CA", SourceID: "C", TargetID: "A", RelationType: "REFERENCE", Weight: 1},
	}

	multigraphNodes := []*model.Node{
		{ID: "A", Type: "person", Content: "Person A"},
		{ID: "B", Type: "person", Content: "Person B"},
		{ID: "C", Type: "person", Content: "Child C"},
	}
	multigraphEdges := []*model.Edge{
		{ID: "AB_MARRIAGE", SourceID: "A", TargetID: "B", RelationType: "MARRIAGE", Weight: 1},
		{ID: "BA_MARRIAGE", SourceID: "B", TargetID: "A", RelationType: "MARRIAGE", Weight: 1},
		{ID: "AC_PARENT", SourceID: "A", TargetID: "C", RelationType: "PARENT_CHILD", Weight: 1},
		{ID: "BC_PARENT", SourceID: "B", TargetID: "C", RelationType: "PARENT_CHILD", Weight: 1},
	}

	isolatedNodes := []*model.Node{{ID: "Z", Type: "text", Content: "island"}}

	testCases := []struct {
		name               string
		focusNodeID        string
		maxDepth           int
		buildRepository    func() *stubGraphRepository
		wantNodeIDs        []string
		wantEdgeIDs        []string
		wantNodeBatchCalls int
		wantEdgeBatchCalls int
		assertRepository   func(t *testing.T, repository *stubGraphRepository)
		runWithTimeout     bool
	}{
		{
			name:        "linear depth 1 truncates at one hop",
			focusNodeID: "A",
			maxDepth:    1,
			buildRepository: func() *stubGraphRepository {
				return newStubGraphRepository(linearNodes, linearEdges)
			},
			wantNodeIDs:        []string{"A", "B"},
			wantEdgeIDs:        []string{"AB"},
			wantNodeBatchCalls: 2,
			wantEdgeBatchCalls: 2,
		},
		{
			name:        "linear depth 2 truncates at two hops",
			focusNodeID: "A",
			maxDepth:    2,
			buildRepository: func() *stubGraphRepository {
				return newStubGraphRepository(linearNodes, linearEdges)
			},
			wantNodeIDs:        []string{"A", "B", "C"},
			wantEdgeIDs:        []string{"AB", "BC"},
			wantNodeBatchCalls: 3,
			wantEdgeBatchCalls: 3,
		},
		{
			name:        "linear depth 3 reaches terminal node",
			focusNodeID: "A",
			maxDepth:    3,
			buildRepository: func() *stubGraphRepository {
				return newStubGraphRepository(linearNodes, linearEdges)
			},
			wantNodeIDs:        []string{"A", "B", "C", "D"},
			wantEdgeIDs:        []string{"AB", "BC", "CD"},
			wantNodeBatchCalls: 4,
			wantEdgeBatchCalls: 4,
		},
		{
			name:        "cyclic graph returns without infinite loop",
			focusNodeID: "A",
			maxDepth:    3,
			buildRepository: func() *stubGraphRepository {
				return newStubGraphRepository(cyclicNodes, cyclicEdges)
			},
			wantNodeIDs:        []string{"A", "B", "C"},
			wantEdgeIDs:        []string{"AB", "BC", "CA"},
			wantNodeBatchCalls: 2,
			wantEdgeBatchCalls: 2,
			runWithTimeout:     true,
		},
		{
			name:        "multigraph and cross links deduplicate nodes",
			focusNodeID: "A",
			maxDepth:    1,
			buildRepository: func() *stubGraphRepository {
				return newStubGraphRepository(multigraphNodes, multigraphEdges)
			},
			wantNodeIDs:        []string{"A", "B", "C"},
			wantEdgeIDs:        []string{"AB_MARRIAGE", "AC_PARENT", "BA_MARRIAGE", "BC_PARENT"},
			wantNodeBatchCalls: 2,
			wantEdgeBatchCalls: 2,
			assertRepository: func(t *testing.T, repository *stubGraphRepository) {
				require.Len(t, repository.nodeBatchRequests, 2)
				secondBatch := append([]string(nil), repository.nodeBatchRequests[1]...)
				sort.Strings(secondBatch)
				assert.Equal(t, []string{"B", "C"}, secondBatch)
				assert.Len(t, repository.nodeBatchRequests[1], 2)
			},
		},
		{
			name:        "isolated node returns itself only",
			focusNodeID: "Z",
			maxDepth:    2,
			buildRepository: func() *stubGraphRepository {
				return newStubGraphRepository(isolatedNodes, nil)
			},
			wantNodeIDs:        []string{"Z"},
			wantEdgeIDs:        []string{},
			wantNodeBatchCalls: 1,
			wantEdgeBatchCalls: 1,
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			repository := testCase.buildRepository()
			service := NewGraphQueryService(repository)

			var (
				result *SubGraphDTO
				err    error
			)

			runQuery := func() {
				result, err = service.FetchFocusGraph(context.Background(), testCase.focusNodeID, testCase.maxDepth)
			}

			if testCase.name == "isolated node returns itself only" {
				assert.NotPanics(t, runQuery)
			} else if testCase.runWithTimeout {
				done := make(chan struct{})
				go func() {
					defer close(done)
					runQuery()
				}()

				select {
				case <-done:
				case <-time.After(200 * time.Millisecond):
					t.Fatal("FetchFocusGraph did not return within the expected time budget")
				}
			} else {
				runQuery()
			}

			require.NoError(t, err)
			require.NotNil(t, result)
			assert.Equal(t, testCase.wantNodeIDs, sortedNodeIDs(result))
			assert.Equal(t, testCase.wantEdgeIDs, sortedEdgeIDs(result))
			assert.Len(t, result.Nodes, len(testCase.wantNodeIDs))
			assert.Len(t, result.Edges, len(testCase.wantEdgeIDs))
			assert.Equal(t, testCase.wantNodeBatchCalls, repository.nodeBatchCalls)
			assert.Equal(t, testCase.wantEdgeBatchCalls, repository.edgeBatchCalls)

			if testCase.assertRepository != nil {
				testCase.assertRepository(t, repository)
			}
		})
	}
}

func TestFetchFocusGraphInputAndRepositoryErrors(t *testing.T) {
	baseRepository := newStubGraphRepository(
		[]*model.Node{{ID: "A", Type: "text", Content: "focus"}},
		[]*model.Edge{{ID: "AB", SourceID: "A", TargetID: "B", RelationType: "REFERENCE", Weight: 1}},
	)

	testCases := []struct {
		name            string
		ctx             context.Context
		focusNodeID     string
		maxDepth        int
		repository      *stubGraphRepository
		wantError       error
		wantNodeBatches int
		wantEdgeBatches int
	}{
		{
			name:        "nil context",
			ctx:         nil,
			focusNodeID: "A",
			maxDepth:    1,
			repository:  baseRepository,
			wantError:   ErrNilContext,
		},
		{
			name:        "empty focus node id",
			ctx:         context.Background(),
			focusNodeID: "",
			maxDepth:    1,
			repository:  baseRepository,
			wantError:   ErrEmptyFocusNodeID,
		},
		{
			name:        "negative max depth",
			ctx:         context.Background(),
			focusNodeID: "A",
			maxDepth:    -1,
			repository:  baseRepository,
			wantError:   ErrNegativeMaxDepth,
		},
		{
			name:            "missing focus node",
			ctx:             context.Background(),
			focusNodeID:     "missing",
			maxDepth:        1,
			repository:      newStubGraphRepository(nil, nil),
			wantError:       ErrFocusNodeNotFound,
			wantNodeBatches: 1,
		},
		{
			name:        "context canceled before traversal",
			ctx:         canceledContext(),
			focusNodeID: "A",
			maxDepth:    1,
			repository:  baseRepository,
			wantError:   context.Canceled,
		},
		{
			name:        "edge batch failure propagates",
			ctx:         context.Background(),
			focusNodeID: "A",
			maxDepth:    1,
			repository: &stubGraphRepository{
				nodes: map[string]*model.Node{
					"A": {ID: "A", Type: "text", Content: "focus"},
				},
				edges:           map[string]*model.Edge{},
				failOnEdgeBatch: 1,
				failWithError:   context.DeadlineExceeded,
			},
			wantError:       context.DeadlineExceeded,
			wantNodeBatches: 1,
			wantEdgeBatches: 1,
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			service := NewGraphQueryService(testCase.repository)
			result, err := service.FetchFocusGraph(testCase.ctx, testCase.focusNodeID, testCase.maxDepth)
			require.Error(t, err)
			assert.ErrorIs(t, err, testCase.wantError)
			assert.Nil(t, result)
			assert.Equal(t, testCase.wantNodeBatches, testCase.repository.nodeBatchCalls)
			assert.Equal(t, testCase.wantEdgeBatches, testCase.repository.edgeBatchCalls)
		})
	}
}

func canceledContext() context.Context {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	return ctx
}

func sortedNodeIDs(result *SubGraphDTO) []string {
	if result == nil {
		return nil
	}

	nodeIDs := make([]string, 0, len(result.Nodes))
	for nodeID := range result.Nodes {
		nodeIDs = append(nodeIDs, nodeID)
	}
	sort.Strings(nodeIDs)
	return nodeIDs
}

func sortedEdgeIDs(result *SubGraphDTO) []string {
	if result == nil {
		return nil
	}

	edgeIDs := make([]string, 0, len(result.Edges))
	for edgeID := range result.Edges {
		edgeIDs = append(edgeIDs, edgeID)
	}
	sort.Strings(edgeIDs)
	return edgeIDs
}
