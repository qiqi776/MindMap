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

// GraphRepository defines the persistence contract for the graph domain.
// The interface isolates storage concerns for node creation, edge creation,
// and adjacency traversal used by graph query services.
type GraphRepository interface {
	// CreateNode persists one node record, including its JSON property document
	// and audit fields, into the underlying graph storage.
	CreateNode(ctx context.Context, node *Node) error

	// CreateEdge persists one directed edge record that connects two existing
	// nodes and captures semantic relation type, weight, and JSON properties.
	CreateEdge(ctx context.Context, edge *Edge) error

	// GetNodesByIDs loads a batch of nodes by UUID.
	// The implementation should return only existing rows and avoid per-ID
	// round trips so upper layers can preserve bounded query counts.
	GetNodesByIDs(ctx context.Context, nodeIDs []string) ([]*Node, error)

	// GetEdgesByNodeIDs loads all edges incident to the provided node UUIDs.
	// The implementation should use set-based SQL so breadth-first traversal can
	// expand one level at a time without an N+1 query pattern.
	GetEdgesByNodeIDs(ctx context.Context, nodeIDs []string) ([]*Edge, error)

	// GetAdjoiningNodes returns the nodes adjacent to nodeID.
	// relationType filters the traversal to a specific semantic edge type when
	// it is non-empty. direction accepts IN, OUT, or BOTH.
	GetAdjoiningNodes(ctx context.Context, nodeID string, relationType string, direction string) ([]*Node, error)
}
