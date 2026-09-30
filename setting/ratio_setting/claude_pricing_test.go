package ratio_setting

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func resetRatioMapsForTest(t *testing.T) {
	t.Helper()

	modelPriceMap.Clear()
	modelRatioMap.Clear()
	completionRatioMap.Clear()
	cacheRatioMap.Clear()
	createCacheRatioMap.Clear()
	imageRatioMap.Clear()
	audioRatioMap.Clear()
	audioCompletionRatioMap.Clear()

	InitRatioSettings()
}

func TestClaudeSonnet46HasDefaultTokenAndCachePricing(t *testing.T) {
	resetRatioMapsForTest(t)

	modelRatio, ok, matchName := GetModelRatio("claude-sonnet-4-6")
	require.True(t, ok)
	require.Equal(t, "claude-sonnet-4-6", matchName)
	require.Equal(t, 1.5, modelRatio)
	require.Equal(t, 5.0, GetCompletionRatio("claude-sonnet-4-6"))

	cacheRatio, ok := GetCacheRatio("claude-sonnet-4-6")
	require.True(t, ok)
	require.Equal(t, 0.1, cacheRatio)

	createCacheRatio, ok := GetCreateCacheRatio("claude-sonnet-4-6")
	require.True(t, ok)
	require.Equal(t, 1.25, createCacheRatio)
}

func TestRatioOptionUpdatesMergeCompatibilityDefaultsWithoutOverridingCustomValues(t *testing.T) {
	resetRatioMapsForTest(t)

	require.NoError(t, UpdateModelRatioByJSONString(`{"custom-model":2}`))
	modelRatio, ok, _ := GetModelRatio("claude-sonnet-4-6")
	require.True(t, ok)
	require.Equal(t, 1.5, modelRatio)
	customRatio, ok, _ := GetModelRatio("custom-model")
	require.True(t, ok)
	require.Equal(t, 2.0, customRatio)

	require.NoError(t, UpdateCacheRatioByJSONString(`{"custom-model":0.25}`))
	cacheRatio, ok := GetCacheRatio("claude-sonnet-4-6")
	require.True(t, ok)
	require.Equal(t, 0.1, cacheRatio)
	customCacheRatio, ok := GetCacheRatio("custom-model")
	require.True(t, ok)
	require.Equal(t, 0.25, customCacheRatio)

	require.NoError(t, UpdateCreateCacheRatioByJSONString(`{"custom-model":1.5}`))
	createCacheRatio, ok := GetCreateCacheRatio("claude-sonnet-4-6")
	require.True(t, ok)
	require.Equal(t, 1.25, createCacheRatio)
	customCreateCacheRatio, ok := GetCreateCacheRatio("custom-model")
	require.True(t, ok)
	require.Equal(t, 1.5, customCreateCacheRatio)

	require.NoError(t, UpdateModelRatioByJSONString(`{"claude-sonnet-4-6":1.8}`))
	customClaudeRatio, ok, _ := GetModelRatio("claude-sonnet-4-6")
	require.True(t, ok)
	require.Equal(t, 1.8, customClaudeRatio)
}

func TestOpenAICompletionRatiosMatchDefaultPricing(t *testing.T) {
	resetRatioMapsForTest(t)

	require.Equal(t, 4.0, GetCompletionRatio("gpt-4.1"))
	require.Equal(t, 4.0, GetCompletionRatio("gpt-4.1-mini"))
	require.Equal(t, 4.0, GetCompletionRatio("gpt-4.1-nano"))
	require.Equal(t, 4.0, GetCompletionRatio("o4-mini"))
	require.Equal(t, 4.0, GetCompletionRatio("o4-mini-deep-research"))
	require.Equal(t, 8.0, GetCompletionRatio("gpt-5"))
	require.Equal(t, 8.0, GetCompletionRatio("gpt-5.2"))
	require.Equal(t, 6.0, GetCompletionRatio("gpt-5.4-mini"))
	require.Equal(t, 5.0, GetCompletionRatio("gpt-5.6-sol"))
	require.Equal(t, 6.0, GetCompletionRatio("gpt-5.6-terra"))
	require.Equal(t, 6.0, GetCompletionRatio("gpt-5.6-luna"))
}

