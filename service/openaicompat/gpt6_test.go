package openaicompat

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/setting/model_setting"
	"github.com/samber/lo"
	"github.com/stretchr/testify/require"
)

func TestGPT6UsesResponsesWithoutLegacyPolicy(t *testing.T) {
	policy := model_setting.ChatCompletionsToResponsesPolicy{}
	for _, channelType := range []int{constant.ChannelTypeAzure, constant.ChannelTypeOpenAI} {
		require.True(t, ShouldChatCompletionsUseResponsesPolicy(policy, 3, channelType, "gpt-6-astra"))
		require.False(t, ShouldChatCompletionsUseResponsesPolicy(policy, 3, channelType, "gpt-5.6-sol"))
		require.False(t, ShouldChatCompletionsUseResponsesPolicy(policy, 3, channelType, "gpt-6-astra-fake"))
	}
	require.False(t, ShouldChatCompletionsUseResponsesPolicy(policy, 3, constant.ChannelTypeAws, "gpt-6-astra"))
}

func TestGPT6PlaygroundPayloadConvertsToolsAndParameters(t *testing.T) {
	var request dto.GeneralOpenAIRequest
	require.NoError(t, common.Unmarshal([]byte(`{"model":"gpt-6-astra","messages":[{"role":"user","content":"search"}],"max_tokens":128,"temperature":0.7,"top_p":1,"reasoning_effort":"low","stream":true,"tools":[{"type":"function","function":{"name":"web_search","parameters":{"type":"object","properties":{"query":{"type":"string"}}}}}]}`), &request))
	response, err := ChatCompletionsRequestToResponsesRequest(&request)
	require.NoError(t, err)
	require.Nil(t, response.Temperature)
	require.Nil(t, response.TopP)
	require.EqualValues(t, 128, *response.MaxOutputTokens)
	require.Equal(t, "low", response.Reasoning.Effort)
	require.True(t, *response.Stream)
	require.Contains(t, string(response.Tools), `"name":"web_search"`)
	require.Equal(t, lo.ToPtr(0.7), request.Temperature, "conversion must not mutate the caller")
}

func TestGPT6DoesNotSilentlyDisableReasoning(t *testing.T) {
	for _, effort := range []string{"none", "minimal"} {
		_, err := ChatCompletionsRequestToResponsesRequest(&dto.GeneralOpenAIRequest{Model: "gpt-6-astra", ReasoningEffort: effort, Messages: []dto.Message{{Role: "user", Content: "hi"}}})
		require.ErrorContains(t, err, "reasoning_effort")
	}
}

func TestGPT6ToolResultCanBeSentOnNextTurn(t *testing.T) {
	var req dto.GeneralOpenAIRequest
	require.NoError(t, common.Unmarshal([]byte(`{"model":"gpt-6-astra","reasoning_effort":"max","messages":[{"role":"user","content":"search"},{"role":"assistant","content":null,"tool_calls":[{"id":"call_search","type":"function","function":{"name":"web_search","arguments":"{\"query\":\"test\"}"}}]},{"role":"tool","tool_call_id":"call_search","content":"search result"}]}`), &req))
	got, err := ChatCompletionsRequestToResponsesRequest(&req)
	require.NoError(t, err)
	require.Equal(t, "max", got.Reasoning.Effort)
	data, err := common.Marshal(got)
	require.NoError(t, err)
	require.Contains(t, string(data), `"type":"function_call"`)
	require.Contains(t, string(data), `"type":"function_call_output"`)
	require.Contains(t, string(data), `"call_id":"call_search"`)
	require.Contains(t, string(data), `"output":"search result"`)
}

func TestGPT6ResponsesConversionPreservesUpstreamUsage(t *testing.T) {
	var response dto.OpenAIResponsesResponse
	require.NoError(t, common.Unmarshal([]byte(`{"id":"resp_astra","model":"gpt-6-astra","status":"completed","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"OK"}]}],"usage":{"input_tokens":200,"output_tokens":25,"total_tokens":225,"input_tokens_details":{"cached_tokens":100,"cache_write_tokens":50}}}`), &response))
	got, usage, err := ResponsesResponseToChatCompletionsResponse(&response, "chat_astra")
	require.NoError(t, err)
	require.Equal(t, "OK", got.Choices[0].Message.StringContent())
	require.Equal(t, 200, usage.PromptTokens)
	require.Equal(t, 25, usage.CompletionTokens)
	require.Equal(t, 100, usage.PromptTokensDetails.CachedTokens)
	require.Equal(t, 50, usage.PromptTokensDetails.CachedCreationTokens)
}

func TestGPT6TextAndToolCallsAreBothPreserved(t *testing.T) {
	var response dto.OpenAIResponsesResponse
	require.NoError(t, common.Unmarshal([]byte(`{"model":"gpt-6-astra","status":"completed","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Searching now"}]},{"type":"function_call","call_id":"call_search","name":"web_search","arguments":"{}"}]}`), &response))
	got, _, err := ResponsesResponseToChatCompletionsResponse(&response, "chat_astra")
	require.NoError(t, err)
	require.Equal(t, "Searching now", got.Choices[0].Message.StringContent())
	require.Equal(t, "tool_calls", got.Choices[0].FinishReason)
	require.Len(t, got.Choices[0].Message.ParseToolCalls(), 1)
}
