package service

import (
	"context"
	"fmt"
	"strings"

	model "treemindmap/internal/graph"
)

type nodePositionUpdater interface {
	UpdateNodePosition(ctx context.Context, nodeID string, x float64, y float64) error
}

// GraphMutationService coordinates graph writes against the repository layer.
type GraphMutationService struct {
	repository model.GraphRepository
}

// NewGraphMutationService constructs a mutation service with the repository used for writes.
func NewGraphMutationService(repository model.GraphRepository) *GraphMutationService {
	return &GraphMutationService{repository: repository}
}

func (s *GraphMutationService) CreateNode(ctx context.Context, node *model.Node) error {
	if ctx == nil {
		return ErrNilContext
	}

	if s == nil || s.repository == nil {
		return fmt.Errorf("service: nil repository")
	}

	if node == nil || node.ID == "" {
		return ErrNodeNotFound
	}

	return s.repository.CreateNode(ctx, node)
}

func (s *GraphMutationService) CreateEdge(ctx context.Context, edge *model.Edge) error {
	if ctx == nil {
		return ErrNilContext
	}

	if s == nil || s.repository == nil {
		return fmt.Errorf("service: nil repository")
	}

	if edge == nil || edge.ID == "" {
		return fmt.Errorf("service: invalid edge")
	}

	if relationTypeRequiresAcyclicConstraint(edge.RelationType) {
		if edge.SourceID == edge.TargetID {
			return ErrCyclicDependency
		}

		createsCycle, err := s.createsCycle(ctx, edge.SourceID, edge.TargetID, edge.RelationType)
		if err != nil {
			return err
		}

		if createsCycle {
			return ErrCyclicDependency
		}
	}

	return s.repository.CreateEdge(ctx, edge)
}

func (s *GraphMutationService) GetNodesByIDs(ctx context.Context, nodeIDs []string) ([]*model.Node, error) {
	if ctx == nil {
		return nil, ErrNilContext
	}

	if s == nil || s.repository == nil {
		return nil, fmt.Errorf("service: nil repository")
	}

	return s.repository.GetNodesByIDs(ctx, nodeIDs)
}

func (s *GraphMutationService) UpdateNodePosition(ctx context.Context, nodeID string, x float64, y float64) error {
	if ctx == nil {
		return ErrNilContext
	}

	if s == nil || s.repository == nil {
		return fmt.Errorf("service: nil repository")
	}

	updater, ok := s.repository.(nodePositionUpdater)
	if !ok {
		return fmt.Errorf("service: node position updates are not supported by repository")
	}

	if err := updater.UpdateNodePosition(ctx, nodeID, x, y); err != nil {
		if model.IsRecordNotFound(err) {
			return ErrNodeNotFound
		}
		return err
	}

	return nil
}

func (s *GraphMutationService) createsCycle(ctx context.Context, sourceNodeID string, targetNodeID string, relationType string) (bool, error) {
	if sourceNodeID == "" || targetNodeID == "" {
		return false, nil
	}

	visited := map[string]struct{}{
		targetNodeID: {},
	}
	queue := []string{targetNodeID}

	for len(queue) > 0 {
		currentNodeID := queue[0]
		queue = queue[1:]

		if currentNodeID == sourceNodeID {
			return true, nil
		}

		adjoiningNodes, err := s.repository.GetAdjoiningNodes(ctx, currentNodeID, relationType, model.DirectionOut)
		if err != nil {
			return false, err
		}

		for _, node := range adjoiningNodes {
			if node == nil || node.ID == "" {
				continue
			}

			if _, exists := visited[node.ID]; exists {
				continue
			}

			visited[node.ID] = struct{}{}
			queue = append(queue, node.ID)
		}
	}

	return false, nil
}

func relationTypeRequiresAcyclicConstraint(relationType string) bool {
	switch strings.ToUpper(strings.TrimSpace(relationType)) {
	case "BELONGS_TO", "PARENT_CHILD", "DEPENDS_ON", "CONTAINS":
		return true
	default:
		return false
	}
}
