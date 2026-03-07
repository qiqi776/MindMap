// Package graph defines the persistence models and repository contracts for the graph domain.
package graph

import (
	"time"

	"gorm.io/datatypes"
	"gorm.io/gorm"
)

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
	Properties datatypes.JSON `gorm:"column:properties;type:json;not null"`

	// CreatedAt records when the node was first persisted for audit,
	// synchronization, and downstream replication workflows.
	CreatedAt time.Time `gorm:"column:created_at;type:datetime(3);not null;autoCreateTime:milli"`

	// UpdatedAt records the most recent successful mutation of the node and is
	// used for audit trails and cache invalidation.
	UpdatedAt time.Time `gorm:"column:updated_at;type:datetime(3);not null;autoUpdateTime:milli"`

	// DeletedAt marks the node as soft-deleted without removing the row so
	// higher-level services can preserve auditability and recovery paths.
	DeletedAt gorm.DeletedAt `gorm:"column:deleted_at;type:datetime(3);index:idx_nodes_deleted_at"`
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
	Properties datatypes.JSON `gorm:"column:properties;type:json;not null"`

	// CreatedAt records when the edge was first persisted for audit,
	// synchronization, and downstream replication workflows.
	CreatedAt time.Time `gorm:"column:created_at;type:datetime(3);not null;autoCreateTime:milli"`

	// UpdatedAt records the most recent successful mutation of the edge and is
	// used for audit trails and cache invalidation.
	UpdatedAt time.Time `gorm:"column:updated_at;type:datetime(3);not null;autoUpdateTime:milli"`

	// DeletedAt marks the edge as soft-deleted without removing the row so
	// higher-level services can preserve auditability and recovery paths.
	DeletedAt gorm.DeletedAt `gorm:"column:deleted_at;type:datetime(3);index:idx_edges_deleted_at"`
}

// TableName binds the Edge model to the edges table.
func (Edge) TableName() string {
	return "edges"
}
