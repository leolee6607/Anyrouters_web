package model

import (
	"testing"

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