func TestCodexModelRatiosMatchDefaultPricing(t *testing.T) {
	resetRatioMapsForTest(t)

	cases := map[string]float64{
		"gpt-5.2":       0.875,
		"gpt-5.3-codex": 0.875,
		"gpt-5.4-mini":  0.375,
		"gpt-5.4":       1.25,
		"gpt-5.4-pro":   15,
		"gpt-5.5":       2.5,
		"gpt-5.6-sol":   2.0,
		"gpt-5.6-terra": 1.0,
		"gpt-5.6-luna":  0.1,
	}
	for model, expected := range cases {
		modelRatio, ok, _ := GetModelRatio(model)
		require.True(t, ok, model)
		require.Equal(t, expected, modelRatio, model)

		cacheRatio, ok := GetCacheRatio(model)
		require.True(t, ok, model)
		require.Equal(t, 0.1, cacheRatio, model)
	}

	for _, model := range []string{"gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"} {
		createCacheRatio, ok := GetCreateCacheRatio(model)
		require.True(t, ok, model)
		require.Equal(t, 1.25, createCacheRatio, model)
	}
}

func TestImageAndVideoModelPricesMatchDefaultPricing(t *testing.T) {
	resetRatioMapsForTest(t)

	cases := map[string]float64{
		"gpt-image-2":                    0.211,
		"gemini-3-pro-image":             0.134,
		"gemini-3.1-flash-image":         0.067,
		"gemini-3.1-flash-lite-image":    0.0336,
		"veo-3.0-generate-001":           0.4,
		"veo-3.0-fast-generate-001":      0.1,
		"veo-3.1-generate-001":           0.4,
		"veo-3.1-generate-preview":       0.4,
		"veo-3.1-fast-generate-001":      0.1,
		"veo-3.1-fast-generate-preview":  0.1,
		"gemini-omni-flash-preview":      0.1,
		"gemini-3.1-flash-image-preview": 0.067,
		"gemini-3-pro-image-preview":     0.134,
	}
	for model, expected := range cases {
		price, ok := GetModelPrice(model, false)
		require.True(t, ok, model)
		require.Equal(t, expected, price, model)
	}
}

func TestUnknownModelHasNoImplicitPremiumFallback(t *testing.T) {
	resetRatioMapsForTest(t)

	modelRatio, ok, matchName := GetModelRatio("definitely-unpriced-model")
	require.False(t, ok)
	require.Equal(t, "definitely-unpriced-model", matchName)
	require.Zero(t, modelRatio)

	priceOrRatio, usePrice, success := GetModelRatioOrPrice("definitely-unpriced-model")
	require.False(t, success)
	require.False(t, usePrice)
	require.Zero(t, priceOrRatio)
}

func TestGPT56CompletionRatioHonorsPriceConfiguration(t *testing.T) {
	resetRatioMapsForTest(t)
	require.NoError(t, UpdateCompletionRatioByJSONString(`{"gpt-5.6-sol":5,"gpt-5.6-terra":6,"gpt-5.6-luna":6}`))
	require.Equal(t, CompletionRatioInfo{Ratio: 5, Locked: false}, GetCompletionRatioInfo("gpt-5.6-sol"))
	require.Equal(t, 5.0, GetCompletionRatio("gpt-5.6-sol"))
	require.NoError(t, UpdateCompletionRatioByJSONString(`{"gpt-5.6-sol":4.5}`))
	require.Equal(t, 4.5, GetCompletionRatio("gpt-5.6-sol"))
	require.Equal(t, CompletionRatioInfo{Ratio: 4.5, Locked: false}, GetCompletionRatioInfo("gpt-5.6-sol"))
	require.Equal(t, 6.0, GetCompletionRatio("gpt-5.5"))
}
