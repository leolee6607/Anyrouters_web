package openaicompat

import (
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/setting/model_setting"
)

func ShouldChatCompletionsUseResponsesPolicy(policy model_setting.ChatCompletionsToResponsesPolicy, channelID int, channelType int, model string) bool {
	// GPT-6 reasoning with tools requires Responses. This is a protocol capability,
	// not an optional legacy routing preference. Keep non-native providers out.
	if isGPT6Model(model) && (channelType == constant.ChannelTypeAzure || channelType == constant.ChannelTypeOpenAI) {
		return true
	}
	if !policy.IsChannelEnabled(channelID, channelType) {
		return false
	}
	return matchAnyRegex(policy.ModelPatterns, model)
}

func ShouldChatCompletionsUseResponsesGlobal(channelID int, channelType int, model string) bool {
	return ShouldChatCompletionsUseResponsesPolicy(
		model_setting.GetGlobalSettings().ChatCompletionsToResponsesPolicy,
		channelID,
		channelType,
		model,
	)
}

// Match published IDs exactly; aliases on non-native providers have separate capabilities.
func isGPT6Model(model string) bool {
	switch model {
	case "gpt-6-astra", "gpt-6-sol", "gpt-6.1-sol", "gpt-6-luna":
		return true
	}
	return false
}

func gpt6AllowsNoReasoning(model string) bool {
	return model == "gpt-6-sol" || model == "gpt-6-luna"
}

// GPT-5.6 Luna/Terra Chat tools cannot be combined with reasoning. Responses
// supports both, including clients whose thinking alias is normalized later.
func NativeToolsRequireResponses(req *dto.GeneralOpenAIRequest, channelType int) bool {
	if req == nil || !IsNativeOpenAIChannel(channelType) || (len(req.Tools) == 0 && len(req.Functions) == 0) {
		return false
	}
	return req.Model == "gpt-5.6-luna" || req.Model == "gpt-5.6-terra"
}
