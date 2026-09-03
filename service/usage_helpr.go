package service

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/gin-gonic/gin"
)

//func GetPromptTokens(textRequest dto.GeneralOpenAIRequest, relayMode int) (int, error) {
//	switch relayMode {
//	case constant.RelayModeChatCompletions:
//		return CountTokenMessages(textRequest.Messages, textRequest.Model)
//	case constant.RelayModeCompletions:
//		return CountTokenInput(textRequest.Prompt, textRequest.Model), nil
//	case constant.RelayModeModerations:
//		return CountTokenInput(textRequest.Input, textRequest.Model), nil
//	}
//	return 0, errors.New("unknown relay mode")
//}

// Usage provenance markers, logged into other.admin_info.usage_source so the
// reconciliation tooling can distinguish upstream-reported numbers from local
// fallbacks (see docs/metering-audit/01 §6). Observability only: none of these
// affect billing.
const (
	// UsageSourcePartial: upstream reported usage for part of the request
	// (e.g. realtime sessions mixing upstream and local counting).
	UsageSourcePartial = "partial"
	// UsageSourceLocalEstimate: token counts came from local estimation.
	UsageSourceLocalEstimate = "local_estimate"
	// UsageSourceMissing: upstream returned no usable usage and no local
	// estimate was applied (tokens under-reported or defaulted).
	UsageSourceMissing = "missing"
)

func usageSourceRank(source string) int {
	switch source {
	case UsageSourceMissing:
		return 3
	case UsageSourceLocalEstimate:
		return 2
	case UsageSourcePartial:
		return 1
	default:
		return 0
	}
}

// MarkUsageSource records how this request's usage numbers were obtained.
// The most severe marker wins, so a partial marker never hides a missing one.
func MarkUsageSource(c *gin.Context, source string) {
	if c == nil {
		return
	}
	current := common.GetContextKeyString(c, constant.ContextKeyUsageSource)
	if usageSourceRank(source) > usageSourceRank(current) {
		common.SetContextKey(c, constant.ContextKeyUsageSource, source)
	}
}

func ResponseText2Usage(c *gin.Context, responseText string, modeName string, promptTokens int) *dto.Usage {
	common.SetContextKey(c, constant.ContextKeyLocalCountTokens, true)
	MarkUsageSource(c, UsageSourceLocalEstimate)
	usage := &dto.Usage{}
	usage.PromptTokens = promptTokens
	usage.CompletionTokens = EstimateTokenByModel(modeName, responseText)
	usage.TotalTokens = usage.PromptTokens + usage.CompletionTokens
	return usage
}

func ValidUsage(usage *dto.Usage) bool {
	return usage != nil && (usage.PromptTokens != 0 || usage.CompletionTokens != 0)
}
