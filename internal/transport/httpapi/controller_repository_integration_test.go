package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	model "treemindmap/internal/graph"
	appservice "treemindmap/internal/service"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type integrationHarness struct {
	engine     *gin.Engine
	repository *model.GormRepository
}

func newIntegrationHarness(t *testing.T) integrationHarness {
	t.Helper()

	databasePath := filepath.Join(t.TempDir(), "httpapi.sqlite")
	database, err := gorm.Open(sqlite.Open(databasePath), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, database.AutoMigrate(&model.Node{}, &model.Edge{}))

	repository := model.NewGormRepository(database)
	queryService := appservice.NewGraphQueryService(repository)
	mutationService := appservice.NewGraphMutationService(repository, repository, repository)
	controller := NewGraphController(queryService, mutationService, 3)

	engine := gin.New()
	RegisterGraphRoutes(engine, controller, nil)

	return integrationHarness{
		engine:     engine,
		repository: repository,
	}
}

func TestPatchNodeMergesPropertyPatchAgainstStoredNode(t *testing.T) {
	harness := newIntegrationHarness(t)

	_, err := harness.repository.CreateNode(context.Background(), &model.Node{
		ID:         "11111111-1111-1111-1111-111111111111",
		Type:       "text",
		Content:    "focus",
		Properties: model.JSONDocument(`{"x":12,"y":34,"collapsed":false,"color":"blue"}`),
	})
	require.NoError(t, err)

	requestBody := []byte(`{"properties":{"collapsed":true}}`)
	request := httptest.NewRequest(http.MethodPatch, "/api/v1/nodes/11111111-1111-1111-1111-111111111111", bytes.NewReader(requestBody))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()

	harness.engine.ServeHTTP(recorder, request)

	require.Equal(t, http.StatusOK, recorder.Code)

	nodes, err := harness.repository.GetNodesByIDs(context.Background(), []string{"11111111-1111-1111-1111-111111111111"})
	require.NoError(t, err)
	require.Len(t, nodes, 1)

	var properties map[string]any
	require.NoError(t, json.Unmarshal(nodes[0].Properties, &properties))
	assert.Equal(t, 12.0, properties["x"])
	assert.Equal(t, 34.0, properties["y"])
	assert.Equal(t, true, properties["collapsed"])
	assert.Equal(t, "blue", properties["color"])
}

func TestDeleteNodeReturnsIncidentEdgesInResponse(t *testing.T) {
	harness := newIntegrationHarness(t)

	_, err := harness.repository.CreateNode(context.Background(), &model.Node{
		ID:         "11111111-1111-1111-1111-111111111111",
		Type:       "text",
		Content:    "focus",
		Properties: model.JSONDocument(`{"x":0,"y":0}`),
	})
	require.NoError(t, err)
	_, err = harness.repository.CreateNode(context.Background(), &model.Node{
		ID:         "22222222-2222-2222-2222-222222222222",
		Type:       "text",
		Content:    "child",
		Properties: model.JSONDocument(`{"x":10,"y":10}`),
	})
	require.NoError(t, err)
	_, err = harness.repository.CreateEdge(context.Background(), &model.Edge{
		ID:           "33333333-3333-3333-3333-333333333333",
		SourceID:     "11111111-1111-1111-1111-111111111111",
		TargetID:     "22222222-2222-2222-2222-222222222222",
		RelationType: "REFERENCE",
		Weight:       1,
		Properties:   model.JSONDocument(`{}`),
	})
	require.NoError(t, err)

	request := httptest.NewRequest(http.MethodDelete, "/api/v1/nodes/11111111-1111-1111-1111-111111111111", nil)
	recorder := httptest.NewRecorder()

	harness.engine.ServeHTTP(recorder, request)

	require.Equal(t, http.StatusOK, recorder.Code)

	var envelope Response[NodeDeletionSnapshotVO]
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &envelope))
	assert.Equal(t, "11111111-1111-1111-1111-111111111111", envelope.Data.Node.ID)
	require.Len(t, envelope.Data.Edges, 1)
	assert.Equal(t, "33333333-3333-3333-3333-333333333333", envelope.Data.Edges[0].ID)
}
