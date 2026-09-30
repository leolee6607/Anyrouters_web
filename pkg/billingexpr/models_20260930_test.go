package billingexpr

import (
	"fmt"
	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/require"
	"os"
	"testing"
)

// Check the release's rate manifest with the production expression evaluator,
// including the full-context boundary and cache token exclusion.
func TestSeptemberModelPrices(t *testing.T) {
	data, err := os.ReadFile("../../infra/azure/models-20260930/prices.json")
	require.NoError(t, err)
	var prices []struct {
		Model     string  `json:"model"`
		Input     float64 `json:"input"`
		Output    float64 `json:"output"`
		Read      float64 `json:"cache_read"`
		Write     float64 `json:"cache_write"`
		Threshold *int    `json:"threshold"`
	}
	require.NoError(t, common.Unmarshal(data, &prices))
	for _, price := range prices {
		if price.Threshold == nil {
			continue
		}
		expression := fmt.Sprintf(`len <= 272000 ? tier("standard", p * %g + cr * %g + cc * %g + c * %g) : tier("long_context", p * %g + cr * %g + cc * %g + c * %g)`, price.Input, price.Read, price.Write, price.Output, price.Input*2, price.Read*2, price.Write*2, price.Output*1.5)
		for _, length := range []float64{272000, 272001} {
			// P is normalized by the caller; Len includes separately priced caches.
			params := TokenParams{P: length - 15000, CR: 10000, CC: 5000, C: 1000, Len: length}
			expected := params.P*price.Input + params.CR*price.Read + params.CC*price.Write + params.C*price.Output
			tier := "standard"
			if length > 272000 {
				expected = (params.P*price.Input+params.CR*price.Read+params.CC*price.Write)*2 + params.C*price.Output*1.5
				tier = "long_context"
			}
			for _, discount := range []float64{.7, .6, .65, .4} {
				got, err := ComputeTieredQuota(&BillingSnapshot{ExprString: expression, ExprHash: ExprHashString(expression), GroupRatio: discount, QuotaPerUnit: 500000, ExprVersion: 1}, params)
				require.NoError(t, err, price.Model)
				require.Equal(t, tier, got.MatchedTier)
				require.Equal(t, common.QuotaRound(expected/2*discount), got.ActualQuotaAfterGroup, price.Model)
			}
		}
	}
}
