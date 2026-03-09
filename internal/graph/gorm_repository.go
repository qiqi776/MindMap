package graph

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"gorm.io/gorm"
)

// GormRepository implements GraphRepository against a MySQL-compatible GORM DB handle.
type GormRepository struct {
	db *gorm.DB
}

// NewGormRepository constructs a repository backed by GORM.
func NewGormRepository(db *gorm.DB) *GormRepository {
	return &GormRepository{db: db}
}

func (r *GormRepository) CreateNode(ctx context.Context, node *Node) error {
	if r == nil || r.db == nil {
		return fmt.Errorf("graph: nil database handle")
	}

	if node == nil {
		return fmt.Errorf("graph: nil node")
	}

	return r.db.WithContext(ctx).Create(node).Error
}

func (r *GormRepository) CreateEdge(ctx context.Context, edge *Edge) error {
	if r == nil || r.db == nil {
		return fmt.Errorf("graph: nil database handle")
	}

	if edge == nil {
		return fmt.Errorf("graph: nil edge")
	}

	return r.db.WithContext(ctx).Create(edge).Error
}

// DeleteNode performs transactional cascading cleanup for one node and all
// incident edges to preserve referential integrity under concurrent writes.
func (r *GormRepository) DeleteNode(ctx context.Context, nodeID string) error {
	if r == nil || r.db == nil {
		return fmt.Errorf("graph: nil database handle")
	}

	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.WithContext(ctx).
			Where("source_id = ? OR target_id = ?", nodeID, nodeID).
			Delete(&Edge{}).Error; err != nil {
			return err
		}

		result := tx.WithContext(ctx).
			Where("id = ?", nodeID).
			Delete(&Node{})
		if result.Error != nil {
			return result.Error
		}

		if result.RowsAffected == 0 {
			return gorm.ErrRecordNotFound
		}

		return nil
	})
}

// DeleteEdge removes one edge row by primary identifier.
func (r *GormRepository) DeleteEdge(ctx context.Context, edgeID string) error {
	if r == nil || r.db == nil {
		return fmt.Errorf("graph: nil database handle")
	}

	result := r.db.WithContext(ctx).
		Where("id = ?", edgeID).
		Delete(&Edge{})
	if result.Error != nil {
		return result.Error
	}

	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}

	return nil
}

func (r *GormRepository) GetNodesByIDs(ctx context.Context, nodeIDs []string) ([]*Node, error) {
	if r == nil || r.db == nil {
		return nil, fmt.Errorf("graph: nil database handle")
	}

	uniqueNodeIDs := uniqueNonEmptyStrings(nodeIDs)
	if len(uniqueNodeIDs) == 0 {
		return []*Node{}, nil
	}

	var rows []Node
	if err := r.db.WithContext(ctx).
		Where("deleted_at IS NULL").
		Where("id IN ?", uniqueNodeIDs).
		Find(&rows).Error; err != nil {
		return nil, err
	}

	return nodeRowsToPointers(rows), nil
}

func (r *GormRepository) GetEdgesByNodeIDs(ctx context.Context, nodeIDs []string) ([]*Edge, error) {
	if r == nil || r.db == nil {
		return nil, fmt.Errorf("graph: nil database handle")
	}

	uniqueNodeIDs := uniqueNonEmptyStrings(nodeIDs)
	if len(uniqueNodeIDs) == 0 {
		return []*Edge{}, nil
	}

	var rows []Edge
	if err := r.db.WithContext(ctx).
		Where("deleted_at IS NULL").
		Where("source_id IN ? OR target_id IN ?", uniqueNodeIDs, uniqueNodeIDs).
		Find(&rows).Error; err != nil {
		return nil, err
	}

	return edgeRowsToPointers(rows), nil
}

