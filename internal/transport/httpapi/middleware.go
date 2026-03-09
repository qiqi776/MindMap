package httpapi

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"path/filepath"
	"runtime"
	"strings"

	appservice "treemindmap/internal/service"

	"github.com/gin-gonic/gin"
)

// RecoveryMiddleware intercepts unhandled panics, writes a sanitized stack log,
// and returns a standardized HTTP 500 response instead of crashing the process.
func RecoveryMiddleware(logger *log.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		defer func() {
			if recovered := recover(); recovered != nil {
				if logger != nil {
					logger.Printf(
						"panic recovered method=%s path=%s panic=%s stack=%s",
						safeRequestMethod(c),
						safeRequestPath(c),
						sanitizeLogText(fmt.Sprint(recovered), 512),
						sanitizedStack(24, 8192),
					)
				}

				if c.Writer.Written() {
					c.Abort()
					return
				}

				Error(c, http.StatusInternalServerError, BusinessCodeInternalError, "internal server error")
			}
		}()

		c.Next()
	}
}

// ErrorHandlingMiddleware converts domain and infrastructure errors attached to
// the Gin context into the standardized HTTP response envelope.
func ErrorHandlingMiddleware(logger *log.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Next()

		if len(c.Errors) == 0 {
			return
		}

		lastError := c.Errors.Last()
		if lastError == nil || lastError.Err == nil {
			return
		}

		if c.Writer.Written() {
			if logger != nil {
				logger.Printf(
					"request completed with deferred error method=%s path=%s error=%s",
					safeRequestMethod(c),
					safeRequestPath(c),
					sanitizeLogText(lastError.Err.Error(), 2048),
				)
			}
			return
		}

		httpCode, errCode, message := mapError(lastError.Err)
		if logger != nil && httpCode >= http.StatusInternalServerError {
			logger.Printf(
				"request failed method=%s path=%s error=%s",
				safeRequestMethod(c),
				safeRequestPath(c),
				sanitizeLogText(lastError.Err.Error(), 2048),
			)
		}

		Error(c, httpCode, errCode, message)
	}
}

func mapError(err error) (int, int, string) {
	switch {
	case err == nil:
		return http.StatusInternalServerError, BusinessCodeInternalError, "internal server error"
	case errors.Is(err, context.Canceled):
		return http.StatusRequestTimeout, BusinessCodeTimeout, "request canceled"
	case errors.Is(err, context.DeadlineExceeded):
		return http.StatusGatewayTimeout, BusinessCodeTimeout, "request timed out"
	case errors.Is(err, appservice.ErrFocusNodeNotFound):
		return http.StatusNotFound, BusinessCodeNotFound, "focus node not found"
	case errors.Is(err, appservice.ErrNodeNotFound):
		return http.StatusNotFound, BusinessCodeNotFound, "node not found"
	case errors.Is(err, appservice.ErrSourceNodeNotFound):
		return http.StatusNotFound, BusinessCodeNotFound, "source node not found"
	case errors.Is(err, appservice.ErrTargetNodeNotFound):
		return http.StatusNotFound, BusinessCodeNotFound, "target node not found"
	case errors.Is(err, appservice.ErrEdgeNotFound):
		return http.StatusNotFound, BusinessCodeNotFound, "edge not found"
	case errors.Is(err, appservice.ErrNegativeMaxDepth):
		return http.StatusBadRequest, BusinessCodeBadRequest, "depth must be greater than or equal to 0"
	case errors.Is(err, appservice.ErrEmptyFocusNodeID):
		return http.StatusBadRequest, BusinessCodeBadRequest, "node_id is required"
	case errors.Is(err, appservice.ErrCyclicDependency):
		return http.StatusConflict, BusinessCodeConflict, "cyclic dependency detected"
	default:
		return http.StatusInternalServerError, BusinessCodeInternalError, "internal server error"
	}
}

func safeRequestMethod(c *gin.Context) string {
	if c == nil || c.Request == nil {
		return ""
	}

	return c.Request.Method
}

func safeRequestPath(c *gin.Context) string {
	if c == nil || c.Request == nil || c.Request.URL == nil {
		return ""
	}

	return c.Request.URL.Path
}

func sanitizeLogText(value string, limit int) string {
	clean := strings.ReplaceAll(value, "\n", " ")
	clean = strings.ReplaceAll(clean, "\r", " ")
	clean = strings.TrimSpace(clean)
	if limit > 0 && len(clean) > limit {
		return clean[:limit] + "..."
	}

	return clean
}

func sanitizedStack(frameLimit int, textLimit int) string {
	if frameLimit <= 0 {
		frameLimit = 16
	}

	programCounters := make([]uintptr, frameLimit)
	frameCount := runtime.Callers(3, programCounters)
	if frameCount == 0 {
		return ""
	}

	frames := runtime.CallersFrames(programCounters[:frameCount])
	parts := make([]string, 0, frameCount)
	for index := 0; index < frameLimit; index++ {
		frame, more := frames.Next()
		functionName := frame.Function
		if functionName != "" {
			functionName = filepath.Base(functionName)
		}

		fileName := filepath.Base(frame.File)
		parts = append(parts, fmt.Sprintf("%s(%s:%d)", functionName, fileName, frame.Line))

		if !more {
			break
		}
	}

	return sanitizeLogText(strings.Join(parts, " "), textLimit)
}
