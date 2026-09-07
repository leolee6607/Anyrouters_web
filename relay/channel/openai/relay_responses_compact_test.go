package openai

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestCompactPreservesOpaqueOutputAndReportedUsage(t *testing.T) {
	const body = `{"id":"resp_compact","object":"response.compaction","output":[{"type":"message","role":"user","content":[{"type":"input_text","text":"keep this"}]},{"type":"compaction","encrypted_content":"opaque-fixture-do-not-rewrite"}],"usage":{"input_tokens":1000,"output_tokens":25,"total_tokens":1025,"input_tokens_details":{"cached_tokens":200,"cache_write_tokens":100}}}`
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/responses/compact", nil)
	resp := &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(body))}
	usage, apiErr := OaiResponsesCompactionHandler(ctx, resp)
	require.Nil(t, apiErr)
	require.Equal(t, body, recorder.Body.String(), "forward the entire compacted window, not only the compaction item")
	require.Equal(t, 1000, usage.PromptTokens)
	require.Equal(t, 25, usage.CompletionTokens)
	require.Equal(t, 200, usage.PromptTokensDetails.CachedTokens)
	require.Equal(t, 100, usage.PromptTokensDetails.CachedCreationTokens)
}
