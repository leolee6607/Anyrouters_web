package openaicompat

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/types"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestNativeThinkingAliases(t *testing.T) {
	for _, tc := range []struct{ name, fields, want string }{
		{"disabled", `"thinking":{"type":"disabled"}`, "none"},
		{"boolean disabled", `"thinking":false`, "none"},
		{"enable false", `"enable_thinking":false`, "none"},
		{"enabled default", `"thinking":{"type":"enabled"}`, ""},
		{"enabled explicit", `"thinking":true,"reasoning_effort":"high"`, "high"},
		{"null", `"thinking":null`, ""},
		{"reasoning alias", `"reasoning":{"effort":"low","enabled":true}`, "low"},
		{"consistent aliases", `"thinking":false,"enable_thinking":false,"reasoning_effort":"none"`, "none"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var req dto.GeneralOpenAIRequest
			require.NoError(t, common.Unmarshal([]byte(`{"model":"gpt-5.6-luna",`+tc.fields+`}`), &req))
			require.NoError(t, NormalizeNativeChatParameters(&req, constant.ChannelTypeAzure))
			require.Equal(t, tc.want, req.ReasoningEffort)
			require.Empty(t, req.THINKING)
			require.Empty(t, req.EnableThinking)
			require.Empty(t, req.Reasoning)
		})
	}
}

func TestNativeThinkingRejectsAmbiguityWithoutRetry(t *testing.T) {
	for _, fields := range []string{
		`"thinking":{"type":"enabled","budget_tokens":1024}`,
		`"thinking":{"type":"adaptive"}`,
		`"thinking":{}`, `"thinking":"false"`,
		`"thinking":false,"reasoning_effort":"low"`,
		`"thinking":true,"reasoning_effort":"none"`,
		`"thinking":true,"enable_thinking":false`,
		`"enable_thinking":"false"`,
		`"reasoning":{"effort":"low"},"reasoning_effort":"high"`,
		`"reasoning":{"enabled":null}`, `"reasoning":{"max_tokens":2048}`,
		`"reasoning_effort":"invalid"`,
	} {
		t.Run(fields, func(t *testing.T) {
			var req dto.GeneralOpenAIRequest
			require.NoError(t, common.Unmarshal([]byte(`{"model":"gpt-5.6-luna",`+fields+`}`), &req))
			err := NormalizeNativeChatParameters(&req, constant.ChannelTypeAzure)
			var apiErr *types.NewAPIError
			require.ErrorAs(t, err, &apiErr)
			require.Equal(t, 400, apiErr.StatusCode)
			require.True(t, types.IsSkipRetryError(apiErr))
		})
	}
}

func TestNativeSamplingAcrossFamiliesAndEndpoints(t *testing.T) {
	for _, model := range []string{"gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-6-sol", "gpt-6-luna", "gpt-6-astra", "gpt-6.1-sol"} {
		for _, effort := range []string{"", "low", "none"} {
			t.Run(model+"/"+effort, func(t *testing.T) {
				chat := &dto.GeneralOpenAIRequest{Model: model, ReasoningEffort: effort, Temperature: common.GetPointer(0.0), TopP: common.GetPointer(0.0), LogProbs: common.GetPointer(false), TopLogProbs: common.GetPointer(0)}
				response := &dto.OpenAIResponsesRequest{Model: model, Reasoning: &dto.Reasoning{Effort: effort, Summary: "auto"}, Temperature: common.GetPointer(0.0), TopP: common.GetPointer(0.0), TopLogProbs: common.GetPointer(0), Include: []byte(`["reasoning.encrypted_content","message.output_text.logprobs"]`)}
				chatErr := NormalizeNativeChatParameters(chat, constant.ChannelTypeAzure)
				respErr := NormalizeNativeResponsesParameters(response, constant.ChannelTypeAzure)
				if effort == "none" && (model == "gpt-6-astra" || model == "gpt-6.1-sol") {
					require.Error(t, chatErr)
					require.Error(t, respErr)
					return
				}
				require.NoError(t, chatErr)
				require.NoError(t, respErr)
				require.Equal(t, "auto", response.Reasoning.Summary)
				if effort == "none" {
					require.NotNil(t, chat.Temperature)
					require.Equal(t, 0.0, *chat.Temperature)
					require.NotNil(t, chat.LogProbs)
					require.False(t, *chat.LogProbs)
					require.NotNil(t, response.Temperature)
					require.NotNil(t, response.TopLogProbs)
					require.Contains(t, string(response.Include), "message.output_text.logprobs")
				} else {
					require.Nil(t, chat.Temperature)
					require.Nil(t, chat.TopP)
					require.Nil(t, chat.LogProbs)
					require.Nil(t, chat.TopLogProbs)
					require.Nil(t, response.Temperature)
					require.Nil(t, response.TopP)
					require.Nil(t, response.TopLogProbs)
					require.JSONEq(t, `["reasoning.encrypted_content"]`, string(response.Include))
				}
			})
		}
	}
}

func TestNativeNormalizationPreservesOtherProvidersAndModels(t *testing.T) {
	for _, tc := range []struct {
		channel int
		model   string
	}{
		{constant.ChannelTypeOpenRouter, "gpt-5.6-luna"},
		{constant.ChannelTypeGemini, "gemini-3.8-flash"},
		{constant.ChannelTypeAnthropic, "claude-sonnet-4-6"},
		{constant.ChannelTypeOpenAI, "gpt-4o"},
		{constant.ChannelTypeOpenAI, "vendor-custom-gpt"},
	} {
		t.Run(tc.model, func(t *testing.T) {
			req := &dto.GeneralOpenAIRequest{Model: tc.model, THINKING: []byte(`{"type":"enabled","budget_tokens":1024}`), Temperature: common.GetPointer(0.0)}
			before, err := common.Marshal(req)
			require.NoError(t, err)
			require.NoError(t, NormalizeNativeChatParameters(req, tc.channel))
			after, err := common.Marshal(req)
			require.NoError(t, err)
			require.Equal(t, string(before), string(after))
		})
	}
}

func TestNativeResponsesAliasesPreserveSummary(t *testing.T) {
	var req dto.OpenAIResponsesRequest
	require.NoError(t, common.Unmarshal([]byte(`{"model":"gpt-5.6-luna","thinking":false,"reasoning":{"summary":"auto"}}`), &req))
	require.NoError(t, NormalizeNativeResponsesParameters(&req, constant.ChannelTypeAzure))
	require.Equal(t, "none", req.Reasoning.Effort)
	require.Equal(t, "auto", req.Reasoning.Summary)
	require.Empty(t, req.THINKING)
	req.ReasoningEffort = "high"
	require.Error(t, NormalizeNativeResponsesParameters(&req, constant.ChannelTypeAzure))
}

func TestNativeToolsUseResponsesWithoutChangingOtherProviders(t *testing.T) {
	for _, model := range []string{"gpt-5.6-luna", "gpt-5.6-terra"} {
		req := &dto.GeneralOpenAIRequest{Model: model, Tools: []dto.ToolCallRequest{{Type: "function"}}}
		require.True(t, NativeToolsRequireResponses(req, constant.ChannelTypeAzure))
		require.False(t, NativeToolsRequireResponses(req, constant.ChannelTypeOpenRouter))
		req.Tools = nil
		require.False(t, NativeToolsRequireResponses(req, constant.ChannelTypeAzure))
	}
}
