package gemini

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func bananaInfo() *relaycommon.RelayInfo {
	return &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{ChannelType: constant.ChannelTypeVertexAi, UpstreamModelName: "gemini-nano-banana-2.1"}}
}
func TestNanoBananaChatConversion(t *testing.T) {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	for _, size := range []string{"1K", "2K", "4K"} {
		var req dto.GeneralOpenAIRequest
		require.NoError(t, common.UnmarshalJsonStr(`{"model":"gemini-nano-banana-2.1","messages":[{"role":"user","content":"Draw a circle"}],"reasoning_effort":"minimal","extra_body":{"google":{"image_config":{"image_size":"`+size+`","aspect_ratio":"1:1"}}}}`, &req))
		out, err := CovertOpenAI2Gemini(c, req, bananaInfo())
		require.NoError(t, err)
		require.Equal(t, []string{"TEXT", "IMAGE"}, out.GenerationConfig.ResponseModalities)
		require.NotNil(t, out.GenerationConfig.ThinkingConfig)
		require.Equal(t, "minimal", out.GenerationConfig.ThinkingConfig.ThinkingLevel)
		require.JSONEq(t, `{"imageSize":"`+size+`","aspectRatio":"1:1"}`, string(out.GenerationConfig.ImageConfig))
	}
}
func TestNanoBananaRejectsUnsupportedChatParameters(t *testing.T) {
	for _, field := range []string{`"temperature":0`, `"top_p":0`, `"top_k":0`, `"seed":0`, `"logprobs":false`, `"n":2`, `"reasoning_effort":"low"`, `"max_tokens":32769`, `"extra_body":{"google":{"image_config":{"image_size":"0.5K"}}}`, `"extra_body":{"google":{"thinking_config":{"thinking_budget":0}}}`, `"reasoning_effort":"high","extra_body":{"google":{"thinking_config":{"thinking_level":"minimal"}}}`} {
		t.Run(field, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			var req dto.GeneralOpenAIRequest
			require.NoError(t, common.UnmarshalJsonStr(`{"model":"gemini-nano-banana-2.1","messages":[{"role":"user","content":"Draw"}],`+field+`}`, &req))
			_, err := CovertOpenAI2Gemini(c, req, bananaInfo())
			var apiErr *types.NewAPIError
			require.ErrorAs(t, err, &apiErr)
			require.Equal(t, 400, apiErr.StatusCode)
			require.True(t, types.IsSkipRetryError(apiErr))
		})
	}
}
func TestNanoBananaNativeConversion(t *testing.T) {
	a := &Adaptor{}
	req := &dto.GeminiChatRequest{Contents: []dto.GeminiChatContent{{Parts: []dto.GeminiPart{{Text: "Draw"}}}}}
	_, err := a.ConvertGeminiRequest(nil, bananaInfo(), req)
	require.NoError(t, err)
	require.Equal(t, []string{"TEXT", "IMAGE"}, req.GenerationConfig.ResponseModalities)
	req.GenerationConfig.Temperature = common.GetPointer(0.0)
	_, err = a.ConvertGeminiRequest(nil, bananaInfo(), req)
	var apiErr *types.NewAPIError
	require.ErrorAs(t, err, &apiErr)
	require.Equal(t, 400, apiErr.StatusCode)
	require.True(t, types.IsSkipRetryError(apiErr))
	old := bananaInfo()
	old.UpstreamModelName = "gemini-3.1-flash-image"
	_, err = a.ConvertGeminiRequest(nil, old, req)
	require.NoError(t, err)
	require.NotNil(t, req.GenerationConfig.Temperature)
}

func TestNanoBananaRecitationDoesNotSettle(t *testing.T) {
	const body = `{"candidates":[{"content":{"role":"model"},"finishReason":"IMAGE_RECITATION"}],"usageMetadata":{"promptTokenCount":16,"totalTokenCount":16}}`
	for _, native := range []bool{false, true} {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		resp := &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(body))}
		var usage *dto.Usage
		var err *types.NewAPIError
		if native {
			usage, err = GeminiTextGenerationHandler(c, bananaInfo(), resp)
		} else {
			usage, err = GeminiChatHandler(c, bananaInfo(), resp)
		}
		require.NotNil(t, err)
		require.Equal(t, 400, err.StatusCode)
		require.True(t, types.IsSkipRetryError(err))
		require.Nil(t, usage)
	}
}

func TestNanoBananaStreamRecitationDoesNotSettle(t *testing.T) {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/v1/chat/completions", nil)
	old := constant.StreamingTimeout
	constant.StreamingTimeout = 300
	t.Cleanup(func() { constant.StreamingTimeout = old })
	body := `data: {"candidates":[{"content":{"role":"model"},"finishReason":"IMAGE_RECITATION"}],"usageMetadata":{"promptTokenCount":16,"totalTokenCount":16}}` + "\n\n"
	called := false
	usage, err := geminiStreamHandler(c, bananaInfo(), &http.Response{Body: io.NopCloser(strings.NewReader(body))}, func(_ string, _ *dto.GeminiChatResponse) bool { called = true; return true })
	require.NotNil(t, err)
	require.Nil(t, usage)
	require.False(t, called)
	require.True(t, types.IsSkipRetryError(err))
}
func TestNanoBananaDraftImagesAndUsage(t *testing.T) {
	const body = `{"candidates":[{"content":{"parts":[{"thought":true,"inlineData":{"mimeType":"image/png","data":"DRAFT"}},{"inlineData":{"mimeType":"image/png","data":"FINAL"}}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":40,"candidatesTokenCount":1120,"totalTokenCount":1160,"candidatesTokensDetails":[{"modality":"IMAGE","tokenCount":1120}]}}`
	var response dto.GeminiChatResponse
	require.NoError(t, common.UnmarshalJsonStr(body, &response))
	filterBananaDraftImages("gemini-nano-banana-2.1", &response)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	full := responseGeminiChat2OpenAI(c, &response)
	require.Contains(t, full.Choices[0].Message.Content, "FINAL")
	require.NotContains(t, full.Choices[0].Message.Content, "DRAFT")
	stream, _ := streamResponseGeminiChat2OpenAI(&response)
	b, e := common.Marshal(stream)
	require.NoError(t, e)
	require.Contains(t, string(b), "FINAL")
	require.NotContains(t, string(b), "DRAFT")
	usage := buildUsageFromGeminiMetadata(response.UsageMetadata, 0)
	require.Equal(t, 40, usage.PromptTokens)
	require.Equal(t, 1120, usage.CompletionTokens)
	require.Equal(t, 1120, usage.CompletionTokenDetails.ImageTokens)
	require.NoError(t, common.UnmarshalJsonStr(body, &response))
	filterBananaDraftImages("gemini-3.1-flash-image", &response)
	require.Len(t, response.Candidates[0].Content.Parts, 2)
}
