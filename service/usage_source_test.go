package service

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/gin-gonic/gin"
)

func newTestGinContext() *gin.Context {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	return c
}

func TestMarkUsageSourcePrecedence(t *testing.T) {
	c := newTestGinContext()

	MarkUsageSource(c, UsageSourcePartial)
	if got := common.GetContextKeyString(c, constant.ContextKeyUsageSource); got != UsageSourcePartial {
		t.Fatalf("got %q, want partial", got)
	}

	// more severe marker upgrades
	MarkUsageSource(c, UsageSourceLocalEstimate)
	if got := common.GetContextKeyString(c, constant.ContextKeyUsageSource); got != UsageSourceLocalEstimate {
		t.Fatalf("got %q, want local_estimate", got)
	}
	MarkUsageSource(c, UsageSourceMissing)
	if got := common.GetContextKeyString(c, constant.ContextKeyUsageSource); got != UsageSourceMissing {
		t.Fatalf("got %q, want missing", got)
	}

	// less severe marker never downgrades
	MarkUsageSource(c, UsageSourcePartial)
	if got := common.GetContextKeyString(c, constant.ContextKeyUsageSource); got != UsageSourceMissing {
		t.Fatalf("got %q, want missing to stick", got)
	}

	// nil context must not panic
	MarkUsageSource(nil, UsageSourceMissing)
}

func TestCaptureUpstreamRequestIdPriority(t *testing.T) {
	// Azure apim-request-id fills the empty slot
	c := newTestGinContext()
	h := http.Header{}
	h.Set("apim-request-id", "azure-123")
	CaptureUpstreamRequestId(c, h)
	if got := c.GetString(common.UpstreamRequestIdKey); got != "azure-123" {
		t.Fatalf("got %q, want azure-123", got)
	}

	// a later provider id must not overwrite an existing capture
	h2 := http.Header{}
	h2.Set("x-request-id", "openai-456")
	CaptureUpstreamRequestId(c, h2)
	if got := c.GetString(common.UpstreamRequestIdKey); got != "azure-123" {
		t.Fatalf("got %q, provider ids must not overwrite", got)
	}

	// X-Oneapi-Request-Id stays authoritative and overwrites
	h3 := http.Header{}
	h3.Set(common.RequestIdKey, "oneapi-789")
	CaptureUpstreamRequestId(c, h3)
	if got := c.GetString(common.UpstreamRequestIdKey); got != "oneapi-789" {
		t.Fatalf("got %q, want oneapi-789", got)
	}

	// header priority within one response: apim wins over the generic ids
	c2 := newTestGinContext()
	h4 := http.Header{}
	h4.Set("request-id", "anthropic-1")
	h4.Set("apim-request-id", "azure-1")
	CaptureUpstreamRequestId(c2, h4)
	if got := c2.GetString(common.UpstreamRequestIdKey); got != "azure-1" {
		t.Fatalf("got %q, want azure-1", got)
	}
}

func TestShouldCopyUpstreamHeaderCapturesProviderIds(t *testing.T) {
	c := newTestGinContext()
	// provider request-id headers are captured but still copied to the client
	if !ShouldCopyUpstreamHeader(c, "Apim-Request-Id", []string{"azure-9"}) {
		t.Fatal("provider id headers must still be copied")
	}
	if got := c.GetString(common.UpstreamRequestIdKey); got != "azure-9" {
		t.Fatalf("got %q, want azure-9", got)
	}
	// X-Oneapi id is captured, not copied, and overwrites
	if ShouldCopyUpstreamHeader(c, common.RequestIdKey, []string{"oneapi-1"}) {
		t.Fatal("X-Oneapi-Request-Id must not be copied to the client")
	}
	if got := c.GetString(common.UpstreamRequestIdKey); got != "oneapi-1" {
		t.Fatalf("got %q, want oneapi-1", got)
	}
}