func (r *GormRepository) GetAdjoiningNodes(ctx context.Context, nodeID string, relationType string, direction string) ([]*Node, error) {
	if r == nil || r.db == nil {
		return nil, fmt.Errorf("graph: nil database handle")
	}

	if nodeID == "" {
		return []*Node{}, nil
	}

	var rows []Edge
	query := r.db.WithContext(ctx).Where("deleted_at IS NULL")
	if relationType != "" {
		query = query.Where("relation_type = ?", relationType)
	}

	switch direction {
	case DirectionIn:
		query = query.Where("target_id = ?", nodeID)
	case DirectionOut:
		query = query.Where("source_id = ?", nodeID)
	default:
		query = query.Where("source_id = ? OR target_id = ?", nodeID, nodeID)
	}

	if err := query.Find(&rows).Error; err != nil {
		return nil, err
	}

	adjacentNodeIDs := make([]string, 0, len(rows))
	seen := make(map[string]struct{}, len(rows))
	for _, edge := range rows {
		var adjacentNodeID string
		switch direction {
		case DirectionIn:
			adjacentNodeID = edge.SourceID
		case DirectionOut:
			adjacentNodeID = edge.TargetID
		default:
			if edge.SourceID == nodeID {
				adjacentNodeID = edge.TargetID
			} else {
				adjacentNodeID = edge.SourceID
			}
		}

		if adjacentNodeID == "" {
			continue
		}

		if _, exists := seen[adjacentNodeID]; exists {
			continue
		}

		seen[adjacentNodeID] = struct{}{}
		adjacentNodeIDs = append(adjacentNodeIDs, adjacentNodeID)
	}

	return r.GetNodesByIDs(ctx, adjacentNodeIDs)
}

// UpdateNode applies a partial field update to one node row.
func (r *GormRepository) UpdateNode(ctx context.Context, nodeID string, content *string, properties JSONDocument) error {
	if r == nil || r.db == nil {
		return fmt.Errorf("graph: nil database handle")
	}

	updateFields := make(map[string]any, 2)
	if content != nil {
		updateFields["content"] = *content
	}
	if len(properties) > 0 {
		updateFields["properties"] = properties
	}
	if len(updateFields) == 0 {
		return nil
	}

	result := r.db.WithContext(ctx).
		Model(&Node{}).
		Where("id = ? AND deleted_at IS NULL", nodeID).
		Updates(updateFields)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}

	return nil
}

// UpdateNodePosition persists x and y coordinates into the node properties JSON document.
func (r *GormRepository) UpdateNodePosition(ctx context.Context, nodeID string, x float64, y float64) error {
	if r == nil || r.db == nil {
		return fmt.Errorf("graph: nil database handle")
	}

	var node Node
	if err := r.db.WithContext(ctx).
		Where("deleted_at IS NULL").
		First(&node, "id = ?", nodeID).Error; err != nil {
		return err
	}

	properties := make(map[string]any)
	if len(node.Properties) > 0 {
		if err := json.Unmarshal(node.Properties, &properties); err != nil {
			return err
		}
	}

	properties["x"] = x
	properties["y"] = y

	encodedProperties, err := json.Marshal(properties)
	if err != nil {
		return err
	}

	return r.db.WithContext(ctx).
		Model(&Node{}).
		Where("id = ? AND deleted_at IS NULL", nodeID).
		Updates(map[string]any{"properties": JSONDocument(encodedProperties)}).Error
}

func uniqueNonEmptyStrings(values []string) []string {
	if len(values) == 0 {
		return nil
	}

	result := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		if value == "" {
			continue
		}

		if _, exists := seen[value]; exists {
			continue
		}

		seen[value] = struct{}{}
		result = append(result, value)
	}

	return result
}

func nodeRowsToPointers(rows []Node) []*Node {
	result := make([]*Node, 0, len(rows))
	for index := range rows {
		result = append(result, &rows[index])
	}

	return result
}

func edgeRowsToPointers(rows []Edge) []*Edge {
	result := make([]*Edge, 0, len(rows))
	for index := range rows {
		result = append(result, &rows[index])
	}

	return result
}

func IsRecordNotFound(err error) bool {
	return errors.Is(err, gorm.ErrRecordNotFound)
}
