package billingexpr

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/require"
	"os"
	"testing"
)

func TestGPT61TerraReleasePricing(t *testing.T) {
	data, err := os.ReadFile("../../infra/azure/gpt61-terra-20261029/prices.json")
	require.NoError(t, err)
	var config struct {
		Expression string `json:"billing_expr"`
	}
	require.NoError(t, common.Unmarshal(data, &config))
	for _, tc := range []struct {
		name   string
		tokens TokenParams
		cost   float64
		tier   string
	}{
		{"uncached", TokenParams{P: 1000, C: 100, Len: 1000}, 1500, "standard"},
		{"cache", TokenParams{P: 700, CR: 200, CC: 100, C: 100, Len: 1000}, 1335, "standard"},
		{"boundary", TokenParams{P: 272000, C: 100, Len: 272000}, 272500, "standard"},
		{"long_with_cache", TokenParams{P: 271701, CR: 200, CC: 100, C: 100, Len: 272001}, 544422, "long_context"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cost, trace, err := RunExpr(config.Expression, tc.tokens)
			require.NoError(t, err)
			require.InDelta(t, tc.cost, cost, 0.000001)
			require.Equal(t, tc.tier, trace.MatchedTier)
		})
	}
}
