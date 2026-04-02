package graph

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newTestRepository(t *testing.T) *GormRepository {
	t.Helper()

	databasePath := filepath.Join(t.TempDir(), "repository.sqlite")
	database, err := gorm.Open(sqlite.Open(databasePath), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, database.AutoMigrate(&Node{}, &Edge{}))

	return NewGormRepository(database)
}

func TestPatchNodeMergesPropertyPatchWithoutDiscardingExistingKeys(t *testing.T) {
	repository := newTestRepository(t)
	ctx := context.Background()

	_, err := repository.CreateNode(ctx, &Node{
		ID:         "11111111-1111-1111-1111-111111111111",
		Type:       "text",
		Content:    "focus",
		X:          12,
		Y:          34,
		Collapsed:  false,
		Properties: JSONDocument(`{"color":"blue"}`),
	})
	require.NoError(t, err)

	node, err := repository.PatchNode(ctx, "11111111-1111-1111-1111-111111111111", NodePatch{
		PropertyPatch: map[string]any{
			"shape": "pill",
		},
	})

	require.NoError(t, err)
	assert.Equal(t, 12.0, node.X)
	assert.Equal(t, 34.0, node.Y)
	assert.False(t, node.Collapsed)
	properties := decodePropertiesForTest(t, node.Properties)
	assert.Equal(t, "blue", properties["color"])
	assert.Equal(t, "pill", properties["shape"])
}

func TestUpdateNodePositionPreservesOtherProperties(t *testing.T) {
	repository := newTestRepository(t)
	ctx := context.Background()

	_, err := repository.CreateNode(ctx, &Node{
		ID:         "11111111-1111-1111-1111-111111111111",
		Type:       "text",
		Content:    "focus",
		Collapsed:  true,
		Properties: JSONDocument(`{"color":"blue"}`),
	})
	require.NoError(t, err)

	node, err := repository.UpdateNodePosition(ctx, "11111111-1111-1111-1111-111111111111", 120.5, 240.25)

	require.NoError(t, err)
	assert.Equal(t, 120.5, node.X)
	assert.Equal(t, 240.25, node.Y)
	assert.True(t, node.Collapsed)
	properties := decodePropertiesForTest(t, node.Properties)
	assert.Equal(t, "blue", properties["color"])
}

func TestPatchNodeUpdatesCollapsedWithoutWritingLegacyProperties(t *testing.T) {
	repository := newTestRepository(t)
	ctx := context.Background()

	_, err := repository.CreateNode(ctx, &Node{
		ID:         "11111111-1111-1111-1111-111111111111",
		Type:       "text",
		Content:    "focus",
		X:          12,
		Y:          34,
		Collapsed:  false,
		Properties: JSONDocument(`{"color":"blue"}`),
	})
	require.NoError(t, err)

	node, err := repository.PatchNode(ctx, "11111111-1111-1111-1111-111111111111", NodePatch{
		Collapsed: boolPointer(true),
	})

	require.NoError(t, err)
	assert.True(t, node.Collapsed)
	assert.Equal(t, 12.0, node.X)
	assert.Equal(t, 34.0, node.Y)
	properties := decodePropertiesForTest(t, node.Properties)
	assert.Equal(t, "blue", properties["color"])
	_, hasCollapsed := properties["collapsed"]
	assert.False(t, hasCollapsed)
}

func TestPatchNodeIgnoresReservedLayoutKeysInPropertiesPatch(t *testing.T) {
	repository := newTestRepository(t)
	ctx := context.Background()

	_, err := repository.CreateNode(ctx, &Node{
		ID:         "11111111-1111-1111-1111-111111111111",
		Type:       "text",
		Content:    "focus",
		X:          12,
		Y:          34,
		Collapsed:  false,
		Properties: JSONDocument(`{"color":"blue"}`),
	})
	require.NoError(t, err)

	node, err := repository.PatchNode(ctx, "11111111-1111-1111-1111-111111111111", NodePatch{
		PropertyPatch: map[string]any{
			"x":         999.0,
			"y":         888.0,
			"collapsed": true,
			"shape":     "pill",
		},
	})

	require.NoError(t, err)
	assert.Equal(t, 12.0, node.X)
	assert.Equal(t, 34.0, node.Y)
	assert.False(t, node.Collapsed)

	properties := decodePropertiesForTest(t, node.Properties)
	assert.Equal(t, "blue", properties["color"])
	assert.Equal(t, "pill", properties["shape"])
	_, hasX := properties["x"]
	_, hasY := properties["y"]
	_, hasCollapsed := properties["collapsed"]
	assert.False(t, hasX)
	assert.False(t, hasY)
	assert.False(t, hasCollapsed)
}

func TestDeleteNodeReturnsFullIncidentEdgeSnapshot(t *testing.T) {
	repository := newTestRepository(t)
	ctx := context.Background()

	_, err := repository.CreateNode(ctx, &Node{
		ID:         "11111111-1111-1111-1111-111111111111",
		Type:       "text",
		Content:    "focus",
		X:          0,
		Y:          0,
		Properties: JSONDocument(`{}`),
	})
	require.NoError(t, err)
	_, err = repository.CreateNode(ctx, &Node{
		ID:         "22222222-2222-2222-2222-222222222222",
		Type:       "text",
		Content:    "left",
		X:          -10,
		Y:          0,
		Properties: JSONDocument(`{}`),
	})
	require.NoError(t, err)
	_, err = repository.CreateNode(ctx, &Node{
		ID:         "33333333-3333-3333-3333-333333333333",
		Type:       "text",
		Content:    "right",
		X:          10,
		Y:          0,
		Properties: JSONDocument(`{}`),
	})
	require.NoError(t, err)
	_, err = repository.CreateEdge(ctx, &Edge{
		ID:           "44444444-4444-4444-4444-444444444444",
		SourceID:     "22222222-2222-2222-2222-222222222222",
		TargetID:     "11111111-1111-1111-1111-111111111111",
		RelationType: "REFERENCE",
		Weight:       1,
		Properties:   JSONDocument(`{}`),
	})
	require.NoError(t, err)
	_, err = repository.CreateEdge(ctx, &Edge{
		ID:           "55555555-5555-5555-5555-555555555555",
		SourceID:     "11111111-1111-1111-1111-111111111111",
		TargetID:     "33333333-3333-3333-3333-333333333333",
		RelationType: "REFERENCE",
		Weight:       1,
		Properties:   JSONDocument(`{}`),
	})
	require.NoError(t, err)

	snapshot, err := repository.DeleteNode(ctx, "11111111-1111-1111-1111-111111111111")

	require.NoError(t, err)
	require.NotNil(t, snapshot)
	require.NotNil(t, snapshot.Node)
	assert.Equal(t, "11111111-1111-1111-1111-111111111111", snapshot.Node.ID)
	assert.Len(t, snapshot.Edges, 2)

	remainingNodes, err := repository.GetNodesByIDs(ctx, []string{"11111111-1111-1111-1111-111111111111"})
	require.NoError(t, err)
	assert.Empty(t, remainingNodes)

	remainingEdges, err := repository.GetEdgesByNodeIDs(ctx, []string{
		"11111111-1111-1111-1111-111111111111",
		"22222222-2222-2222-2222-222222222222",
		"33333333-3333-3333-3333-333333333333",
	})
	require.NoError(t, err)
	assert.Empty(t, remainingEdges)
}

func decodePropertiesForTest(t *testing.T, document JSONDocument) map[string]any {
	t.Helper()

	var properties map[string]any
	require.NoError(t, json.Unmarshal(document, &properties))
	return properties
}

func boolPointer(value bool) *bool {
	return &value
}
