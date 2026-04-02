package graph

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newBackfillTestDatabase(t *testing.T) *gorm.DB {
	t.Helper()

	databasePath := filepath.Join(t.TempDir(), "backfill.sqlite")
	database, err := gorm.Open(sqlite.Open(databasePath), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, database.AutoMigrate(&Node{}, &Edge{}, &AppMigration{}))

	return database
}

func TestBackfillLegacyNodeLayoutColumnsBackfillsOnceAndMarksMigration(t *testing.T) {
	database := newBackfillTestDatabase(t)
	repository := NewGormRepository(database)
	ctx := context.Background()

	_, err := repository.CreateNode(ctx, &Node{
		ID:         "11111111-1111-1111-1111-111111111111",
		Type:       "text",
		Content:    "legacy",
		X:          0,
		Y:          0,
		Collapsed:  false,
		Properties: JSONDocument(`{"x":120.5,"y":240.25,"collapsed":true,"color":"blue"}`),
	})
	require.NoError(t, err)

	firstResult, err := BackfillLegacyNodeLayoutColumns(ctx, database)
	require.NoError(t, err)
	assert.Equal(t, NodeLayoutBackfillMigrationID, firstResult.MigrationID)
	assert.False(t, firstResult.Skipped)
	assert.Equal(t, 1, firstResult.TotalNodes)
	assert.Equal(t, 1, firstResult.UpdatedNodes)
	assert.Equal(t, 0, firstResult.InvalidPropertyRows)

	nodes, err := repository.GetNodesByIDs(ctx, []string{"11111111-1111-1111-1111-111111111111"})
	require.NoError(t, err)
	require.Len(t, nodes, 1)
	assert.Equal(t, 120.5, nodes[0].X)
	assert.Equal(t, 240.25, nodes[0].Y)
	assert.True(t, nodes[0].Collapsed)

	secondResult, err := BackfillLegacyNodeLayoutColumns(ctx, database)
	require.NoError(t, err)
	assert.Equal(t, NodeLayoutBackfillMigrationID, secondResult.MigrationID)
	assert.True(t, secondResult.Skipped)
	assert.Equal(t, 0, secondResult.TotalNodes)
	assert.Equal(t, 0, secondResult.UpdatedNodes)
	assert.Equal(t, 0, secondResult.InvalidPropertyRows)
}

func TestBackfillLegacyNodeLayoutColumnsSkipsInvalidLegacyPropertyRows(t *testing.T) {
	database := newBackfillTestDatabase(t)
	repository := NewGormRepository(database)
	ctx := context.Background()

	_, err := repository.CreateNode(ctx, &Node{
		ID:         "11111111-1111-1111-1111-111111111111",
		Type:       "text",
		Content:    "invalid-json-shape",
		X:          15,
		Y:          25,
		Collapsed:  false,
		Properties: JSONDocument(`[1,2,3]`),
	})
	require.NoError(t, err)
	_, err = repository.CreateNode(ctx, &Node{
		ID:         "22222222-2222-2222-2222-222222222222",
		Type:       "text",
		Content:    "invalid-value-type",
		X:          10,
		Y:          20,
		Collapsed:  false,
		Properties: JSONDocument(`{"x":"oops","y":88,"collapsed":false}`),
	})
	require.NoError(t, err)

	result, err := BackfillLegacyNodeLayoutColumns(ctx, database)
	require.NoError(t, err)
	assert.False(t, result.Skipped)
	assert.Equal(t, 2, result.TotalNodes)
	assert.Equal(t, 1, result.UpdatedNodes)
	assert.Equal(t, 2, result.InvalidPropertyRows)

	nodes, err := repository.GetNodesByIDs(ctx, []string{
		"11111111-1111-1111-1111-111111111111",
		"22222222-2222-2222-2222-222222222222",
	})
	require.NoError(t, err)
	require.Len(t, nodes, 2)

	nodeByID := map[string]*Node{}
	for _, node := range nodes {
		nodeByID[node.ID] = node
	}

	assert.Equal(t, 15.0, nodeByID["11111111-1111-1111-1111-111111111111"].X)
	assert.Equal(t, 25.0, nodeByID["11111111-1111-1111-1111-111111111111"].Y)
	assert.False(t, nodeByID["11111111-1111-1111-1111-111111111111"].Collapsed)

	assert.Equal(t, 10.0, nodeByID["22222222-2222-2222-2222-222222222222"].X)
	assert.Equal(t, 88.0, nodeByID["22222222-2222-2222-2222-222222222222"].Y)
	assert.False(t, nodeByID["22222222-2222-2222-2222-222222222222"].Collapsed)
}
