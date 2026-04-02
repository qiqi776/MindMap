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

func (r *GormRepository) CreateNode(ctx context.Context, node *Node) (*Node, error) {
	if r == nil || r.db == nil {
		return nil, fmt.Errorf("graph: nil database handle")
	}

	if node == nil {
		return nil, fmt.Errorf("graph: nil node")
	}

	if len(node.Properties) == 0 {
		node.Properties = JSONDocument("{}")
	}

	if err := r.db.WithContext(ctx).Create(node).Error; err != nil {
		return nil, err
	}

	return node, nil
}

func (r *GormRepository) CreateEdge(ctx context.Context, edge *Edge) (*Edge, error) {
	if r == nil || r.db == nil {
		return nil, fmt.Errorf("graph: nil database handle")
	}

	if edge == nil {
		return nil, fmt.Errorf("graph: nil edge")
	}

	if len(edge.Properties) == 0 {
		edge.Properties = JSONDocument("{}")
	}

	if err := r.db.WithContext(ctx).Create(edge).Error; err != nil {
		return nil, err
	}

	return edge, nil
}

// DeleteNode performs transactional cascading cleanup for one node and all
// incident edges to preserve referential integrity under concurrent writes.
func (r *GormRepository) DeleteNode(ctx context.Context, nodeID string) (*NodeDeletionSnapshot, error) {
	if r == nil || r.db == nil {
		return nil, fmt.Errorf("graph: nil database handle")
	}

	var snapshot NodeDeletionSnapshot
	if err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var node Node
		if err := tx.WithContext(ctx).
			First(&node, "id = ?", nodeID).Error; err != nil {
			return err
		}

		var edges []Edge
		if err := tx.WithContext(ctx).
			Where("source_id = ? OR target_id = ?", nodeID, nodeID).
			Find(&edges).Error; err != nil {
			return err
		}

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

		snapshot.Node = &node
		snapshot.Edges = edgeRowsToPointers(edges)
		return nil
	}); err != nil {
		return nil, err
	}

	return &snapshot, nil
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
	query := r.db.WithContext(ctx)
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

// PatchNode applies a partial field update to one node row.
func (r *GormRepository) PatchNode(ctx context.Context, nodeID string, patch NodePatch) (*Node, error) {
	if r == nil || r.db == nil {
		return nil, fmt.Errorf("graph: nil database handle")
	}

	var node Node
	if err := r.db.WithContext(ctx).
		First(&node, "id = ?", nodeID).Error; err != nil {
		return nil, err
	}

	updateFields := make(map[string]any, 2)
	if patch.Content != nil {
		updateFields["content"] = *patch.Content
	}

	if patch.PropertyPatch != nil {
		mergedProperties, err := mergeNodeProperties(node.Properties, patch.PropertyPatch)
		if err != nil {
			return nil, err
		}

		updateFields["properties"] = mergedProperties
	}

	if len(updateFields) == 0 {
		return &node, nil
	}

	result := r.db.WithContext(ctx).
		Model(&Node{}).
		Where("id = ?", nodeID).
		Updates(updateFields)
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected == 0 {
		return nil, gorm.ErrRecordNotFound
	}

	if err := r.db.WithContext(ctx).First(&node, "id = ?", nodeID).Error; err != nil {
		return nil, err
	}

	return &node, nil
}

// UpdateNodePosition persists x and y coordinates into the node properties JSON document.
func (r *GormRepository) UpdateNodePosition(ctx context.Context, nodeID string, x float64, y float64) (*Node, error) {
	if r == nil || r.db == nil {
		return nil, fmt.Errorf("graph: nil database handle")
	}

	var node Node
	if err := r.db.WithContext(ctx).
		First(&node, "id = ?", nodeID).Error; err != nil {
		return nil, err
	}

	properties, err := decodeNodeProperties(node.Properties)
	if err != nil {
		return nil, err
	}

	properties["x"] = x
	properties["y"] = y

	encodedProperties, err := json.Marshal(properties)
	if err != nil {
		return nil, err
	}

	if err := r.db.WithContext(ctx).
		Model(&Node{}).
		Where("id = ?", nodeID).
		Updates(map[string]any{"properties": JSONDocument(encodedProperties)}).Error; err != nil {
		return nil, err
	}

	if err := r.db.WithContext(ctx).First(&node, "id = ?", nodeID).Error; err != nil {
		return nil, err
	}

	return &node, nil
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

func decodeNodeProperties(document JSONDocument) (map[string]any, error) {
	properties := make(map[string]any)
	if len(document) == 0 {
		return properties, nil
	}

	if err := json.Unmarshal(document, &properties); err != nil {
		return nil, err
	}

	return properties, nil
}

func mergeNodeProperties(current JSONDocument, patch map[string]any) (JSONDocument, error) {
	properties, err := decodeNodeProperties(current)
	if err != nil {
		return nil, err
	}

	for key, value := range patch {
		properties[key] = value
	}

	encodedProperties, err := json.Marshal(properties)
	if err != nil {
		return nil, err
	}

	return JSONDocument(encodedProperties), nil
}
