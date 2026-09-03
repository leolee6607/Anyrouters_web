package service

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"

	"github.com/gin-gonic/gin"
)

func CloseResponseBodyGracefully(httpResponse *http.Response) {
	if httpResponse == nil || httpResponse.Body == nil {
		return
	}
	err := httpResponse.Body.Close()
	if err != nil {
		common.SysError("failed to close response body: " + err.Error())
	}
}

// providerRequestIdHeaders are the request-id headers real upstreams attach to
// responses: Azure API Management (apim-request-id), OpenAI (x-request-id) and
// Anthropic (request-id). They fill upstream_request_id only when no upstream
// X-Oneapi-Request-Id was seen, which stays authoritative for chained
// new-api/one-api instances.
var providerRequestIdHeaders = []string{"apim-request-id", "x-request-id", "request-id"}

// CaptureUpstreamRequestId records the upstream request id from a response
// header set into the Gin context for later logging.
func CaptureUpstreamRequestId(c *gin.Context, header http.Header) {
	if c == nil || header == nil {
		return
	}
	if v := header.Get(common.RequestIdKey); v != "" {
		c.Set(common.UpstreamRequestIdKey, v)
		return
	}
	if c.GetString(common.UpstreamRequestIdKey) != "" {
		return
	}
	for _, h := range providerRequestIdHeaders {
		if v := header.Get(h); v != "" {
			c.Set(common.UpstreamRequestIdKey, v)
			return
		}
	}
}

// ShouldCopyUpstreamHeader checks whether a given upstream response header
// should be copied to the client response. It returns false for Content-Length
// (managed separately) and X-Oneapi-Request-Id (to preserve the local instance
// ID). When the upstream header is X-Oneapi-Request-Id, the value is captured
// into the Gin context for later logging; provider request-id headers are
// captured as a fallback but still copied through.
func ShouldCopyUpstreamHeader(c *gin.Context, k string, v []string) bool {
	if strings.EqualFold(k, "Content-Length") {
		return false
	}
	if strings.EqualFold(k, common.RequestIdKey) {
		if c != nil && len(v) > 0 {
			c.Set(common.UpstreamRequestIdKey, v[0])
		}
		return false
	}
	for _, h := range providerRequestIdHeaders {
		if strings.EqualFold(k, h) {
			if c != nil && len(v) > 0 && c.GetString(common.UpstreamRequestIdKey) == "" {
				c.Set(common.UpstreamRequestIdKey, v[0])
			}
			return true
		}
	}
	return true
}

func IOCopyBytesGracefully(c *gin.Context, src *http.Response, data []byte) {
	if c.Writer == nil {
		return
	}

	body := io.NopCloser(bytes.NewBuffer(data))

	// We shouldn't set the header before we parse the response body, because the parse part may fail.
	// And then we will have to send an error response, but in this case, the header has already been set.
	// So the httpClient will be confused by the response.
	// For example, Postman will report error, and we cannot check the response at all.
	if src != nil {
		for k, v := range src.Header {
			if !ShouldCopyUpstreamHeader(c, k, v) {
				continue
			}
			c.Writer.Header().Set(k, v[0])
		}
	}

	// set Content-Length header manually BEFORE calling WriteHeader
	c.Writer.Header().Set("Content-Length", fmt.Sprintf("%d", len(data)))

	// Write header with status code (this sends the headers)
	if src != nil {
		c.Writer.WriteHeader(src.StatusCode)
	} else {
		c.Writer.WriteHeader(http.StatusOK)
	}

	_, err := io.Copy(c.Writer, body)
	if err != nil {
		logger.LogError(c, fmt.Sprintf("failed to copy response body: %s", err.Error()))
	}
	c.Writer.Flush()
}
