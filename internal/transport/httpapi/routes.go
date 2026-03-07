package httpapi

import (
	"log"

	"github.com/gin-gonic/gin"
)

// RegisterGraphRoutes wires the graph transport endpoints and transport-wide
// middleware onto the provided Gin engine.
func RegisterGraphRoutes(engine *gin.Engine, controller *GraphController, logger *log.Logger) {
	if engine == nil || controller == nil {
		return
	}

	engine.Use(RecoveryMiddleware(logger), ErrorHandlingMiddleware(logger))

	apiV1 := engine.Group("/api/v1")
	apiV1.GET("/graph/:node_id", controller.GetFocusGraph)
	apiV1.POST("/nodes", controller.CreateNode)
	apiV1.POST("/edges", controller.CreateEdge)
	apiV1.PATCH("/nodes/:node_id/position", controller.UpdateNodePosition)
}
