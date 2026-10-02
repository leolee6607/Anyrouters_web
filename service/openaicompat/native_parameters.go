package openaicompat

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/types"
)

// Native parameter normalization must not change OpenRouter/Claude/Gemini semantics.
func IsNativeOpenAIChannel(channelType int) bool {
	return channelType == constant.ChannelTypeOpenAI || channelType == constant.ChannelTypeAzure
}

func nativeReasoningModel(model string) bool {
	return strings.HasPrefix(model, "gpt-5") || isGPT6Model(model)
}

func knownEffortModel(model string) bool {
	switch model {
	case "gpt-5.6", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna":
		return true
	}
	return isGPT6Model(model)
}

func parameterError(message string) error {
	return types.NewErrorWithStatusCode(fmt.Errorf("%s", message), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
}

// Translate only equivalent controls. Token budgets cannot be faithfully mapped
// to qualitative OpenAI effort levels, so require an explicit client correction.
func resolveNativeEffort(model, effort string, thinking, enabled, reasoning json.RawMessage) (string, error) {
	var requestedEnabled *bool
	mergeEnabled := func(v bool) error {
		if requestedEnabled != nil && *requestedEnabled != v {
			return parameterError("conflicting thinking controls; use only reasoning_effort (Chat) or reasoning.effort (Responses)")
		}
		requestedEnabled = &v
		return nil
	}
	mergeEffort := func(v string) error {
		if v == "" {
			return parameterError("reasoning.effort must be a non-empty string")
		}
		if effort != "" && effort != v {
			return parameterError("conflicting reasoning effort controls; use only reasoning_effort (Chat) or reasoning.effort (Responses)")
		}
		effort = v
		return nil
	}
	present := func(v json.RawMessage) bool { return len(v) > 0 && strings.TrimSpace(string(v)) != "null" }
	if present(thinking) {
		var flag bool
		if err := common.Unmarshal(thinking, &flag); err == nil {
			if err := mergeEnabled(flag); err != nil {
				return "", err
			}
		} else {
			var obj map[string]json.RawMessage
			if err := common.Unmarshal(thinking, &obj); err != nil || len(obj) == 0 {
				return "", parameterError("thinking must be a boolean or an object with type enabled/disabled; use reasoning_effort for OpenAI models")
			}
			for key := range obj {
				if key != "type" {
					return "", parameterError("thinking." + key + " cannot be mapped to OpenAI reasoning effort; remove thinking and set reasoning_effort (Chat) or reasoning.effort (Responses)")
				}
			}
			var mode string
			if err := common.Unmarshal(obj["type"], &mode); err != nil || (mode != "enabled" && mode != "disabled") {
				return "", parameterError("thinking.type must be enabled or disabled; use reasoning_effort for OpenAI models")
			}
			if err := mergeEnabled(mode == "enabled"); err != nil {
				return "", err
			}
		}
	}
	if present(enabled) {
		var flag bool
		if err := common.Unmarshal(enabled, &flag); err != nil {
			return "", parameterError("enable_thinking must be a boolean; use reasoning_effort for OpenAI models")
		}
		if err := mergeEnabled(flag); err != nil {
			return "", err
		}
	}
	if present(reasoning) {
		var obj map[string]json.RawMessage
		if err := common.Unmarshal(reasoning, &obj); err != nil || len(obj) == 0 {
			return "", parameterError("Chat reasoning must contain effort; use reasoning_effort for OpenAI models")
		}
		for key, value := range obj {
			switch key {
			case "effort":
				var v string
				if err := common.Unmarshal(value, &v); err != nil {
					return "", parameterError("reasoning.effort must be a string")
				}
				if err := mergeEffort(v); err != nil {
					return "", err
				}
			case "enabled":
				var v bool
				if string(value) == "null" {
					return "", parameterError("reasoning.enabled must be a boolean")
				}
				if err := common.Unmarshal(value, &v); err != nil {
					return "", parameterError("reasoning.enabled must be a boolean")
				}
				if err := mergeEnabled(v); err != nil {
					return "", err
				}
			default:
				return "", parameterError("reasoning." + key + " is not supported in Chat compatibility mode; use reasoning_effort or the Responses API")
			}
		}
	}
	if requestedEnabled != nil {
		if !*requestedEnabled {
			if effort != "" && effort != "none" {
				return "", parameterError("thinking is disabled but reasoning effort is enabled; use one consistent reasoning control")
			}
			// Only claim none compatibility for models whose published capability is known.
			if !knownEffortModel(model) || (isGPT6Model(model) && !gpt6AllowsNoReasoning(model)) {
				return "", parameterError(model + " does not support this disabled thinking control; select a supported reasoning_effort explicitly")
			}
			effort = "none"
		} else {
			if effort == "none" {
				return "", parameterError("thinking is enabled but reasoning effort is none; use one consistent reasoning control")
			}
			if effort == "" {
				if !knownEffortModel(model) {
					return "", parameterError("set reasoning_effort explicitly for " + model + " instead of thinking")
				}
				// Known models default to enabled reasoning. Leave the upstream default intact.
			}
		}
	}
	if knownEffortModel(model) {
		switch effort {
		case "", "low", "medium", "high", "xhigh", "max":
		case "none":
			if isGPT6Model(model) && !gpt6AllowsNoReasoning(model) {
				return "", parameterError(model + " does not support reasoning effort none; use low or another supported effort")
			}
		default:
			return "", parameterError(model + " has an unsupported reasoning effort; use a supported reasoning_effort (Chat) or reasoning.effort (Responses)")
		}
	}
	return effort, nil
}

func removeNativeSampling(model, effort string) bool {
	// Preserve the existing legacy GPT-5 rule, while allowing documented none mode
	// for the current model families. Reasoning mode rejects these controls upstream.
	return nativeReasoningModel(model) && !(knownEffortModel(model) && effort == "none")
}

func NormalizeNativeChatParameters(req *dto.GeneralOpenAIRequest, channelType int) error {
	return normalizeNativeChatParameters(req, channelType, true)
}

// The Responses bridge historically preserved legacy GPT-5 sampling controls.
// Keep that boundary distinct from the direct Chat adaptor's older rule.
func NormalizeNativeChatParametersForResponses(req *dto.GeneralOpenAIRequest, channelType int) error {
	return normalizeNativeChatParameters(req, channelType, false)
}

func normalizeNativeChatParameters(req *dto.GeneralOpenAIRequest, channelType int, stripLegacySampling bool) error {
	if req == nil || !IsNativeOpenAIChannel(channelType) || !nativeReasoningModel(req.Model) {
		return nil
	}
	effort, err := resolveNativeEffort(req.Model, req.ReasoningEffort, req.THINKING, req.EnableThinking, req.Reasoning)
	if err != nil {
		return err
	}
	req.ReasoningEffort = effort
	req.THINKING = nil
	req.EnableThinking = nil
	req.Reasoning = nil
	if (stripLegacySampling || knownEffortModel(req.Model)) && removeNativeSampling(req.Model, effort) {
		req.Temperature = nil
		req.TopP = nil
		req.LogProbs = nil
		req.TopLogProbs = nil
	}
	return nil
}

func NormalizeNativeResponsesParameters(req *dto.OpenAIResponsesRequest, channelType int) error {
	if req == nil || !IsNativeOpenAIChannel(channelType) || !nativeReasoningModel(req.Model) {
		return nil
	}
	effort := ""
	if req.ReasoningEffort != nil {
		effort = *req.ReasoningEffort
		if effort == "" {
			return parameterError("reasoning_effort must be a non-empty string; use reasoning.effort for Responses")
		}
	}
	if req.Reasoning != nil && req.Reasoning.Effort != "" {
		if effort != "" && effort != req.Reasoning.Effort {
			return parameterError("conflicting reasoning_effort and reasoning.effort; use reasoning.effort for Responses")
		}
		effort = req.Reasoning.Effort
	}
	effort, err := resolveNativeEffort(req.Model, effort, req.THINKING, req.EnableThinking, nil)
	if err != nil {
		return err
	}
	if effort != "" {
		if req.Reasoning == nil {
			req.Reasoning = &dto.Reasoning{}
		}
		req.Reasoning.Effort = effort
	}
	req.ReasoningEffort = nil
	req.THINKING = nil
	req.EnableThinking = nil
	// Responses previously preserved legacy model sampling. Only normalize the
	// current families whose capabilities are verified; do not apply Chat's
	// historical blanket GPT-5 stripping rule to older Responses requests.
	if knownEffortModel(req.Model) && removeNativeSampling(req.Model, effort) {
		req.Temperature = nil
		req.TopP = nil
		req.TopLogProbs = nil
		if len(req.Include) > 0 {
			var include []string
			if err := common.Unmarshal(req.Include, &include); err != nil {
				return parameterError("include must be an array of strings")
			}
			filtered := make([]string, 0, len(include))
			for _, v := range include {
				if v != "message.output_text.logprobs" {
					filtered = append(filtered, v)
				}
			}
			if len(filtered) == 0 {
				req.Include = nil
			} else {
				req.Include, err = common.Marshal(filtered)
				if err != nil {
					return err
				}
			}
		}
	}
	return nil
}
