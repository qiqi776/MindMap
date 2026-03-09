// Package graph defines the persistence models and repository contracts for the graph domain.
package graph

import (
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"time"
)

// JSONDocument persists arbitrary JSON for node and edge properties.
// It implements sql.Scanner and driver.Valuer so GORM can map the type to a
// MySQL JSON column without additional runtime dependencies.
type JSONDocument []byte

// Value converts the JSON document into a database value.
// Empty documents are normalized to an empty JSON object so NOT NULL JSON
// columns remain writable even when callers omit optional property values.
func (j JSONDocument) Value() (driver.Value, error) {
	if len(j) == 0 {
		return "{}", nil
	}

	if !json.Valid(j) {
		return nil, fmt.Errorf("graph: invalid JSON document")
	}

	return string(j), nil
}

// Scan loads a JSON document from the database driver into the in-memory type.
func (j *JSONDocument) Scan(value any) error {
	switch v := value.(type) {
	case nil:
		*j = JSONDocument("{}")
		return nil
	case []byte:
		if !json.Valid(v) {
			return fmt.Errorf("graph: invalid JSON document")
		}
		*j = append((*j)[:0], v...)
		return nil
	case string:
		if !json.Valid([]byte(v)) {
			return fmt.Errorf("graph: invalid JSON document")
		}
		*j = append((*j)[:0], v...)
		return nil
	default:
		return fmt.Errorf("graph: unsupported JSON scan type %T", value)
	}
}

// MarshalJSON exposes the document as raw JSON when the model is serialized.
func (j JSONDocument) MarshalJSON() ([]byte, error) {
	if len(j) == 0 {
		return []byte("{}"), nil
	}

	if !json.Valid(j) {
		return nil, fmt.Errorf("graph: invalid JSON document")
	}

	return []byte(j), nil
}

// UnmarshalJSON validates inbound JSON before assigning it to the document.
func (j *JSONDocument) UnmarshalJSON(data []byte) error {
	if len(data) == 0 {
		*j = JSONDocument("{}")
		return nil
	}

	if !json.Valid(data) {
		return fmt.Errorf("graph: invalid JSON document")
	}

	*j = append((*j)[:0], data...)
	return nil
}

// Node stores one graph vertex in the mesh-style mind map domain.
// It persists the stable UUID identity, domain type, summary content, and
// extensible client-facing properties required for layout and rendering.
type Node struct {
	// ID stores a UUID string so the node can be created independently of any
	// single database instance, shard, or auto-increment sequence.
	ID string `gorm:"column:id;type:varchar(36);primaryKey;not null"`

	// Type classifies the node so downstream services and clients can apply
	// the correct behavior for text, image, person, or other domain categories.
	Type string `gorm:"column:type;type:varchar(64);not null;index:idx_nodes_type"`

	// Content stores the primary summary payload rendered for the node.
	// The field is intentionally textual because different node types share a
	// common preview surface in traversal and search results.
	Content string `gorm:"column:content;type:text;not null"`

	// Properties stores the extensible JSON document used for coordinates,
	// visual style, and additional business attributes required by clients.
	Properties JSONDocument `gorm:"column:properties;type:json;not null"`

	// CreatedAt records when the node was first persisted for audit,
	// synchronization, and downstream replication workflows.
	CreatedAt time.Time `gorm:"column:created_at;type:datetime;not null;autoCreateTime:milli"`

	// UpdatedAt records the most recent successful mutation of the node and is
	// used for audit trails and cache invalidation.
	UpdatedAt time.Time `gorm:"column:updated_at;type:datetime;not null;autoUpdateTime:milli"`

	// DeletedAt marks the node as soft-deleted without removing the row so
	// higher-level services can preserve auditability and recovery paths.
	DeletedAt *time.Time `gorm:"column:deleted_at;type:datetime;index:idx_nodes_deleted_at"`
}

// TableName binds the Node model to the nodes table.
func (Node) TableName() string {
	return "nodes"
}

// Edge stores one directed graph relation between two nodes.
// It persists traversal direction, semantic relation type, weighting, and
// extensible rendering properties required by graph clients.
type Edge struct {
	// ID stores a UUID string so the edge can be created independently of any
	// single database instance, shard, or auto-increment sequence.
	ID string `gorm:"column:id;type:varchar(36);primaryKey;not null"`

	// SourceID identifies the source node used for outgoing traversal.
	// The value is indexed with RelationType to support BFS expansion without
	// falling back to a full table scan.
	SourceID string `gorm:"column:source_id;type:varchar(36);not null;index:idx_edges_source_relation,priority:1"`

	// TargetID identifies the target node used for incoming traversal.
	// The value is indexed with RelationType to support reverse BFS expansion
	// without falling back to a full table scan.
	TargetID string `gorm:"column:target_id;type:varchar(36);not null;index:idx_edges_target_relation,priority:1"`

	// RelationType labels the semantic meaning of the connection so clients
	// can filter, render, and process graph relations consistently.
	RelationType string `gorm:"column:relation_type;type:varchar(64);not null;index:idx_edges_source_relation,priority:2;index:idx_edges_target_relation,priority:2"`

	// Weight stores a reserved integer coefficient for future graph layout,
	// ranking, or traversal heuristics that depend on edge strength.
	Weight int `gorm:"column:weight;type:int;not null;default:1"`

	// Properties stores the extensible JSON document used for line style,
	// arrow configuration, and additional edge-specific business attributes.
	Properties JSONDocument `gorm:"column:properties;type:json;not null"`

	// CreatedAt records when the edge was first persisted for audit,
	// synchronization, and downstream replication workflows.
	CreatedAt time.Time `gorm:"column:created_at;type:datetime;not null;autoCreateTime:milli"`

	// UpdatedAt records the most recent successful mutation of the edge and is
	// used for audit trails and cache invalidation.
	UpdatedAt time.Time `gorm:"column:updated_at;type:datetime;not null;autoUpdateTime:milli"`

	// DeletedAt marks the edge as soft-deleted without removing the row so
	// higher-level services can preserve auditability and recovery paths.
	DeletedAt *time.Time `gorm:"column:deleted_at;type:datetime;index:idx_edges_deleted_at"`
}

// TableName binds the Edge model to the edges table.
func (Edge) TableName() string {
	return "edges"
}
