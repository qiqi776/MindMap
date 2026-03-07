// Package httpapi defines Gin-based HTTP transport components for the graph system.
package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

const (
	// BusinessCodeSuccess marks a successful API response.
	BusinessCodeSuccess = 0

	// BusinessCodeBadRequest marks invalid client input.
	BusinessCodeBadRequest = 40001

	// BusinessCodeNotFound marks a missing domain resource.
	BusinessCodeNotFound = 40401

	// BusinessCodeConflict marks a domain conflict.
	BusinessCodeConflict = 40901

	// BusinessCodeTimeout marks a canceled or timed-out request.
	BusinessCodeTimeout = 40801

	// BusinessCodeInternalError marks an unexpected server-side failure.
	BusinessCodeInternalError = 50001
)

// Response wraps every HTTP payload returned by the transport layer.
//
// Example success payload:
// {"code":0,"message":"success","data":{"nodes":[],"edges":[]}}
//
// Example error payload:
// {"code":40401,"message":"node not found","data":null}
type Response[T any] struct {
	// Code stores the business status code used by API clients.
	Code int `json:"code"`

	// Message stores a human-readable result description.
	Message string `json:"message"`

	// Data stores the actual response payload and is nil for error responses.
	Data T `json:"data"`
}

// Success writes an HTTP 200 response with the standard success envelope.
func Success(c *gin.Context, data any) {
	if c == nil {
		return
	}

	c.JSON(http.StatusOK, Response[any]{
		Code:    BusinessCodeSuccess,
		Message: "success",
		Data:    data,
	})
}

// Created writes an HTTP 201 response with the standard success envelope.
func Created(c *gin.Context, data any) {
	if c == nil {
		return
	}

	c.JSON(http.StatusCreated, Response[any]{
		Code:    BusinessCodeSuccess,
		Message: "success",
		Data:    data,
	})
}

// Error writes a standardized error response and aborts the remaining handlers.
func Error(c *gin.Context, httpCode int, errCode int, msg string) {
	if c == nil {
		return
	}

	c.AbortWithStatusJSON(httpCode, Response[any]{
		Code:    errCode,
		Message: msg,
		Data:    nil,
	})
}
