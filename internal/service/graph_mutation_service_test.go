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

func (r *mutationRepositoryBase) CreateNode(ctx context.Context, node *model.Node) error {
	return nil
}

func (r *mutationRepositoryBase) CreateEdge(ctx context.Context, edge *model.Edge) error {
	return nil
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

type mutationRepositoryWithWrites struct {
	mutationRepositoryBase
	deleteNodeID         string
	deleteNodeErr        error
	deleteEdgeID         string
	deleteEdgeErr        error
	updateNodeID         string
	updateNodeContent    *string
	updateNodeProperties model.JSONDocument
	updateNodeErr        error
}

func (r *mutationRepositoryWithWrites) DeleteNode(ctx context.Context, nodeID string) error {
	r.deleteNodeID = nodeID
	return r.deleteNodeErr
}

func (r *mutationRepositoryWithWrites) DeleteEdge(ctx context.Context, edgeID string) error {
	r.deleteEdgeID = edgeID
	return r.deleteEdgeErr
}

func (r *mutationRepositoryWithWrites) UpdateNode(ctx context.Context, nodeID string, content *string, properties model.JSONDocument) error {
	r.updateNodeID = nodeID
	r.updateNodeContent = content
	r.updateNodeProperties = append(model.JSONDocument(nil), properties...)
	return r.updateNodeErr
}

func TestGraphMutationServiceUpdateNodeDelegatesPartialPayload(t *testing.T) {
	emptyContent := ""

	testCases := []struct {
		name            string
		content         *string
		properties      model.JSONDocument
		assertDelegated func(t *testing.T, repository *mutationRepositoryWithWrites)
	}{
		{
			name:       "omitted content remains nil",
			content:    nil,
			properties: model.JSONDocument(`{"x":12,"y":34}`),
			assertDelegated: func(t *testing.T, repository *mutationRepositoryWithWrites) {
				assert.Nil(t, repository.updateNodeContent)
				assert.JSONEq(t, `{"x":12,"y":34}`, string(repository.updateNodeProperties))
			},
		},
		{
			name:       "explicit empty string is preserved",
			content:    &emptyContent,
			properties: model.JSONDocument(`{"shape":"pill"}`),
			assertDelegated: func(t *testing.T, repository *mutationRepositoryWithWrites) {
				require.NotNil(t, repository.updateNodeContent)
				assert.Equal(t, "", *repository.updateNodeContent)
				assert.JSONEq(t, `{"shape":"pill"}`, string(repository.updateNodeProperties))
			},
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			repository := &mutationRepositoryWithWrites{}
			service := NewGraphMutationService(repository)

			err := service.UpdateNode(context.Background(), "11111111-1111-1111-1111-111111111111", testCase.content, testCase.properties)

			require.NoError(t, err)
			assert.Equal(t, "11111111-1111-1111-1111-111111111111", repository.updateNodeID)
			testCase.assertDelegated(t, repository)
		})
	}
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
				return service.DeleteNode(context.Background(), "11111111-1111-1111-1111-111111111111")
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
			name: "update node maps not found",
			invoke: func(service *GraphMutationService) error {
				return service.UpdateNode(context.Background(), "33333333-3333-3333-3333-333333333333", nil, model.JSONDocument(`{}`))
			},
			wantError: ErrNodeNotFound,
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			repository := &mutationRepositoryWithWrites{
				deleteNodeErr: gorm.ErrRecordNotFound,
				deleteEdgeErr: gorm.ErrRecordNotFound,
				updateNodeErr: gorm.ErrRecordNotFound,
			}
			service := NewGraphMutationService(repository)

			err := testCase.invoke(service)

			require.Error(t, err)
			assert.ErrorIs(t, err, testCase.wantError)
		})
	}
}

func TestGraphMutationServiceRejectsUnsupportedMutationContracts(t *testing.T) {
	service := NewGraphMutationService(&mutationRepositoryBase{})

	err := service.DeleteNode(context.Background(), "11111111-1111-1111-1111-111111111111")
	require.Error(t, err)
	assert.ErrorContains(t, err, "node deletion is not supported")

	err = service.DeleteEdge(context.Background(), "22222222-2222-2222-2222-222222222222")
	require.Error(t, err)
	assert.ErrorContains(t, err, "edge deletion is not supported")

	err = service.UpdateNode(context.Background(), "33333333-3333-3333-3333-333333333333", nil, model.JSONDocument(`{}`))
	require.Error(t, err)
	assert.ErrorContains(t, err, "node updates are not supported")
}
