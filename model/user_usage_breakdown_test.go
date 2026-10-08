package model

import (
	"testing"

	"github.com/QuantumNous/new-api/constant"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/require"
)

func TestUserUsageBreakdownConservesEachDimensionAndRefundShares(t *testing.T) {
	b := newUsageBreakdown()
	for _, r := range []usageAggregate{
		{ChannelID: 2, ModelName: "one", Type: LogTypeConsume, Quota: 300, Count: 1},
		{ChannelID: 3, ModelName: "one", Type: LogTypeConsume, Quota: 100, Count: 1},
		{ChannelID: 3, ModelName: "two", Type: LogTypeConsume, Quota: 100, Count: 1},
		{ChannelID: 2, ModelName: "one", Type: LogTypeRefund, Quota: 600, Count: 1},
		{ChannelID: 999, ModelName: "", Type: LogTypeRefund, Quota: 50, Count: 1},
	} {
		require.NoError(t, b.add(r))
	}
	models := b.models(decimal.NewFromInt(500000))
	require.Equal(t, "80.00", models[0].ChargeSharePercent)
	require.Equal(t, "-0.0004", models[0].NetUSD)
	require.Equal(t, "20.00", models[1].ChargeSharePercent)
	require.Equal(t, "0.00", models[2].ChargeSharePercent)
	require.Empty(t, models[2].ModelName)
	require.Equal(t, "-0.0003", b.total.amounts(decimal.NewFromInt(500000)).NetUSD)
	for _, dimension := range [][]UsageBreakdownAmounts{
		{models[0].UsageBreakdownAmounts, models[1].UsageBreakdownAmounts, models[2].UsageBreakdownAmounts},
		{b.channels(decimal.NewFromInt(500000), nil)[0].UsageBreakdownAmounts, b.channels(decimal.NewFromInt(500000), nil)[1].UsageBreakdownAmounts, b.channels(decimal.NewFromInt(500000), nil)[2].UsageBreakdownAmounts},
	} {
		consume, refund, net := decimal.Zero, decimal.Zero, decimal.Zero
		for _, row := range dimension {
			consume = consume.Add(decimal.RequireFromString(row.ConsumeUSD))
			refund = refund.Add(decimal.RequireFromString(row.RefundUSD))
			net = net.Add(decimal.RequireFromString(row.NetUSD))
		}
		require.Equal(t, "0.001", consume.String())
		require.Equal(t, "0.0013", refund.String())
		require.Equal(t, "-0.0003", net.String())
	}
	require.Equal(t, "33.33", (usageTotals{consume: 1}).breakdownAmounts(decimal.NewFromInt(1), 3).ChargeSharePercent)
	require.Equal(t, "", (usageTotals{refund: 1}).breakdownAmounts(decimal.NewFromInt(1), 0).ChargeSharePercent)
}

func TestUserUsageProviderSummaryMergesChannelsAndConservesUnknownRefunds(t *testing.T) {
	b := newUsageBreakdown()
	types := map[int]int{3: constant.ChannelTypeAzure, 4: constant.ChannelTypeAzure, 2: constant.ChannelTypeVertexAi}
	for _, row := range []usageAggregate{
		{ChannelID: 3, ModelName: "first", Type: LogTypeConsume, Quota: 300, Count: 1},
		{ChannelID: 4, ModelName: "second", Type: LogTypeConsume, Quota: 200, Count: 1},
		{ChannelID: 2, ModelName: "third", Type: LogTypeConsume, Quota: 500, Count: 1},
		{ChannelID: 999, Type: LogTypeRefund, Quota: 50, Count: 1},
	} {
		row.Provider = usageProvider(types[row.ChannelID])
		require.NoError(t, b.add(row))
	}
	groups := b.providers(decimal.NewFromInt(500000))
	require.Len(t, groups, 3)
	require.Equal(t, "azure", groups[0].Provider)
	require.Equal(t, "0.001", groups[0].ConsumeUSD)
	require.Equal(t, "50.00", groups[0].ChargeSharePercent)
	require.EqualValues(t, 2, groups[0].ConsumeRecords)
	require.Equal(t, "google", groups[1].Provider)
	require.Equal(t, "0.001", groups[1].ConsumeUSD)
	require.Equal(t, "50.00", groups[1].ChargeSharePercent)
	require.Equal(t, "other", groups[2].Provider)
	require.Equal(t, "0.0001", groups[2].RefundUSD)
	consume, refund, net := decimal.Zero, decimal.Zero, decimal.Zero
	for _, g := range groups {
		consume = consume.Add(decimal.RequireFromString(g.ConsumeUSD))
		refund = refund.Add(decimal.RequireFromString(g.RefundUSD))
		net = net.Add(decimal.RequireFromString(g.NetUSD))
	}
	total := b.total.amounts(decimal.NewFromInt(500000))
	require.Equal(t, total.ConsumeUSD, consume.String())
	require.Equal(t, total.RefundUSD, refund.String())
	require.Equal(t, total.NetUSD, net.String())
	require.Equal(t, "google", usageProvider(constant.ChannelTypeGemini))
	require.Equal(t, "aws", usageProvider(constant.ChannelTypeAws))
	require.Equal(t, "anthropic", usageProvider(constant.ChannelTypeAnthropic))
	require.Equal(t, "openai", usageProvider(constant.ChannelTypeOpenAI))
	require.Equal(t, "other", usageProvider(9999))
}
