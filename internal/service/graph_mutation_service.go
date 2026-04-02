package service

import (
	"context"
	"fmt"
	"strings"

	model "treemindmap/internal/graph"
	shared "treemindmap/shared"
)

// GraphMutationService coordinates graph writes against the repository layer.
type GraphMutationService struct {
	queryRepository     model.GraphQueryRepository
	commandRepository   model.GraphCommandRepository
	traversalRepository model.GraphTraversalRepository
}

// NewGraphMutationService constructs a mutation service with the repository used for writes.
func NewGraphMutationService(
	queryRepository model.GraphQueryRepository,
	commandRepository model.GraphCommandRepository,
	traversalRepository model.GraphTraversalRepository,
) *GraphMutationService {
	return &GraphMutationService{
		queryRepository:     queryRepository,
		commandRepository:   commandRepository,
		traversalRepository: traversalRepository,
	}
}

func (s *GraphMutationService) CreateNode(ctx context.Context, node *model.Node) (*model.Node, error) {
	if ctx == nil {
		return nil, ErrNilContext
	}

	if s == nil || s.commandRepository == nil {
		return nil, fmt.Errorf("service: nil command repository")
	}

	if node == nil || node.ID == "" {
		return nil, ErrNodeNotFound
	}

	return s.commandRepository.CreateNode(ctx, node)
}

func (s *GraphMutationService) CreateEdge(ctx context.Context, edge *model.Edge) (*model.Edge, error) {
	if ctx == nil {
		return nil, ErrNilContext
	}

	if s == nil || s.commandRepository == nil || s.queryRepository == nil {
		return nil, fmt.Errorf("service: incomplete repository dependencies")
	}

	if edge == nil || edge.ID == "" {
		return nil, fmt.Errorf("service: invalid edge")
	}

	referencedNodes, err := s.queryRepository.GetNodesByIDs(ctx, []string{edge.SourceID, edge.TargetID})
	if err != nil {
		return nil, err
	}

	nodeSet := make(map[string]struct{}, len(referencedNodes))
	for _, node := range referencedNodes {
		if node == nil || node.ID == "" {
			continue
		}

		nodeSet[node.ID] = struct{}{}
	}

	if _, exists := nodeSet[edge.SourceID]; !exists {
		return nil, ErrSourceNodeNotFound
	}
	if _, exists := nodeSet[edge.TargetID]; !exists {
		return nil, ErrTargetNodeNotFound
	}

	if relationTypeRequiresAcyclicConstraint(edge.RelationType) {
		if s.traversalRepository == nil {
			return nil, fmt.Errorf("service: nil traversal repository")
		}

		if edge.SourceID == edge.TargetID {
			return nil, ErrCyclicDependency
		}

		createsCycle, err := s.createsCycle(ctx, edge.SourceID, edge.TargetID, edge.RelationType)
		if err != nil {
			return nil, err
		}

		if createsCycle {
			return nil, ErrCyclicDependency
		}
	}

	return s.commandRepository.CreateEdge(ctx, edge)
}

func (s *GraphMutationService) GetNodesByIDs(ctx context.Context, nodeIDs []string) ([]*model.Node, error) {
	if ctx == nil {
		return nil, ErrNilContext
	}

	if s == nil || s.queryRepository == nil {
		return nil, fmt.Errorf("service: nil query repository")
	}

	return s.queryRepository.GetNodesByIDs(ctx, nodeIDs)
}

func (s *GraphMutationService) DeleteNode(ctx context.Context, nodeID string) (*model.NodeDeletionSnapshot, error) {
	if ctx == nil {
		return nil, ErrNilContext
	}

	if s == nil || s.commandRepository == nil {
		return nil, fmt.Errorf("service: nil command repository")
	}

	snapshot, err := s.commandRepository.DeleteNode(ctx, nodeID)
	if err != nil {
		if model.IsRecordNotFound(err) {
			return nil, ErrNodeNotFound
		}
		return nil, err
	}

	return snapshot, nil
}

func (s *GraphMutationService) DeleteEdge(ctx context.Context, edgeID string) error {
	if ctx == nil {
		return ErrNilContext
	}

	if s == nil || s.commandRepository == nil {
		return fmt.Errorf("service: nil command repository")
	}

	if err := s.commandRepository.DeleteEdge(ctx, edgeID); err != nil {
		if model.IsRecordNotFound(err) {
			return ErrEdgeNotFound
		}
		return err
	}

	return nil
}

func (s *GraphMutationService) PatchNode(ctx context.Context, nodeID string, patch model.NodePatch) (*model.Node, error) {
	if ctx == nil {
		return nil, ErrNilContext
	}

	if s == nil || s.commandRepository == nil {
		return nil, fmt.Errorf("service: nil command repository")
	}

	node, err := s.commandRepository.PatchNode(ctx, nodeID, patch)
	if err != nil {
		if model.IsRecordNotFound(err) {
			return nil, ErrNodeNotFound
		}
		return nil, err
	}

	return node, nil
}

func (s *GraphMutationService) UpdateNodePosition(ctx context.Context, nodeID string, x float64, y float64) (*model.Node, error) {
	if ctx == nil {
		return nil, ErrNilContext
	}

	if s == nil || s.commandRepository == nil {
		return nil, fmt.Errorf("service: nil command repository")
	}

	node, err := s.commandRepository.UpdateNodePosition(ctx, nodeID, x, y)
	if err != nil {
		if model.IsRecordNotFound(err) {
			return nil, ErrNodeNotFound
		}
		return nil, err
	}

	return node, nil
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

		adjoiningNodes, err := s.traversalRepository.GetAdjoiningNodes(ctx, currentNodeID, relationType, model.DirectionOut)
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
	definition, ok := shared.LookupRelationDefinition(strings.TrimSpace(relationType))
	return ok && definition.IsAcyclic
}
