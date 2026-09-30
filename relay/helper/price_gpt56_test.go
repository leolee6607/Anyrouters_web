package helper

import (
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/setting/config"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestGPT56PriceDataUsesPerGroupDiscount(t *testing.T) {
	ratio_setting.InitRatioSettings()

	oldGroupRatio := ratio_setting.GroupRatio2JSONString()
	oldGroupModelRatio := ratio_setting.GroupModelRatio2JSONString()
	t.Cleanup(func() {
		require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(oldGroupRatio))
		require.NoError(t, ratio_setting.UpdateGroupModelRatioByJSONString(oldGroupModelRatio))
	})

	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(
		`{"default":1,"btob":1,"b2b_16":1}`,
	))
	require.NoError(t, ratio_setting.UpdateGroupModelRatioByJSONString(
		`{
			"default":{"gpt-5.6-sol":0.7,"gpt-5.6-terra":0.7,"gpt-5.6-luna":0.7},
			"btob":{"gpt-5.6-sol":0.6,"gpt-5.6-terra":0.6,"gpt-5.6-luna":0.6},
			"b2b_16":{"gpt-5.6-sol":0.61,"gpt-5.6-terra":0.62,"gpt-5.6-luna":0.63}
		}`,
	))

	modelRatios := map[string]float64{
		"gpt-5.6-sol":   2.0,
		"gpt-5.6-terra": 1.0,
		"gpt-5.6-luna":  0.1,
	}
	groupDiscounts := map[string]map[string]float64{
		"default": {"gpt-5.6-sol": 0.7, "gpt-5.6-terra": 0.7, "gpt-5.6-luna": 0.7},
		"btob":    {"gpt-5.6-sol": 0.6, "gpt-5.6-terra": 0.6, "gpt-5.6-luna": 0.6},
		"b2b_16":  {"gpt-5.6-sol": 0.61, "gpt-5.6-terra": 0.62, "gpt-5.6-luna": 0.63},
	}

	gin.SetMode(gin.TestMode)
	for group, discounts := range groupDiscounts {
		for modelName, discount := range discounts {
			t.Run(group+"/"+modelName, func(t *testing.T) {
				ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
				info := &common.RelayInfo{
					UserGroup:       group,
					UsingGroup:      group,
					OriginModelName: modelName,
				}

				priceData, err := ModelPriceHelper(ctx, info, 2000, &types.TokenCountMeta{})
				require.NoError(t, err)
				require.Equal(t, modelRatios[modelName], priceData.ModelRatio)
				expectedOutputRatio := 6.0
				if modelName == "gpt-5.6-sol" {
					expectedOutputRatio = 5.0
				}
				require.Equal(t, expectedOutputRatio, priceData.CompletionRatio)
				require.Equal(t, 0.1, priceData.CacheRatio)
				require.Equal(t, 1.25, priceData.CacheCreationRatio)
				require.Equal(t, discount, priceData.GroupRatioInfo.GroupRatio)
				// The legacy reservation path truncates floats; settlement is verified separately.
				require.InDelta(t, 2000*modelRatios[modelName]*discount, priceData.QuotaToPreConsume, 1)
			})
		}
	}
}

func TestAzureGPT56PreConsumeReservesCacheWritePremium(t *testing.T) {
	ratio_setting.InitRatioSettings()

	oldGroupRatio := ratio_setting.GroupRatio2JSONString()
	oldGroupModelRatio := ratio_setting.GroupModelRatio2JSONString()
	t.Cleanup(func() {
		require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(oldGroupRatio))
		require.NoError(t, ratio_setting.UpdateGroupModelRatioByJSONString(oldGroupModelRatio))
	})

	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"default":1}`))
	require.NoError(t, ratio_setting.UpdateGroupModelRatioByJSONString(
		`{"default":{"gpt-5.6-sol":0.7}}`,
	))

	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	info := &common.RelayInfo{
		ChannelMeta:     &common.ChannelMeta{ChannelType: constant.ChannelTypeAzure},
		UserGroup:       "default",
		UsingGroup:      "default",
		OriginModelName: "gpt-5.6-sol",
	}

	priceData, err := ModelPriceHelper(ctx, info, 2048, &types.TokenCountMeta{})
	require.NoError(t, err)

	// Combined input and cache-write premium reserve: 2048 * 2 * 0.7 * 1.25 = 3584 quota.
	require.Equal(t, 3584, priceData.QuotaToPreConsume)
}

func TestAzureGPT56TieredPreConsumeIncludesEstimatedCacheWrite(t *testing.T) {
	ratio_setting.InitRatioSettings()

	savedConfig := map[string]string{}
	require.NoError(t, config.GlobalConfig.SaveToDB(func(key, value string) error {
		savedConfig[key] = value
		return nil
	}))
	oldGroupRatio := ratio_setting.GroupRatio2JSONString()
	oldGroupModelRatio := ratio_setting.GroupModelRatio2JSONString()
	t.Cleanup(func() {
		require.NoError(t, config.GlobalConfig.LoadFromDB(savedConfig))
		require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(oldGroupRatio))
		require.NoError(t, ratio_setting.UpdateGroupModelRatioByJSONString(oldGroupModelRatio))
	})

	require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{
		"billing_setting.billing_mode": `{"gpt-5.6-sol":"tiered_expr"}`,
		"billing_setting.billing_expr": `{"gpt-5.6-sol":"len <= 272000 ? tier(\"standard\", p * 5 + cr * 0.5 + cc * 6.25 + c * 30) : tier(\"long_context\", p * 10 + cr * 1 + cc * 12.5 + c * 45)"}`,
	}))
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"default":1}`))
	require.NoError(t, ratio_setting.UpdateGroupModelRatioByJSONString(
		`{"default":{"gpt-5.6-sol":0.7}}`,
	))

	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	info := &common.RelayInfo{
		ChannelMeta:     &common.ChannelMeta{ChannelType: constant.ChannelTypeAzure},
		UserGroup:       "default",
		UsingGroup:      "default",
		OriginModelName: "gpt-5.6-sol",
	}

	priceData, err := ModelPriceHelper(ctx, info, 2048, &types.TokenCountMeta{})
	require.NoError(t, err)

	// The prompt is an eligible cache miss, so the tiered expression must
	// reserve it at the official $6.25/M cache-write rate. Group pricing then
	// applies the site's existing 70% multiplier.
	require.Equal(t, 4480, priceData.QuotaToPreConsume)
	require.NotNil(t, info.TieredBillingSnapshot)
	require.Equal(t, "standard", info.TieredBillingSnapshot.EstimatedTier)
}
