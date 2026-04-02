package graph

import "context"

const (
	// DirectionIn traverses edges where the current node is the target.
	DirectionIn = "IN"

	// DirectionOut traverses edges where the current node is the source.
	DirectionOut = "OUT"

	// DirectionBoth traverses both incoming and outgoing edges for the current node.
	DirectionBoth = "BOTH"
)

// GraphQueryRepository defines the read-side persistence contract used by graph
// query use cases and transport-layer existence checks.
type GraphQueryRepository interface {
	// GetNodesByIDs loads a batch of nodes by UUID.
	// The implementation should return only existing rows and avoid per-ID
	// round trips so upper layers can preserve bounded query counts.
	GetNodesByIDs(ctx context.Context, nodeIDs []string) ([]*Node, error)

	// GetEdgesByNodeIDs loads all edges incident to the provided node UUIDs.
	// The implementation should use set-based SQL so breadth-first traversal can
	// expand one level at a time without an N+1 query pattern.
	GetEdgesByNodeIDs(ctx context.Context, nodeIDs []string) ([]*Edge, error)
}

// GraphTraversalRepository defines adjacency lookups used by graph mutation
// flows such as cycle detection.
type GraphTraversalRepository interface {
	// GetAdjoiningNodes returns the nodes adjacent to nodeID.
	// relationType filters the traversal to a specific semantic edge type when
	// it is non-empty. direction accepts IN, OUT, or BOTH.
	GetAdjoiningNodes(ctx context.Context, nodeID string, relationType string, direction string) ([]*Node, error)
}

// GraphCommandRepository defines the write-side persistence contract for graph
// mutation use cases.
type GraphCommandRepository interface {
	// CreateNode persists one node record, including its JSON property document
	// and audit fields, into the underlying graph storage.
	CreateNode(ctx context.Context, node *Node) (*Node, error)

	// CreateEdge persists one directed edge record that connects two existing
	// nodes and captures semantic relation type, weight, and JSON properties.
	CreateEdge(ctx context.Context, edge *Edge) (*Edge, error)

	// PatchNode applies a partial update to one node and returns the persisted
	// row after merge semantics have been applied.
	PatchNode(ctx context.Context, nodeID string, patch NodePatch) (*Node, error)

	// UpdateNodePosition persists the latest coordinates for one node and
	// returns the updated row.
	UpdateNodePosition(ctx context.Context, nodeID string, x float64, y float64) (*Node, error)

	// DeleteNode removes one node together with all incident edges and returns
	// the removed aggregate so callers can implement a safe undo flow.
	DeleteNode(ctx context.Context, nodeID string) (*NodeDeletionSnapshot, error)

	// DeleteEdge removes one edge row by primary identifier.
	DeleteEdge(ctx context.Context, edgeID string) error
}

// GraphRepository is the full persistence contract implemented by the concrete
// database adapter used in production.
type GraphRepository interface {
	GraphQueryRepository
	GraphTraversalRepository
	GraphCommandRepository
}
