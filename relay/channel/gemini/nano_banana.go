package gemini

import (
	"errors"
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/setting/model_setting"
	"github.com/QuantumNous/new-api/types"
	"net/http"
)

func bananaInvalid(message string) *types.NewAPIError {
	return types.NewErrorWithStatusCode(errors.New("gemini-nano-banana-2.1: "+message), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
}

// Keep the new model's contract separate from existing Gemini model behavior.
func validateBananaChat(model string, r *dto.GeneralOpenAIRequest) error {
	if model != model_setting.GeminiNanoBanana21 {
		return nil
	}
	if r.Temperature != nil || r.TopP != nil || r.TopK != nil || r.Seed != nil || r.LogProbs != nil || r.TopLogProbs != nil {
		return bananaInvalid("temperature, top_p, top_k, seed and logprobs are not supported; omit these parameters")
	}
	if r.N != nil && *r.N != 1 {
		return bananaInvalid("n must be 1")
	}
	return nil
}

func configureBanana(model string, r *dto.GeminiChatRequest, effort string) error {
	if model != model_setting.GeminiNanoBanana21 {
		return nil
	}
	g := &r.GenerationConfig
	if g.Temperature != nil || g.TopP != nil || g.TopK != nil || g.Seed != nil || g.Logprobs != nil || g.ResponseLogprobs != nil {
		return bananaInvalid("temperature, topP, topK, seed and logprobs are not supported; omit these parameters")
	}
	if len(r.Requests) > 0 {
		return bananaInvalid("batch requests are not supported on this endpoint")
	}
	if g.CandidateCount != nil && *g.CandidateCount != 1 {
		return bananaInvalid("candidateCount must be 1")
	}
	if g.MaxOutputTokens != nil && (*g.MaxOutputTokens == 0 || *g.MaxOutputTokens > 32768) {
		return bananaInvalid("maxOutputTokens must be between 1 and 32768")
	}
	if effort != "" {
		if g.ThinkingConfig == nil {
			g.ThinkingConfig = &dto.GeminiThinkingConfig{}
		}
		if g.ThinkingConfig.ThinkingLevel != "" && g.ThinkingConfig.ThinkingLevel != effort {
			return bananaInvalid("reasoning_effort conflicts with thinking_level")
		}
		g.ThinkingConfig.ThinkingLevel = effort
	}
	if t := g.ThinkingConfig; t != nil {
		if t.ThinkingBudget != nil {
			return bananaInvalid("thinking_budget is not supported; use thinking_level minimal, medium or high")
		}
		switch t.ThinkingLevel {
		case "", "minimal", "medium", "high":
		default:
			return bananaInvalid("thinking_level must be minimal, medium or high")
		}
	}
	if len(g.ImageConfig) > 0 {
		var image struct {
			Size      string `json:"imageSize"`
			SnakeSize string `json:"image_size"`
		}
		if err := common.Unmarshal(g.ImageConfig, &image); err != nil {
			return bananaInvalid("invalid imageConfig")
		}
		if image.SnakeSize != "" {
			return bananaInvalid("use imageConfig.imageSize for native Gemini requests")
		}
		switch image.Size {
		case "", "1K", "2K", "4K":
		default:
			return bananaInvalid("imageSize must be 1K, 2K or 4K")
		}
	}
	if len(g.ResponseModalities) == 0 {
		g.ResponseModalities = []string{"TEXT", "IMAGE"}
	}
	return nil
}

// Vertex explicitly reports this finish reason as uncharged, even though it
// returns HTTP 200 with prompt usage. Let the unified failure path refund it.
func bananaResponseError(model string, response *dto.GeminiChatResponse) *types.NewAPIError {
	if model != model_setting.GeminiNanoBanana21 {
		return nil
	}
	for _, candidate := range response.Candidates {
		if candidate.FinishReason != nil && *candidate.FinishReason == "IMAGE_RECITATION" {
			return types.NewErrorWithStatusCode(errors.New("image generation blocked by Google (IMAGE_RECITATION); no image generated and this request is not charged"), types.ErrorCodePromptBlocked, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
		}
	}
	return nil
}

func bananaUsageError(model string, usage *dto.Usage, hasImages bool) *types.NewAPIError {
	if model == model_setting.GeminiNanoBanana21 && (usage.TotalTokens <= 0 || (hasImages && usage.CompletionTokenDetails.ImageTokens <= 0)) {
		return types.NewErrorWithStatusCode(errors.New("incomplete image usage from Google; this request is not charged"), types.ErrorCodeBadResponseBody, http.StatusBadGateway, types.ErrOptionWithSkipRetry())
	}
	return nil
}

func bananaFullResponseUsageError(model string, response *dto.GeminiChatResponse) *types.NewAPIError {
	if model != model_setting.GeminiNanoBanana21 {
		return nil
	}
	hasImages := false
	for _, candidate := range response.Candidates {
		for _, part := range candidate.Content.Parts {
			hasImages = hasImages || (part.InlineData != nil && !part.Thought)
		}
	}
	usage := buildUsageFromGeminiMetadata(response.UsageMetadata, 0)
	return bananaUsageError(model, &usage, hasImages)
}

// Draft images marked thought are not final image outputs. Preserve native
// Gemini responses, but omit these drafts when presenting OpenAI chat content.
func filterBananaDraftImages(model string, response *dto.GeminiChatResponse) {
	if model != model_setting.GeminiNanoBanana21 {
		return
	}
	for i := range response.Candidates {
		content := &response.Candidates[i].Content
		parts := make([]dto.GeminiPart, 0, len(content.Parts))
		for _, part := range content.Parts {
			if part.Thought && part.InlineData != nil {
				continue
			}
			parts = append(parts, part)
		}
		content.Parts = parts
	}
}
