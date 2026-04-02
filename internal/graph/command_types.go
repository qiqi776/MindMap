package graph

// NodePatch captures the partial mutable fields for one node update request.
type NodePatch struct {
	Content       *string
	Collapsed     *bool
	PropertyPatch map[string]any
}

// NodeDeletionSnapshot returns the full node aggregate removed by a delete
// command so higher layers can safely restore it during undo flows.
type NodeDeletionSnapshot struct {
	Node  *Node
	Edges []*Edge
}
