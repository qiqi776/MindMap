package httpapi

import (
	"encoding/json"
	"time"
)

// GraphVO is the HTTP response view returned to front-end graph clients.
//
// Example:
// {"nodes":[{"id":"...","type":"text","content":"root","properties":{"x":0,"y":0}}],"edges":[{"id":"...","source_id":"...","target_id":"...","relation_type":"REFERENCE","weight":1,"properties":{}}]}
type GraphVO struct {
	// Nodes stores the serialized node list expected by front-end graph renderers.
	Nodes []NodeVO `json:"nodes"`

	// Edges stores the serialized edge list expected by front-end graph renderers.
	Edges []EdgeVO `json:"edges"`
}

// NodeVO defines the node payload returned by the HTTP API.
type NodeVO struct {
	ID         string          `json:"id"`
	Type       string          `json:"type"`
	Content    string          `json:"content"`
	Properties json.RawMessage `json:"properties"`
	CreatedAt  time.Time       `json:"created_at"`
	UpdatedAt  time.Time       `json:"updated_at"`
	DeletedAt  *time.Time      `json:"deleted_at,omitempty"`
}

// EdgeVO defines the edge payload returned by the HTTP API.
type EdgeVO struct {
	ID           string          `json:"id"`
	SourceID     string          `json:"source_id"`
	TargetID     string          `json:"target_id"`
	RelationType string          `json:"relation_type"`
	Weight       int             `json:"weight"`
	Properties   json.RawMessage `json:"properties"`
	CreatedAt    time.Time       `json:"created_at"`
	UpdatedAt    time.Time       `json:"updated_at"`
	DeletedAt    *time.Time      `json:"deleted_at,omitempty"`
}

// NodePositionVO defines the HTTP response for a successful position update.
type NodePositionVO struct {
	NodeID string  `json:"node_id"`
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
}

// FocusGraphURIRequest binds the :node_id route parameter for graph queries.
type FocusGraphURIRequest struct {
	NodeID string `uri:"node_id" binding:"required,uuid"`
}

// FocusGraphQueryRequest binds the query parameters for graph traversal.
type FocusGraphQueryRequest struct {
	Depth *int `form:"depth" binding:"omitempty,min=0"`
}

// CreateNodeRequest binds the request body for POST /api/v1/nodes.
type CreateNodeRequest struct {
	ID         string         `json:"id" binding:"required,uuid"`
	Type       string         `json:"type" binding:"required,max=64"`
	Content    string         `json:"content" binding:"required"`
	Properties map[string]any `json:"properties"`
}

// CreateEdgeRequest binds the request body for POST /api/v1/edges.
type CreateEdgeRequest struct {
	ID           string         `json:"id" binding:"required,uuid"`
	SourceID     string         `json:"source_id" binding:"required,uuid"`
	TargetID     string         `json:"target_id" binding:"required,uuid"`
	RelationType string         `json:"relation_type" binding:"required,max=64"`
	Weight       *int           `json:"weight" binding:"omitempty,min=1"`
	Properties   map[string]any `json:"properties"`
}

// UpdateNodePositionURIRequest binds the :node_id route parameter for updates.
type UpdateNodePositionURIRequest struct {
	NodeID string `uri:"node_id" binding:"required,uuid"`
}

// UpdateNodePositionRequest binds the request body for PATCH /api/v1/nodes/:node_id/position.
type UpdateNodePositionRequest struct {
	X *float64 `json:"x" binding:"required"`
	Y *float64 `json:"y" binding:"required"`
}
