package relay

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	openaichannel "github.com/QuantumNous/new-api/relay/channel/openai"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

type nativeParamsCapture struct {
	openaichannel.Adaptor
	body  []byte
	calls int
}

func (a *nativeParamsCapture) DoRequest(c *gin.Context, info *relaycommon.RelayInfo, body io.Reader) (any, error) {
	a.calls++
	var err error
	a.body, err = io.ReadAll(body)
	return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(`{"id":"resp_test","object":"response","status":"completed","model":"gpt-5.6-sol","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"OK"}]}],"usage":{"input_tokens":10,"output_tokens":2,"total_tokens":12}}`))}, err
}

func TestNativeParametersOnProductionChatBridge(t *testing.T) {
	for _, tc := range []struct {
		name, fields, effort string
		bad                  bool
	}{
		{"Sol legacy sampling", `"temperature":0.7,"top_p":1,"reasoning_effort":"low"`, "low", false},
		{"disabled alias", `"thinking":{"type":"disabled"}`, "none", false},
		{"enabled alias", `"thinking":true,"reasoning_effort":"low"`, "low", false},
		{"legacy functions rejected before upstream", `"functions":[{"name":"echo","parameters":{"type":"object"}}],"function_call":{"name":"echo"}`, "", true},
		{"legacy function history rejected before upstream", `"messages":[{"role":"function","name":"echo","content":"OK"}]`, "", true},
		{"legacy function choice rejected before upstream", `"function_call":"auto"`, "", true},
		{"budget rejected before upstream", `"thinking":{"type":"enabled","budget_tokens":1024}`, "", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var req dto.GeneralOpenAIRequest
			require.NoError(t, common.Unmarshal([]byte(`{"model":"gpt-5.6-sol","messages":[{"role":"user","content":"OK"}],`+tc.fields+`}`), &req))
			c, rec := gin.CreateTestContext(httptest.NewRecorder())
			_ = rec
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
			info := &relaycommon.RelayInfo{RelayFormat: types.RelayFormatOpenAI, ChannelMeta: &relaycommon.ChannelMeta{ChannelType: constant.ChannelTypeAzure, UpstreamModelName: req.Model}}
			a := &nativeParamsCapture{}
			usage, err := chatCompletionsViaResponses(c, info, a, &req)
			if tc.bad {
				require.NotNil(t, err)
				require.Equal(t, 400, err.StatusCode)
				require.True(t, types.IsSkipRetryError(err))
				require.Zero(t, a.calls)
				return
			}
			require.Nil(t, err)
			require.Equal(t, 12, usage.TotalTokens)
			var sent dto.OpenAIResponsesRequest
			require.NoError(t, common.Unmarshal(a.body, &sent))
			require.NotNil(t, sent.Reasoning)
			require.Equal(t, tc.effort, sent.Reasoning.Effort)
			require.Empty(t, sent.THINKING)
			require.Empty(t, sent.EnableThinking)
			require.Nil(t, sent.Temperature)
			require.Nil(t, sent.TopP)
		})
	}
}

func TestNativeChatBridgePreservesLegacySampling(t *testing.T) {
	req := &dto.GeneralOpenAIRequest{Model: "gpt-5.2", ReasoningEffort: "none", Temperature: common.GetPointer(0.0), TopP: common.GetPointer(0.8), Messages: []dto.Message{{Role: "user", Content: "OK"}}}
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	info := &relaycommon.RelayInfo{RelayFormat: types.RelayFormatOpenAI, ChannelMeta: &relaycommon.ChannelMeta{ChannelType: constant.ChannelTypeAzure, UpstreamModelName: req.Model}}
	a := &nativeParamsCapture{}
	_, err := chatCompletionsViaResponses(c, info, a, req)
	require.Nil(t, err)
	var sent dto.OpenAIResponsesRequest
	require.NoError(t, common.Unmarshal(a.body, &sent))
	require.Equal(t, common.GetPointer(0.0), sent.Temperature)
	require.Equal(t, common.GetPointer(0.8), sent.TopP)
	require.Equal(t, "none", sent.Reasoning.Effort)
}
