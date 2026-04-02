package service

import (
	"context"
	"testing"

	model "treemindmap/internal/graph"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

type mutationRepositoryBase struct{}

func (r *mutationRepositoryBase) CreateNode(ctx context.Context, node *model.Node) (*model.Node, error) {
	return node, nil
}

func (r *mutationRepositoryBase) CreateEdge(ctx context.Context, edge *model.Edge) (*model.Edge, error) {
	return edge, nil
}

func (r *mutationRepositoryBase) GetNodesByIDs(ctx context.Context, nodeIDs []string) ([]*model.Node, error) {
	return nil, nil
}

func (r *mutationRepositoryBase) GetEdgesByNodeIDs(ctx context.Context, nodeIDs []string) ([]*model.Edge, error) {
	return nil, nil
}

func (r *mutationRepositoryBase) GetAdjoiningNodes(ctx context.Context, nodeID string, relationType string, direction string) ([]*model.Node, error) {
	return nil, nil
}

func (r *mutationRepositoryBase) PatchNode(ctx context.Context, nodeID string, patch model.NodePatch) (*model.Node, error) {
	return nil, nil
}

func (r *mutationRepositoryBase) UpdateNodePosition(ctx context.Context, nodeID string, x float64, y float64) (*model.Node, error) {
	return &model.Node{ID: nodeID}, nil
}

func (r *mutationRepositoryBase) DeleteNode(ctx context.Context, nodeID string) (*model.NodeDeletionSnapshot, error) {
	return nil, nil
}

func (r *mutationRepositoryBase) DeleteEdge(ctx context.Context, edgeID string) error {
	return nil
}

type mutationRepositoryWithWrites struct {
	mutationRepositoryBase
	nodeResults          []*model.Node
	deleteNodeID         string
	deleteNodeErr        error
	deleteNodeSnapshot   *model.NodeDeletionSnapshot
	deleteEdgeID         string
	deleteEdgeErr        error
	patchNodeID          string
	patchNodeContent     *string
	patchNodeCollapsed   *bool
	patchNodeProperties  map[string]any
	patchNodeErr         error
}

func (r *mutationRepositoryWithWrites) GetNodesByIDs(ctx context.Context, nodeIDs []string) ([]*model.Node, error) {
	return r.nodeResults, nil
}

func (r *mutationRepositoryWithWrites) DeleteNode(ctx context.Context, nodeID string) (*model.NodeDeletionSnapshot, error) {
	r.deleteNodeID = nodeID
	if r.deleteNodeErr != nil {
		return nil, r.deleteNodeErr
	}

	return r.deleteNodeSnapshot, nil
}

func (r *mutationRepositoryWithWrites) DeleteEdge(ctx context.Context, edgeID string) error {
	r.deleteEdgeID = edgeID
	return r.deleteEdgeErr
}

func (r *mutationRepositoryWithWrites) PatchNode(ctx context.Context, nodeID string, patch model.NodePatch) (*model.Node, error) {
	r.patchNodeID = nodeID
	r.patchNodeContent = patch.Content
	r.patchNodeCollapsed = patch.Collapsed
	if patch.PropertyPatch != nil {
		r.patchNodeProperties = make(map[string]any, len(patch.PropertyPatch))
		for key, value := range patch.PropertyPatch {
			r.patchNodeProperties[key] = value
		}
	}
	if r.patchNodeErr != nil {
		return nil, r.patchNodeErr
	}

	return &model.Node{ID: nodeID}, nil
}

func TestGraphMutationServicePatchNodeDelegatesPartialPayload(t *testing.T) {
	emptyContent := ""

	testCases := []struct {
		name            string
		content         *string
		collapsed       *bool
		properties      map[string]any
		assertDelegated func(t *testing.T, repository *mutationRepositoryWithWrites)
	}{
		{
			name:       "omitted content remains nil",
			content:    nil,
			collapsed:  nil,
			properties: map[string]any{"shape": "pill"},
			assertDelegated: func(t *testing.T, repository *mutationRepositoryWithWrites) {
				assert.Nil(t, repository.patchNodeContent)
				assert.Nil(t, repository.patchNodeCollapsed)
				assert.Equal(t, "pill", repository.patchNodeProperties["shape"])
			},
		},
		{
			name:       "explicit empty string is preserved",
			content:    &emptyContent,
			collapsed:  boolPointer(true),
			properties: map[string]any{"shape": "pill"},
			assertDelegated: func(t *testing.T, repository *mutationRepositoryWithWrites) {
				require.NotNil(t, repository.patchNodeContent)
				assert.Equal(t, "", *repository.patchNodeContent)
				require.NotNil(t, repository.patchNodeCollapsed)
				assert.True(t, *repository.patchNodeCollapsed)
				assert.Equal(t, "pill", repository.patchNodeProperties["shape"])
			},
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			repository := &mutationRepositoryWithWrites{}
			service := NewGraphMutationService(repository, repository, repository)

			_, err := service.PatchNode(context.Background(), "11111111-1111-1111-1111-111111111111", model.NodePatch{
				Content:       testCase.content,
				Collapsed:     testCase.collapsed,
				PropertyPatch: testCase.properties,
			})

			require.NoError(t, err)
			assert.Equal(t, "11111111-1111-1111-1111-111111111111", repository.patchNodeID)
			testCase.assertDelegated(t, repository)
		})
	}
}

