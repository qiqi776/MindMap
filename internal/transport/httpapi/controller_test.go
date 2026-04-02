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
	deleteNodeID        string
	deleteNodeErr       error
	deleteNodeSnapshot  *model.NodeDeletionSnapshot
	deleteEdgeID        string
	deleteEdgeErr       error
	patchNodeID         string
	patchNodeContent    *string
	patchNodeCollapsed  *bool
	patchNodeProperties map[string]any
	patchNodeErr        error
}

func (s *stubMutationService) CreateNode(ctx context.Context, node *model.Node) (*model.Node, error) {
	return node, nil
}

func (s *stubMutationService) CreateEdge(ctx context.Context, edge *model.Edge) (*model.Edge, error) {
	return edge, nil
}

func (s *stubMutationService) DeleteNode(ctx context.Context, nodeID string) (*model.NodeDeletionSnapshot, error) {
	s.deleteNodeID = nodeID
	if s.deleteNodeErr != nil {
		return nil, s.deleteNodeErr
	}

	if s.deleteNodeSnapshot != nil {
		return s.deleteNodeSnapshot, nil
	}

	return &model.NodeDeletionSnapshot{
		Node: &model.Node{ID: nodeID, Type: "text", Content: "deleted", Properties: model.JSONDocument(`{"x":0,"y":0}`)},
	}, nil
}

func (s *stubMutationService) DeleteEdge(ctx context.Context, edgeID string) error {
	s.deleteEdgeID = edgeID
	return s.deleteEdgeErr
}

func (s *stubMutationService) PatchNode(ctx context.Context, nodeID string, patch model.NodePatch) (*model.Node, error) {
	s.patchNodeID = nodeID
	s.patchNodeContent = patch.Content
	s.patchNodeCollapsed = patch.Collapsed
	if patch.PropertyPatch != nil {
		s.patchNodeProperties = make(map[string]any, len(patch.PropertyPatch))
		for key, value := range patch.PropertyPatch {
			s.patchNodeProperties[key] = value
		}
	}
	if s.patchNodeErr != nil {
		return nil, s.patchNodeErr
	}

	content := "existing node"
	if patch.Content != nil {
		content = *patch.Content
	}
	collapsed := false
	if patch.Collapsed != nil {
		collapsed = *patch.Collapsed
	}

	properties := model.JSONDocument(`{}`)
	if patch.PropertyPatch != nil {
		encodedProperties, err := json.Marshal(patch.PropertyPatch)
		if err != nil {
			return nil, err
		}
		properties = model.JSONDocument(encodedProperties)
	}

	return &model.Node{
		ID:         nodeID,
		Type:       "text",
		Content:    content,
		X:          120.5,
		Y:          240.25,
		Collapsed:  collapsed,
		Properties: properties,
	}, nil
}

func (s *stubMutationService) UpdateNodePosition(ctx context.Context, nodeID string, x float64, y float64) (*model.Node, error) {
	return &model.Node{
		ID:         nodeID,
		Type:       "text",
		Content:    "positioned",
		X:          120.5,
		Y:          240.25,
		Collapsed:  false,
		Properties: model.JSONDocument(`{}`),
	}, nil
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

func TestCreateNodeRequiresCanonicalCoordinates(t *testing.T) {
	gin.SetMode(gin.TestMode)

	controller := NewGraphController(&stubQueryService{}, &stubMutationService{}, 3)
	engine := gin.New()
	RegisterGraphRoutes(engine, controller, nil)

	requestBody := []byte(`{"id":"11111111-1111-1111-1111-111111111111","type":"text","content":"root","properties":{"shape":"pill"}}`)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/nodes", bytes.NewReader(requestBody))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()

	engine.ServeHTTP(recorder, request)

	require.Equal(t, http.StatusBadRequest, recorder.Code)
	responseBody := recorder.Body.String()
	assert.Contains(t, responseBody, "x failed on required")
	assert.Contains(t, responseBody, "y failed on required")
}

func TestSanitizedStackOmitsWorkspacePath(t *testing.T) {
	stack := sanitizedStack(8, 2048)
	if strings.Contains(stack, "/home/zz/workspace/projects/treemindmap") {
		t.Fatalf("expected sanitized stack to omit absolute workspace path, got %s", stack)
	}
}

func TestPatchNodePreservesNilContentForPartialUpdate(t *testing.T) {
	gin.SetMode(gin.TestMode)

	mutationService := &stubMutationService{}
	controller := NewGraphController(&stubQueryService{}, mutationService, 3)
	engine := gin.New()
	RegisterGraphRoutes(engine, controller, nil)

	requestBody := []byte(`{"collapsed":true,"properties":{"shape":"pill"}}`)
	request := httptest.NewRequest(http.MethodPatch, "/api/v1/nodes/11111111-1111-1111-1111-111111111111", bytes.NewReader(requestBody))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()

	engine.ServeHTTP(recorder, request)

	require.Equal(t, http.StatusOK, recorder.Code)
	assert.Equal(t, "11111111-1111-1111-1111-111111111111", mutationService.patchNodeID)
	assert.Nil(t, mutationService.patchNodeContent)
	require.NotNil(t, mutationService.patchNodeCollapsed)
	assert.True(t, *mutationService.patchNodeCollapsed)
	assert.Equal(t, "pill", mutationService.patchNodeProperties["shape"])

	var envelope Response[map[string]any]
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &envelope))
	assert.Equal(t, BusinessCodeSuccess, envelope.Code)
	assert.Equal(t, "success", envelope.Message)
	assert.Equal(t, "11111111-1111-1111-1111-111111111111", envelope.Data["id"])
	assert.Equal(t, "existing node", envelope.Data["content"])
	assert.Equal(t, 120.5, envelope.Data["x"])
	assert.Equal(t, 240.25, envelope.Data["y"])
	assert.Equal(t, true, envelope.Data["collapsed"])
	properties, ok := envelope.Data["properties"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "pill", properties["shape"])
}

func TestPatchNodePassesExplicitEmptyStringContent(t *testing.T) {
	gin.SetMode(gin.TestMode)

	mutationService := &stubMutationService{}
	controller := NewGraphController(&stubQueryService{}, mutationService, 3)
	engine := gin.New()
	RegisterGraphRoutes(engine, controller, nil)

	requestBody := []byte(`{"content":"","properties":{"shape":"pill"}}`)
	request := httptest.NewRequest(http.MethodPatch, "/api/v1/nodes/11111111-1111-1111-1111-111111111111", bytes.NewReader(requestBody))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()

	engine.ServeHTTP(recorder, request)

	require.Equal(t, http.StatusOK, recorder.Code)
	require.NotNil(t, mutationService.patchNodeContent)
	assert.Equal(t, "", *mutationService.patchNodeContent)
	assert.Equal(t, "pill", mutationService.patchNodeProperties["shape"])
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
