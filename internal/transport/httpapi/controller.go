package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"reflect"
	"sort"
	"strings"

	model "treemindmap/internal/graph"
	appservice "treemindmap/internal/service"

	"github.com/gin-gonic/gin"
	validator "github.com/go-playground/validator/v10"
)

const defaultGraphQueryDepth = 1

// GraphQueryService defines the query capability required by GraphController.
type GraphQueryService interface {
	FetchFocusGraph(ctx context.Context, focusNodeID string, maxDepth int) (*appservice.SubGraphDTO, error)
}

// GraphMutationService defines the write and validation capabilities required
// by GraphController for node and edge mutation endpoints.
type GraphMutationService interface {
	CreateNode(ctx context.Context, node *model.Node) error
	CreateEdge(ctx context.Context, edge *model.Edge) error
	GetNodesByIDs(ctx context.Context, nodeIDs []string) ([]*model.Node, error)
	UpdateNodePosition(ctx context.Context, nodeID string, x float64, y float64) error
}

// GraphController exposes the HTTP handlers for graph traversal and mutation.
type GraphController struct {
	queryService    GraphQueryService
	mutationService GraphMutationService
	maxQueryDepth   int
}

// NewGraphController constructs a controller with explicit service dependencies.
func NewGraphController(queryService GraphQueryService, mutationService GraphMutationService, maxQueryDepth int) *GraphController {
	if maxQueryDepth <= 0 {
		maxQueryDepth = 6
	}

	return &GraphController{
		queryService:    queryService,
		mutationService: mutationService,
		maxQueryDepth:   maxQueryDepth,
	}
}

// GetFocusGraph handles GET /api/v1/graph/:node_id?depth=n.
//
// Example success response:
// {"code":0,"message":"success","data":{"nodes":[{"id":"8c18feba-52a9-4a47-b4ec-8fd1e35ac081","type":"text","content":"root","properties":{"x":0,"y":0}}],"edges":[]}}
func (ctl *GraphController) GetFocusGraph(c *gin.Context) {
	if ctl == nil || ctl.queryService == nil {
		Error(c, http.StatusInternalServerError, BusinessCodeInternalError, "graph query service is not configured")
		return
	}

	var uriRequest FocusGraphURIRequest
	if err := c.ShouldBindUri(&uriRequest); err != nil {
		Error(c, http.StatusBadRequest, BusinessCodeBadRequest, formatBindingError(&uriRequest, err))
		return
	}

	var queryRequest FocusGraphQueryRequest
	if err := c.ShouldBindQuery(&queryRequest); err != nil {
		Error(c, http.StatusBadRequest, BusinessCodeBadRequest, formatBindingError(&queryRequest, err))
		return
	}

	depth := defaultGraphQueryDepth
	if queryRequest.Depth != nil {
		depth = *queryRequest.Depth
	}

	if depth > ctl.maxQueryDepth {
		Error(
			c,
			http.StatusBadRequest,
			BusinessCodeBadRequest,
			fmt.Sprintf("depth must be less than or equal to %d", ctl.maxQueryDepth),
		)
		return
	}

	subgraph, err := ctl.queryService.FetchFocusGraph(c.Request.Context(), uriRequest.NodeID, depth)
	if err != nil {
		_ = c.Error(err)
		return
	}

	Success(c, toGraphVO(subgraph))
}

// CreateNode handles POST /api/v1/nodes.
//
// Example request:
// {"id":"8c18feba-52a9-4a47-b4ec-8fd1e35ac081","type":"text","content":"root","properties":{"x":0,"y":0}}
//
// Example success response:
// {"code":0,"message":"success","data":{"id":"8c18feba-52a9-4a47-b4ec-8fd1e35ac081","type":"text","content":"root","properties":{"x":0,"y":0}}}
func (ctl *GraphController) CreateNode(c *gin.Context) {
	if ctl == nil || ctl.mutationService == nil {
		Error(c, http.StatusInternalServerError, BusinessCodeInternalError, "graph mutation service is not configured")
		return
	}

	var request CreateNodeRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		Error(c, http.StatusBadRequest, BusinessCodeBadRequest, formatBindingError(&request, err))
		return
	}

	properties, err := marshalJSONDocument(request.Properties)
	if err != nil {
		Error(c, http.StatusBadRequest, BusinessCodeBadRequest, "properties must be valid JSON")
		return
	}

	node := &model.Node{
		ID:         request.ID,
		Type:       request.Type,
		Content:    request.Content,
		Properties: properties,
	}

	if err := ctl.mutationService.CreateNode(c.Request.Context(), node); err != nil {
		_ = c.Error(err)
		return
	}

	Created(c, toNodeVO(node))
}