func boolPointer(value bool) *bool {
	return &value
}

func TestGraphMutationServiceCreateEdgeValidatesReferencedNodes(t *testing.T) {
	repository := &mutationRepositoryWithWrites{
		nodeResults: []*model.Node{
			{ID: "11111111-1111-1111-1111-111111111111"},
		},
	}
	service := NewGraphMutationService(repository, repository, repository)

	_, err := service.CreateEdge(context.Background(), &model.Edge{
		ID:           "33333333-3333-3333-3333-333333333333",
		SourceID:     "11111111-1111-1111-1111-111111111111",
		TargetID:     "22222222-2222-2222-2222-222222222222",
		RelationType: "REFERENCE",
		Weight:       1,
	})

	require.Error(t, err)
	assert.ErrorIs(t, err, ErrTargetNodeNotFound)
}

func TestGraphMutationServiceMapsRecordNotFoundErrors(t *testing.T) {
	testCases := []struct {
		name      string
		invoke    func(service *GraphMutationService) error
		wantError error
	}{
		{
			name: "delete node maps not found",
			invoke: func(service *GraphMutationService) error {
				_, err := service.DeleteNode(context.Background(), "11111111-1111-1111-1111-111111111111")
				return err
			},
			wantError: ErrNodeNotFound,
		},
		{
			name: "delete edge maps not found",
			invoke: func(service *GraphMutationService) error {
				return service.DeleteEdge(context.Background(), "22222222-2222-2222-2222-222222222222")
			},
			wantError: ErrEdgeNotFound,
		},
		{
			name: "patch node maps not found",
			invoke: func(service *GraphMutationService) error {
				_, err := service.PatchNode(context.Background(), "33333333-3333-3333-3333-333333333333", model.NodePatch{})
				return err
			},
			wantError: ErrNodeNotFound,
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			repository := &mutationRepositoryWithWrites{
				deleteNodeErr: gorm.ErrRecordNotFound,
				deleteEdgeErr: gorm.ErrRecordNotFound,
				patchNodeErr:  gorm.ErrRecordNotFound,
			}
			service := NewGraphMutationService(repository, repository, repository)

			err := testCase.invoke(service)

			require.Error(t, err)
			assert.ErrorIs(t, err, testCase.wantError)
		})
	}
}

func TestGraphMutationServiceRejectsIncompleteRepositoryDependencies(t *testing.T) {
	service := NewGraphMutationService(nil, nil, nil)

	_, err := service.DeleteNode(context.Background(), "11111111-1111-1111-1111-111111111111")
	require.Error(t, err)
	assert.ErrorContains(t, err, "command repository")

	err = service.DeleteEdge(context.Background(), "22222222-2222-2222-2222-222222222222")
	require.Error(t, err)
	assert.ErrorContains(t, err, "command repository")

	_, err = service.PatchNode(context.Background(), "33333333-3333-3333-3333-333333333333", model.NodePatch{})
	require.Error(t, err)
	assert.ErrorContains(t, err, "command repository")
}
