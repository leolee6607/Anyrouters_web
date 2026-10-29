package controller

import (
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestSettleTestQuotaUsesTieredBilling(t *testing.T) {
	info := &relaycommon.RelayInfo{
		TieredBillingSnapshot: &billingexpr.BillingSnapshot{
			BillingMode:   "tiered_expr",
			ExprString:    `param("stream") == true ? tier("stream", p * 3) : tier("base", p * 2)`,
			ExprHash:      billingexpr.ExprHashString(`param("stream") == true ? tier("stream", p * 3) : tier("base", p * 2)`),
			GroupRatio:    1,
			EstimatedTier: "stream",
			QuotaPerUnit:  common.QuotaPerUnit,
			ExprVersion:   1,
		},
		BillingRequestInput: &billingexpr.RequestInput{
			Body: []byte(`{"stream":true}`),
		},
	}

	quota, result := settleTestQuota(info, types.PriceData{
		ModelRatio:      1,
		CompletionRatio: 2,
	}, &dto.Usage{
		PromptTokens: 1000,
	})

	require.Equal(t, 1500, quota)
	require.NotNil(t, result)
	require.Equal(t, "stream", result.MatchedTier)
}

func TestBuildTestLogOtherInjectsTieredInfo(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())

	info := &relaycommon.RelayInfo{
		TieredBillingSnapshot: &billingexpr.BillingSnapshot{
			BillingMode: "tiered_expr",
			ExprString:  `tier("base", p * 2)`,
		},
		ChannelMeta: &relaycommon.ChannelMeta{},
	}
	priceData := types.PriceData{
		GroupRatioInfo: types.GroupRatioInfo{GroupRatio: 1},
	}
	usage := &dto.Usage{
		PromptTokensDetails: dto.InputTokenDetails{
			CachedTokens: 12,
		},
	}

	other := buildTestLogOther(ctx, info, priceData, usage, &billingexpr.TieredResult{
		MatchedTier: "base",
	})

	require.Equal(t, "tiered_expr", other["billing_mode"])
	require.Equal(t, "base", other["matched_tier"])
	require.NotEmpty(t, other["expr_b64"])
}

func TestResolveChannelTestUserIDUsesRequestUser(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Set("id", 2)

	userID, err := resolveChannelTestUserID(ctx)

	require.NoError(t, err)
	require.Equal(t, 2, userID)
}

func TestChannelTestUsesNativeGPT6ResponsesRoute(t *testing.T) {
	for _, name := range []string{"gpt-6-astra", "gpt-6-sol", "gpt-6-luna", "gpt-6.1-sol", "gpt-6.1-terra"} {
		for _, channelType := range []int{constant.ChannelTypeAzure, constant.ChannelTypeOpenAI} {
			for _, endpoint := range []string{"", "openai", "openai-response"} {
				channel := &model.Channel{Id: 3, Type: channelType}
				got := normalizeChannelTestEndpoint(channel, name, endpoint)
				require.Equal(t, "openai-response", got)
				request := buildTestRequest(name, got, channel, false)
				response, ok := request.(*dto.OpenAIResponsesRequest)
				require.True(t, ok)
				require.Equal(t, name, response.Model)
				require.NotEmpty(t, response.Input)
				payload, err := common.Marshal(request)
				require.NoError(t, err)
				require.NotContains(t, string(payload), `"max_tokens"`)
			}
		}
	}
	for _, tc := range []struct {
		channel              *model.Channel
		name, endpoint, want string
	}{
		{nil, "gpt-6.1-terra", "openai", "openai"},
		{&model.Channel{Type: constant.ChannelTypeOpenRouter}, "gpt-6.1-terra", "openai", "openai"},
		{&model.Channel{Type: constant.ChannelTypeAzure}, "gpt-4o", "openai", "openai"},
		{&model.Channel{Type: constant.ChannelTypeAzure}, "gpt-6.1-terra-alias", "", ""},
		{&model.Channel{Type: constant.ChannelTypeAzure}, "gpt-6.1-terra", "image-generation", "image-generation"},
	} {
		require.Equal(t, tc.want, normalizeChannelTestEndpoint(tc.channel, tc.name, tc.endpoint))
	}
}