// CreateEdge handles POST /api/v1/edges.
//
// Example request:
// {"id":"44e8c4d6-89f2-4dd1-b958-a96d03e05be7","source_id":"8c18feba-52a9-4a47-b4ec-8fd1e35ac081","target_id":"62a3f4fd-cf09-4832-945a-2762f32e5a89","relation_type":"REFERENCE","weight":1,"properties":{"arrow":"forward"}}
func (ctl *GraphController) CreateEdge(c *gin.Context) {
	if ctl == nil || ctl.mutationService == nil {
		Error(c, http.StatusInternalServerError, BusinessCodeInternalError, "graph mutation service is not configured")
		return
	}

	var request CreateEdgeRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		Error(c, http.StatusBadRequest, BusinessCodeBadRequest, formatBindingError(&request, err))
		return
	}

	referencedNodes, err := ctl.mutationService.GetNodesByIDs(
		c.Request.Context(),
		[]string{request.SourceID, request.TargetID},
	)
	if err != nil {
		_ = c.Error(err)
		return
	}

	nodeSet := make(map[string]struct{}, len(referencedNodes))
	for _, node := range referencedNodes {
		if node == nil || node.ID == "" {
			continue
		}

		nodeSet[node.ID] = struct{}{}
	}

	if _, exists := nodeSet[request.SourceID]; !exists {
		Error(c, http.StatusNotFound, BusinessCodeNotFound, "source node not found")
		return
	}

	if _, exists := nodeSet[request.TargetID]; !exists {
		Error(c, http.StatusNotFound, BusinessCodeNotFound, "target node not found")
		return
	}

	properties, err := marshalJSONDocument(request.Properties)
	if err != nil {
		Error(c, http.StatusBadRequest, BusinessCodeBadRequest, "properties must be valid JSON")
		return
	}

	weight := 1
	if request.Weight != nil {
		weight = *request.Weight
	}

	edge := &model.Edge{
		ID:           request.ID,
		SourceID:     request.SourceID,
		TargetID:     request.TargetID,
		RelationType: request.RelationType,
		Weight:       weight,
		Properties:   properties,
	}

	if err := ctl.mutationService.CreateEdge(c.Request.Context(), edge); err != nil {
		_ = c.Error(err)
		return
	}

	Created(c, toEdgeVO(edge))
}

// UpdateNodePosition handles PATCH /api/v1/nodes/:node_id/position.
//
// Example request:
// {"x":120.5,"y":240.25}
//
// Example success response:
// {"code":0,"message":"success","data":{"node_id":"8c18feba-52a9-4a47-b4ec-8fd1e35ac081","x":120.5,"y":240.25}}
func (ctl *GraphController) UpdateNodePosition(c *gin.Context) {
	if ctl == nil || ctl.mutationService == nil {
		Error(c, http.StatusInternalServerError, BusinessCodeInternalError, "graph mutation service is not configured")
		return
	}

	var uriRequest UpdateNodePositionURIRequest
	if err := c.ShouldBindUri(&uriRequest); err != nil {
		Error(c, http.StatusBadRequest, BusinessCodeBadRequest, formatBindingError(&uriRequest, err))
		return
	}

	var request UpdateNodePositionRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		Error(c, http.StatusBadRequest, BusinessCodeBadRequest, formatBindingError(&request, err))
		return
	}

	if err := ctl.mutationService.UpdateNodePosition(c.Request.Context(), uriRequest.NodeID, *request.X, *request.Y); err != nil {
		_ = c.Error(err)
		return
	}

	Success(c, NodePositionVO{
		NodeID: uriRequest.NodeID,
		X:      *request.X,
		Y:      *request.Y,
	})
}

