package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	model "treemindmap/internal/graph"
	appservice "treemindmap/internal/service"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const (
	focusNodeID  = "11111111-1111-1111-1111-111111111111"
	linkedNodeID = "22222222-2222-2222-2222-222222222222"
	edgeID       = "33333333-3333-3333-3333-333333333333"
)

type integrationQueryService struct {
	subgraph   *appservice.SubGraphDTO
	err        error
	panicValue any
}

func (s *integrationQueryService) FetchFocusGraph(ctx context.Context, focusNodeID string, maxDepth int) (*appservice.SubGraphDTO, error) {
	if s.panicValue != nil {
		panic(s.panicValue)
	}

	return s.subgraph, s.err
}

type integrationMutationService struct {
	nodesToReturn         []*model.Node
	getNodesErr           error
	createNodeErr         error
	createEdgeErr         error
	updateNodePositionErr error
}

func (s *integrationMutationService) CreateNode(ctx context.Context, node *model.Node) error {
	return s.createNodeErr
}

func (s *integrationMutationService) CreateEdge(ctx context.Context, edge *model.Edge) error {
	return s.createEdgeErr
}

func (s *integrationMutationService) GetNodesByIDs(ctx context.Context, nodeIDs []string) ([]*model.Node, error) {
	if s.getNodesErr != nil {
		return nil, s.getNodesErr
	}

	return s.nodesToReturn, nil
}

func (s *integrationMutationService) UpdateNodePosition(ctx context.Context, nodeID string, x float64, y float64) error {
	return s.updateNodePositionErr
}

func TestGetFocusGraphReturnsArrayContractForFrontend(t *testing.T) {
	gin.SetMode(gin.TestMode)

	controller := NewGraphController(
		&integrationQueryService{
			subgraph: &appservice.SubGraphDTO{
				Nodes: map[string]*model.Node{
					linkedNodeID: {ID: linkedNodeID, Type: "text", Content: "child", Properties: model.JSONDocument(`{"x":12,"y":34}`)},
					focusNodeID:  {ID: focusNodeID, Type: "text", Content: "focus", Properties: model.JSONDocument(`{"x":0,"y":0}`)},
				},
				Edges: map[string]*model.Edge{
					edgeID: {ID: edgeID, SourceID: focusNodeID, TargetID: linkedNodeID, RelationType: "REFERENCE", Weight: 2, Properties: model.JSONDocument(`{"color":"#64748b"}`)},
				},
			},
		},
		&integrationMutationService{},
		3,
	)
	engine := gin.New()
	RegisterGraphRoutes(engine, controller, nil)

	request := httptest.NewRequest(http.MethodGet, "/api/v1/graph/"+focusNodeID+"?depth=1", nil)
	recorder := httptest.NewRecorder()

	engine.ServeHTTP(recorder, request)

	require.Equal(t, http.StatusOK, recorder.Code)

	var envelope map[string]any
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &envelope))
	assert.Equal(t, float64(BusinessCodeSuccess), envelope["code"])
	assert.Equal(t, "success", envelope["message"])

	data, ok := envelope["data"].(map[string]any)
	require.True(t, ok)

	nodes, ok := data["nodes"].([]any)
	require.True(t, ok, "nodes should be serialized as a JSON array")
	edges, ok := data["edges"].([]any)
	require.True(t, ok, "edges should be serialized as a JSON array")
	assert.Len(t, nodes, 2)
	assert.Len(t, edges, 1)

	firstNode, ok := nodes[0].(map[string]any)
	require.True(t, ok)
	secondNode, ok := nodes[1].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, focusNodeID, firstNode["id"])
	assert.Equal(t, linkedNodeID, secondNode["id"])

	firstEdge, ok := edges[0].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, edgeID, firstEdge["id"])
	assert.Equal(t, focusNodeID, firstEdge["source_id"])
	assert.Equal(t, linkedNodeID, firstEdge["target_id"])
}

func TestGraphRoutesMapDomainAndInfrastructureErrors(t *testing.T) {
	gin.SetMode(gin.TestMode)

	validEdgeRequest := []byte(`{"id":"44444444-4444-4444-4444-444444444444","source_id":"11111111-1111-1111-1111-111111111111","target_id":"22222222-2222-2222-2222-222222222222","relation_type":"REFERENCE","weight":1,"properties":{}}`)

	testCases := []struct {
		name            string
		queryService    GraphQueryService
		mutationService GraphMutationService
		method          string
		target          string
		body            []byte
		wantStatus      int
		wantCode        int
		wantMessage     string
	}{
		{
			name:            "deadline exceeded becomes gateway timeout",
			queryService:    &integrationQueryService{err: context.DeadlineExceeded},
			mutationService: &integrationMutationService{},
			method:          http.MethodGet,
			target:          "/api/v1/graph/" + focusNodeID + "?depth=1",
			wantStatus:      http.StatusGatewayTimeout,
			wantCode:        BusinessCodeTimeout,
			wantMessage:     "request timed out",
		},
		{
			name:         "cyclic dependency becomes conflict response",
			queryService: &integrationQueryService{},
			mutationService: &integrationMutationService{
				nodesToReturn: []*model.Node{
					{ID: focusNodeID, Type: "text", Content: "source"},
					{ID: linkedNodeID, Type: "text", Content: "target"},
				},
				createEdgeErr: appservice.ErrCyclicDependency,
			},
			method:      http.MethodPost,
			target:      "/api/v1/edges",
			body:        validEdgeRequest,
			wantStatus:  http.StatusConflict,
			wantCode:    BusinessCodeConflict,
			wantMessage: "cyclic dependency detected",
		},
		{
			name:            "panic is intercepted by recovery middleware",
			queryService:    &integrationQueryService{panicValue: errors.New("boom")},
			mutationService: &integrationMutationService{},
			method:          http.MethodGet,
			target:          "/api/v1/graph/" + focusNodeID + "?depth=1",
			wantStatus:      http.StatusInternalServerError,
			wantCode:        BusinessCodeInternalError,
			wantMessage:     "internal server error",
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			controller := NewGraphController(testCase.queryService, testCase.mutationService, 3)
			engine := gin.New()
			RegisterGraphRoutes(engine, controller, nil)

			request := httptest.NewRequest(testCase.method, testCase.target, bytes.NewReader(testCase.body))
			if len(testCase.body) > 0 {
				request.Header.Set("Content-Type", "application/json")
			}
			recorder := httptest.NewRecorder()

			engine.ServeHTTP(recorder, request)

			require.Equal(t, testCase.wantStatus, recorder.Code)

			var envelope Response[any]
			require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &envelope))
			assert.Equal(t, testCase.wantCode, envelope.Code)
			assert.Equal(t, testCase.wantMessage, envelope.Message)
		})
	}
}
