package openai

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestOaiStreamUsageRetention(t *testing.T) {
	gin.SetMode(gin.TestMode)
	content := `{"id":"test","model":"gpt-5.5","choices":[{"index":0,"delta":{"content":"hello"}}]}`
	usageFrame := `{"id":"test","model":"gpt-5.5","choices":[],"usage":{"prompt_tokens":100,"completion_tokens":8,"total_tokens":108,"prompt_tokens_details":{"cached_tokens":80}}}`
	earlierUsage := `{"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":2,"total_tokens":102}}`
	finish := `{"id":"test","model":"gpt-5.5","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}`
	emptyUsage := `{"choices":[],"usage":{"prompt_tokens":0,"completion_tokens":0,"total_tokens":0}}`
	for _, tc := range []struct {
		name   string
		frames []string
		local  bool
		model  string
	}{
		{"usage_then_finish", []string{content, usageFrame, finish}, false, "gpt-5.5"},
		{"normal_final_usage", []string{content, finish, usageFrame}, false, "gpt-5.5"},
		{"ignore_empty_usage", []string{content, usageFrame, emptyUsage}, false, "gpt-5.5"},
		{"latest_snapshot_not_sum", []string{content, earlierUsage, usageFrame, finish}, false, "gpt-5.5"},
		{"audio_trailing_frames", []string{content, usageFrame, finish, finish}, false, "gpt-4o-audio-preview"},
		{"missing_usage_fallback", []string{content, finish}, true, "gpt-5.5"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
			var body strings.Builder
			for _, frame := range tc.frames {
				body.WriteString("data: " + frame + "\n\n")
			}
			body.WriteString("data: [DONE]\n\n")
			resp := &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body.String()))}
			info := &relaycommon.RelayInfo{IsStream: true, ShouldIncludeUsage: true, RelayMode: relayconstant.RelayModeChatCompletions, RelayFormat: types.RelayFormatOpenAI, ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: tc.model}}
			usage, apiErr := OaiStreamHandler(c, info, resp)
			require.Nil(t, apiErr)
			require.Equal(t, tc.local, common.GetContextKeyBool(c, constant.ContextKeyLocalCountTokens))
			if !tc.local {
				require.Equal(t, 100, usage.PromptTokens)
				require.Equal(t, 8, usage.CompletionTokens)
				require.Equal(t, 108, usage.TotalTokens)
				require.Equal(t, 80, usage.PromptTokensDetails.CachedTokens)
			} else {
				require.Positive(t, usage.CompletionTokens)
			}
			require.Equal(t, 1, strings.Count(recorder.Body.String(), "data: [DONE]"))
		})
	}
}
