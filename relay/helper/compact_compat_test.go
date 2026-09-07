package helper

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/config"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestCompactMappingKeepsExplicitBillingIdentity(t *testing.T) {
	for _, modelName := range []string{"gpt-6-astra", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"} {
		t.Run(modelName, func(t *testing.T) {
			ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
			alias := ratio_setting.WithCompactModelSuffix(modelName)
			info := &relaycommon.RelayInfo{RelayMode: relayconstant.RelayModeResponsesCompact, OriginModelName: alias}
			request := &dto.OpenAIResponsesRequest{Model: modelName}
			require.NoError(t, ModelMappedHelper(ctx, info, request))
			require.Equal(t, modelName, request.Model)
			require.Equal(t, modelName, info.UpstreamModelName)
			require.Equal(t, alias, info.OriginModelName)
		})
	}
}

// Compact pricing is explicitly configured, not implicitly inherited. The
// proposed configuration must keep the base model's existing billing untouched.
func TestCompactExplicitPricingPreservesBaseAndCustomerDiscounts(t *testing.T) {
	saved := map[string]string{}
	require.NoError(t, config.GlobalConfig.SaveToDB(func(k, v string) error { saved[k] = v; return nil }))
	oldGroups := ratio_setting.GroupRatio2JSONString()
	oldDiscounts := ratio_setting.GroupModelRatio2JSONString()
	t.Cleanup(func() {
		require.NoError(t, config.GlobalConfig.LoadFromDB(saved))
		require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(oldGroups))
		require.NoError(t, ratio_setting.UpdateGroupModelRatioByJSONString(oldDiscounts))
	})

	const base = "gpt-6-astra"
	alias := ratio_setting.WithCompactModelSuffix(base)
	const expression = `len <= 272000 ? tier("standard", p * 10 + cr * 1 + cc * 12.5 + c * 50) : tier("long_context", p * 20 + cr * 2 + cc * 25 + c * 75)`
	modes := map[string]string{base: "tiered_expr"}
	expressions := map[string]string{base: expression}
	loadBilling := func() {
		m, err := common.Marshal(modes)
		require.NoError(t, err)
		e, err := common.Marshal(expressions)
		require.NoError(t, err)
		require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{"billing_setting.billing_mode": string(m), "billing_setting.billing_expr": string(e)}))
	}
	loadBilling()
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/responses/compact", nil)
	_, err := ModelPriceHelper(ctx, &relaycommon.RelayInfo{OriginModelName: alias, UserGroup: "default", UsingGroup: "default"}, 1000, &types.TokenCountMeta{})
	require.Error(t, err, "base model pricing must not silently enable unpriced compact")

	modes[alias], expressions[alias] = modes[base], expressions[base]
	loadBilling()
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"default":1,"btob":1,"b2b_test":1}`))
	require.NoError(t, ratio_setting.UpdateGroupModelRatioByJSONString(`{"default":{"gpt-6-astra":0.7,"gpt-6-astra-openai-compact":0.7},"btob":{"gpt-6-astra":0.6,"gpt-6-astra-openai-compact":0.6},"b2b_test":{"gpt-6-astra":0.43,"gpt-6-astra-openai-compact":0.43}}`))

	for group, discount := range map[string]float64{"default": 0.7, "btob": 0.6, "b2b_test": 0.43} {
		for _, count := range []int{1000, 272000, 272001} {
			var previousQuota int
			for i, name := range []string{base, alias} {
				info := &relaycommon.RelayInfo{OriginModelName: name, UserGroup: group, UsingGroup: group}
				price, err := ModelPriceHelper(ctx, info, count, &types.TokenCountMeta{})
				require.NoError(t, err)
				require.Equal(t, discount, price.GroupRatioInfo.GroupRatio)
				require.NotNil(t, info.TieredBillingSnapshot)
				usage := &dto.Usage{PromptTokens: count, CompletionTokens: 10, PromptTokensDetails: dto.InputTokenDetails{CachedTokens: 200, CachedCreationTokens: 100}}
				params := service.BuildTieredTokenParams(usage, false, map[string]bool{"p": true, "c": true, "cr": true, "cc": true})
				ok, quota, result := service.TryTieredSettle(info, params)
				require.True(t, ok)
				inputPrice, readPrice, writePrice, outputPrice := 10.0, 1.0, 12.5, 50.0
				wantTier := "standard"
				if count > 272000 {
					inputPrice, readPrice, writePrice, outputPrice, wantTier = 20, 2, 25, 75, "long_context"
				}
				expected := (float64(count-300)*inputPrice + 200*readPrice + 100*writePrice + 10*outputPrice) / 1_000_000 * common.QuotaPerUnit * discount
				require.Equal(t, billingexpr.QuotaRound(expected), quota)
				require.Equal(t, wantTier, result.MatchedTier)
				if i > 0 {
					require.Equal(t, previousQuota, quota, "explicit compact configuration must match the chosen base policy")
				}
				previousQuota = quota
			}
		}
	}
}
