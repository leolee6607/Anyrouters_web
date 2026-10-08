package service

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	"github.com/stretchr/testify/require"
	"os"
	"testing"
)

func TestNanoBananaProductionPricing(t *testing.T) {
	raw, err := os.ReadFile("../infra/azure/nano-banana-20261008/prices.json")
	require.NoError(t, err)
	var prices struct {
		Expression string             `json:"expression"`
		Groups     map[string]float64 `json:"groups"`
	}
	require.NoError(t, common.Unmarshal(raw, &prices))
	for _, tc := range []struct {
		name           string
		imageTokens    int
		textTokens     int
		thinkingTokens int
		cachedTokens   int
		expectedCost   float64
	}{
		{"live_1K", 1120, 0, 0, 0, 0.03366},
		{"2K_with_text_and_thinking", 1680, 20, 100, 10, 0.0513465},
		{"4K", 3780, 0, 0, 0, 0.11346},
	} {
		t.Run(tc.name, func(t *testing.T) {
			usage := &dto.Usage{PromptTokens: 40, CompletionTokens: tc.imageTokens + tc.textTokens + tc.thinkingTokens}
			usage.PromptTokensDetails.CachedTokens = tc.cachedTokens
			usage.CompletionTokenDetails.ImageTokens = tc.imageTokens
			usage.CompletionTokenDetails.ReasoningTokens = tc.thinkingTokens
			p := BuildTieredTokenParams(usage, false, billingexpr.UsedVars(prices.Expression))
			require.Equal(t, float64(tc.textTokens+tc.thinkingTokens), p.C)
			for group, ratio := range prices.Groups {
				ok, quota, result := TryTieredSettle(makeRelayInfo(prices.Expression, ratio, 40, 32768), p)
				require.True(t, ok, group)
				require.NotNil(t, result, group)
				require.Equal(t, common.QuotaRound(tc.expectedCost*500000*ratio), quota, group)
			}
		})
	}
}
