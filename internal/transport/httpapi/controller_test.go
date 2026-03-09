package httpapi

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	model "treemindmap/internal/graph"
	appservice "treemindmap/internal/service"

	"github.com/gin-gonic/gin"
)

type stubQueryService struct{}

func (s *stubQueryService) FetchFocusGraph(ctx context.Context, focusNodeID string, maxDepth int) (*appservice.SubGraphDTO, error) {
	return &appservice.SubGraphDTO{
		Nodes: map[string]*model.Node{},
		Edges: map[string]*model.Edge{},
	}, nil
}

type stubMutationService struct{}

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
	return nil
}

func (s *stubMutationService) DeleteEdge(ctx context.Context, edgeID string) error {
	return nil
}

func (s *stubMutationService) UpdateNode(ctx context.Context, nodeID string, content *string, properties model.JSONDocument) error {
	return nil
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