func toGraphVO(subgraph *appservice.SubGraphDTO) GraphVO {
	if subgraph == nil {
		return GraphVO{
			Nodes: make([]NodeVO, 0),
			Edges: make([]EdgeVO, 0),
		}
	}

	nodeKeys := make([]string, 0, len(subgraph.Nodes))
	for nodeID := range subgraph.Nodes {
		if nodeID == "" {
			continue
		}

		nodeKeys = append(nodeKeys, nodeID)
	}
	sort.Strings(nodeKeys)

	nodes := make([]NodeVO, 0, len(subgraph.Nodes))
	for _, nodeID := range nodeKeys {
		node := subgraph.Nodes[nodeID]
		if node == nil {
			continue
		}

		nodes = append(nodes, toNodeVO(node))
	}

	edgeKeys := make([]string, 0, len(subgraph.Edges))
	for edgeID := range subgraph.Edges {
		if edgeID == "" {
			continue
		}

		edgeKeys = append(edgeKeys, edgeID)
	}
	sort.Strings(edgeKeys)

	edges := make([]EdgeVO, 0, len(subgraph.Edges))
	for _, edgeID := range edgeKeys {
		edge := subgraph.Edges[edgeID]
		if edge == nil {
			continue
		}

		edges = append(edges, toEdgeVO(edge))
	}

	return GraphVO{
		Nodes: nodes,
		Edges: edges,
	}
}

func toNodeVO(node *model.Node) NodeVO {
	if node == nil {
		return NodeVO{
			Properties: json.RawMessage("{}"),
		}
	}

	return NodeVO{
		ID:         node.ID,
		Type:       node.Type,
		Content:    node.Content,
		Properties: toRawJSON(node.Properties),
		CreatedAt:  node.CreatedAt,
		UpdatedAt:  node.UpdatedAt,
		DeletedAt:  node.DeletedAt,
	}
}

func toEdgeVO(edge *model.Edge) EdgeVO {
	if edge == nil {
		return EdgeVO{
			Properties: json.RawMessage("{}"),
		}
	}

	return EdgeVO{
		ID:           edge.ID,
		SourceID:     edge.SourceID,
		TargetID:     edge.TargetID,
		RelationType: edge.RelationType,
		Weight:       edge.Weight,
		Properties:   toRawJSON(edge.Properties),
		CreatedAt:    edge.CreatedAt,
		UpdatedAt:    edge.UpdatedAt,
		DeletedAt:    edge.DeletedAt,
	}
}

func toRawJSON(document model.JSONDocument) json.RawMessage {
	if len(document) == 0 {
		return json.RawMessage("{}")
	}

	return json.RawMessage(document)
}

func marshalJSONDocument(value any) (model.JSONDocument, error) {
	if value == nil {
		return model.JSONDocument("{}"), nil
	}

	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}

	if len(encoded) == 0 {
		return model.JSONDocument("{}"), nil
	}

	return model.JSONDocument(encoded), nil
}

func formatBindingError(payload any, err error) string {
	if err == nil {
		return "invalid request"
	}

	var validationErrors validator.ValidationErrors
	if !errors.As(err, &validationErrors) {
		return err.Error()
	}

	fieldNames := externalFieldNames(payload)
	messages := make([]string, 0, len(validationErrors))
	for _, fieldError := range validationErrors {
		fieldName := fieldError.Field()
		if taggedName, exists := fieldNames[fieldError.StructField()]; exists && taggedName != "" {
			fieldName = taggedName
		}

		messages = append(messages, fmt.Sprintf("%s failed on %s", fieldName, fieldError.Tag()))
	}
	sort.Strings(messages)
	return strings.Join(messages, "; ")
}

func externalFieldNames(payload any) map[string]string {
	result := make(map[string]string)
	if payload == nil {
		return result
	}

	payloadType := reflect.TypeOf(payload)
	for payloadType.Kind() == reflect.Pointer {
		payloadType = payloadType.Elem()
	}

	if payloadType.Kind() != reflect.Struct {
		return result
	}

	for index := 0; index < payloadType.NumField(); index++ {
		field := payloadType.Field(index)
		if field.PkgPath != "" {
			continue
		}

		name := bindingFieldName(field)
		if name == "" {
			name = field.Name
		}

		result[field.Name] = name
	}

	return result
}

func bindingFieldName(field reflect.StructField) string {
	tagCandidates := []string{"json", "uri", "form"}
	for _, tagName := range tagCandidates {
		value := field.Tag.Get(tagName)
		if value == "" {
			continue
		}

		name := strings.Split(value, ",")[0]
		if name == "" || name == "-" {
			continue
		}

		return name
	}

	return ""
}
