package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	model "treemindmap/internal/graph"
	appservice "treemindmap/internal/service"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type stubQueryService struct{}

func (s *stubQueryService) FetchFocusGraph(ctx context.Context, focusNodeID string, maxDepth int) (*appservice.SubGraphDTO, error) {
	return &appservice.SubGraphDTO{
		Nodes: map[string]*model.Node{},
		Edges: map[string]*model.Edge{},
	}, nil
}

type stubMutationService struct {
	deleteNodeID         string
	deleteNodeErr        error
	deleteEdgeID         string
	deleteEdgeErr        error
	updateNodeID         string
	updateNodeContent    *string
	updateNodeProperties model.JSONDocument
	updateNodeErr        error
}

func (s *stubMutationService) CreateNode(ctx context.Context, node *model.Node) error {
	return nil
}

func (s *stubMutationService) CreateEdge(ctx context.Context, edge *model.Edge) error {
	return nil
}

func (s *stubMutationService) GetNodesByIDs(ctx context.Context, nodeIDs []string) ([]*model.Node, error) {
	return nil, nil
}

func (s *stubMutationService) DeleteNode(ctx context.Context, nodeID string) error {
	s.deleteNodeID = nodeID
	return s.deleteNodeErr
}

func (s *stubMutationService) DeleteEdge(ctx context.Context, edgeID string) error {
	s.deleteEdgeID = edgeID
	return s.deleteEdgeErr
}

func (s *stubMutationService) UpdateNode(ctx context.Context, nodeID string, content *string, properties model.JSONDocument) error {
	s.updateNodeID = nodeID
	s.updateNodeContent = content
	s.updateNodeProperties = append(model.JSONDocument(nil), properties...)
	return s.updateNodeErr
}

func (s *stubMutationService) UpdateNodePosition(ctx context.Context, nodeID string, x float64, y float64) error {
	return nil
}

func TestGetFocusGraphUsesURITagNameInValidationError(t *testing.T) {
	gin.SetMode(gin.TestMode)

	controller := NewGraphController(&stubQueryService{}, &stubMutationService{}, 3)
	engine := gin.New()
	RegisterGraphRoutes(engine, controller, nil)

	request := httptest.NewRequest(http.MethodGet, "/api/v1/graph/not-a-uuid?depth=1", nil)
	recorder := httptest.NewRecorder()

	engine.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d", recorder.Code)
	}

	responseBody := recorder.Body.String()
	if !strings.Contains(responseBody, "node_id failed on uuid") {
		t.Fatalf("expected response to contain tagged uri field name, got %s", responseBody)
	}
}

func TestCreateEdgeUsesJSONTagNamesInValidationError(t *testing.T) {
	gin.SetMode(gin.TestMode)

	controller := NewGraphController(&stubQueryService{}, &stubMutationService{}, 3)
	engine := gin.New()
	RegisterGraphRoutes(engine, controller, nil)

	requestBody := []byte(`{"id":"invalid","relation_type":"","target_id":"bad-value"}`)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/edges", bytes.NewReader(requestBody))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()

	engine.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d", recorder.Code)
	}

	responseBody := recorder.Body.String()
	expectedFragments := []string{
		"id failed on uuid",
		"relation_type failed on required",
		"source_id failed on required",
		"target_id failed on uuid",
	}

	for _, fragment := range expectedFragments {
		if !strings.Contains(responseBody, fragment) {
			t.Fatalf("expected response to contain %q, got %s", fragment, responseBody)
		}
	}
}

func TestSanitizedStackOmitsWorkspacePath(t *testing.T) {
	stack := sanitizedStack(8, 2048)
	if strings.Contains(stack, "/home/zz/workspace/projects/treemindmap") {
		t.Fatalf("expected sanitized stack to omit absolute workspace path, got %s", stack)
	}
}

func TestUpdateNodePreservesNilContentForPartialUpdate(t *testing.T) {
	gin.SetMode(gin.TestMode)

	mutationService := &stubMutationService{}
	controller := NewGraphController(&stubQueryService{}, mutationService, 3)
	engine := gin.New()
	RegisterGraphRoutes(engine, controller, nil)

	requestBody := []byte(`{"properties":{"x":120.5,"y":240.25}}`)
	request := httptest.NewRequest(http.MethodPut, "/api/v1/nodes/11111111-1111-1111-1111-111111111111", bytes.NewReader(requestBody))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()

	engine.ServeHTTP(recorder, request)

	require.Equal(t, http.StatusOK, recorder.Code)
	assert.Equal(t, "11111111-1111-1111-1111-111111111111", mutationService.updateNodeID)
	assert.Nil(t, mutationService.updateNodeContent)
	assert.JSONEq(t, `{"x":120.5,"y":240.25}`, string(mutationService.updateNodeProperties))

	var envelope Response[map[string]any]
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &envelope))
	assert.Equal(t, BusinessCodeSuccess, envelope.Code)
	assert.Equal(t, "success", envelope.Message)
	assert.Equal(t, "11111111-1111-1111-1111-111111111111", envelope.Data["id"])
	assert.Equal(t, "", envelope.Data["content"])
	properties, ok := envelope.Data["properties"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, 120.5, properties["x"])
	assert.Equal(t, 240.25, properties["y"])
}

func TestUpdateNodePassesExplicitEmptyStringContent(t *testing.T) {
	gin.SetMode(gin.TestMode)

	mutationService := &stubMutationService{}
	controller := NewGraphController(&stubQueryService{}, mutationService, 3)
	engine := gin.New()
	RegisterGraphRoutes(engine, controller, nil)

	requestBody := []byte(`{"content":"","properties":{"shape":"pill"}}`)
	request := httptest.NewRequest(http.MethodPut, "/api/v1/nodes/11111111-1111-1111-1111-111111111111", bytes.NewReader(requestBody))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()

	engine.ServeHTTP(recorder, request)

	require.Equal(t, http.StatusOK, recorder.Code)
	require.NotNil(t, mutationService.updateNodeContent)
	assert.Equal(t, "", *mutationService.updateNodeContent)
	assert.JSONEq(t, `{"shape":"pill"}`, string(mutationService.updateNodeProperties))
}

func TestDeleteNodeDelegatesToMutationService(t *testing.T) {
	gin.SetMode(gin.TestMode)

	mutationService := &stubMutationService{}
	controller := NewGraphController(&stubQueryService{}, mutationService, 3)
	engine := gin.New()
	RegisterGraphRoutes(engine, controller, nil)

	request := httptest.NewRequest(http.MethodDelete, "/api/v1/nodes/11111111-1111-1111-1111-111111111111", nil)
	recorder := httptest.NewRecorder()

	engine.ServeHTTP(recorder, request)

	require.Equal(t, http.StatusOK, recorder.Code)
	assert.Equal(t, "11111111-1111-1111-1111-111111111111", mutationService.deleteNodeID)
}

func TestDeleteEdgeDelegatesToMutationService(t *testing.T) {
	gin.SetMode(gin.TestMode)

	mutationService := &stubMutationService{}
	controller := NewGraphController(&stubQueryService{}, mutationService, 3)
	engine := gin.New()
	RegisterGraphRoutes(engine, controller, nil)

	request := httptest.NewRequest(http.MethodDelete, "/api/v1/edges/22222222-2222-2222-2222-222222222222", nil)
	recorder := httptest.NewRecorder()

	engine.ServeHTTP(recorder, request)

	require.Equal(t, http.StatusOK, recorder.Code)
	assert.Equal(t, "22222222-2222-2222-2222-222222222222", mutationService.deleteEdgeID)
}
