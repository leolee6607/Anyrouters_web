package openai

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func chatTextFromSSE(t *testing.T, body string) string {
	t.Helper()
	var text strings.Builder
	for _, line := range strings.Split(body, "\n") {
		if !strings.HasPrefix(line, "data: ") || line == "data: [DONE]" {
			continue
		}
		var chunk struct {
			Choices []struct {
				Delta struct {
					Content *string `json:"content"`
				} `json:"delta"`
			} `json:"choices"`
		}
		require.NoError(t, json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &chunk))
		for _, choice := range chunk.Choices {
			if choice.Delta.Content != nil {
				text.WriteString(*choice.Delta.Content)
			}
		}
	}
	return text.String()
}

func newResponsesChatStreamTest(t *testing.T, body string) (*gin.Context, *httptest.ResponseRecorder, *http.Response, *relaycommon.RelayInfo) {
	t.Helper()
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	c.Set(common.RequestIdKey, "req-stream-test")
	resp := &http.Response{Body: io.NopCloser(strings.NewReader(body))}
	info := &relaycommon.RelayInfo{
		RelayFormat: types.RelayFormatOpenAI,
		ChannelMeta: &relaycommon.ChannelMeta{
			UpstreamModelName: "gpt-5.5",
		},
	}
	return c, recorder, resp, info
}

func TestOaiResponsesToChatStreamHandlerIncompleteMapsToLength(t *testing.T) {
	body := strings.Join([]string{
		`data: {"type":"response.output_text.delta","delta":"这三个产品如果要卖得好，一定要"}`,
		`data: {"type":"response.incomplete","response":{"id":"resp_1","status":"incomplete","model":"gpt-5.5","incomplete_details":{"reason":"max_output_tokens"},"usage":{"input_tokens":10,"output_tokens":20,"total_tokens":30}}}`,
		"",
	}, "\n")
	c, recorder, resp, info := newResponsesChatStreamTest(t, body)

	usage, apiErr := OaiResponsesToChatStreamHandler(c, info, resp)

	require.Nil(t, apiErr)
	require.Equal(t, 30, usage.TotalTokens)
	require.Contains(t, recorder.Body.String(), `"finish_reason":"length"`)
	require.Contains(t, recorder.Body.String(), `data: [DONE]`)
	// A max-token terminal event is a complete protocol exchange, not a
	// transport EOF; retain finish_reason=length while logging normal completion.
	require.Equal(t, relaycommon.StreamEndReasonDone, info.StreamStatus.EndReason)
}

func TestOaiResponsesToChatStreamHandlerCompletedWithoutDoneIsValid(t *testing.T) {
	body := strings.Join([]string{
		`data: {"type":"response.output_text.delta","delta":"complete answer"}`,
		`data: {"type":"response.completed","response":{"id":"resp_1","status":"completed","model":"gpt-5.5"}}`,
		"",
	}, "\n")
	c, recorder, resp, info := newResponsesChatStreamTest(t, body)

	_, apiErr := OaiResponsesToChatStreamHandler(c, info, resp)

	require.Nil(t, apiErr)
	require.Contains(t, recorder.Body.String(), `"finish_reason":"stop"`)
	require.Contains(t, recorder.Body.String(), `data: [DONE]`)
}

func TestOaiResponsesToChatStreamHandlerEOFDoesNotFakeStop(t *testing.T) {
	body := "data: {\"type\":\"response.output_text.delta\",\"delta\":\"partial answer\"}\n"
	c, recorder, resp, info := newResponsesChatStreamTest(t, body)

	_, apiErr := OaiResponsesToChatStreamHandler(c, info, resp)

	require.NotNil(t, apiErr)
	require.Equal(t, types.ErrorCode("network_error"), apiErr.GetErrorCode())
	require.True(t, types.IsSkipRetryError(apiErr))
	require.NotContains(t, recorder.Body.String(), `"finish_reason":"stop"`)
	require.NotContains(t, recorder.Body.String(), `data: [DONE]`)
	require.Equal(t, relaycommon.StreamEndReasonEOF, info.StreamStatus.EndReason)
}

func TestResponsesStreamTerminationErrorClassification(t *testing.T) {
	tests := []struct {
		reason relaycommon.StreamEndReason
		code   types.ErrorCode
		status int
	}{
		{relaycommon.StreamEndReasonTimeout, types.ErrorCode("upstream_timeout"), http.StatusGatewayTimeout},
		{relaycommon.StreamEndReasonClientGone, types.ErrorCode("client_abort"), 499},
		{relaycommon.StreamEndReasonScannerErr, types.ErrorCode("network_error"), http.StatusBadGateway},
	}
	for _, test := range tests {
		status := relaycommon.NewStreamStatus()
		status.SetEndReason(test.reason, nil)

		apiErr := responsesStreamTerminationError(status)

		require.Equal(t, test.code, apiErr.GetErrorCode())
		require.Equal(t, test.status, apiErr.StatusCode)
		require.True(t, types.IsSkipRetryError(apiErr))
	}
}

func TestControlledGPT55LongStreamTextAndUsageAreConsistent(t *testing.T) {
	const segment = "产品定位、渠道匹配和持续复购必须形成闭环。"
	expected := strings.Repeat(segment, 512)
	expectedRunes := []rune(expected)
	var upstream strings.Builder
	for offset := 0; offset < len(expectedRunes); offset += 85 {
		end := offset + 85
		if end > len(expectedRunes) {
			end = len(expectedRunes)
		}
		event, err := json.Marshal(map[string]any{
			"type":  "response.output_text.delta",
			"delta": string(expectedRunes[offset:end]),
		})
		require.NoError(t, err)
		upstream.WriteString("data: ")
		upstream.Write(event)
		upstream.WriteByte('\n')
	}
	upstream.WriteString(`data: {"type":"response.completed","response":{"id":"resp_controlled_gpt55","status":"completed","model":"gpt-5.5","usage":{"input_tokens":128,"output_tokens":4096,"total_tokens":4224}}}`)
	upstream.WriteByte('\n')

	c, recorder, resp, info := newResponsesChatStreamTest(t, upstream.String())
	usage, apiErr := OaiResponsesToChatStreamHandler(c, info, resp)

	require.Nil(t, apiErr)
	rendered := chatTextFromSSE(t, recorder.Body.String())
	require.Equal(t, expected, rendered)
	require.Equal(t, len(expected), len(rendered))
	require.Equal(t, 4224, usage.TotalTokens)
	t.Logf("request_id=req-stream-test finish_reason=stop usage_total=%d server_text_bytes=%d client_text_bytes=%d",
		usage.TotalTokens, len(expected), len(rendered))
}
