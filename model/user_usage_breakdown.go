package model

import (
	"sort"

	"github.com/QuantumNous/new-api/constant"
	"github.com/shopspring/decimal"
)

// Each row contributes once to the total and once to each independent dimension.
// Model names are historical log values, including empty names on older refunds.
type usageBreakdown struct {
	total      usageTotals
	byChannel  map[int]*usageTotals
	byModel    map[string]*usageTotals
	byProvider map[string]*usageTotals
}

func newUsageBreakdown() *usageBreakdown {
	return &usageBreakdown{byChannel: map[int]*usageTotals{}, byModel: map[string]*usageTotals{}, byProvider: map[string]*usageTotals{}}
}
func (b *usageBreakdown) add(row usageAggregate) error {
	if b.byChannel[row.ChannelID] == nil {
		b.byChannel[row.ChannelID] = &usageTotals{}
	}
	if b.byModel[row.ModelName] == nil {
		b.byModel[row.ModelName] = &usageTotals{}
	}
	if row.Provider == "" {
		row.Provider = "other"
	}
	if b.byProvider[row.Provider] == nil {
		b.byProvider[row.Provider] = &usageTotals{}
	}
	for _, total := range []*usageTotals{&b.total, b.byChannel[row.ChannelID], b.byModel[row.ModelName], b.byProvider[row.Provider]} {
		if err := total.add(row); err != nil {
			return err
		}
	}
	return nil
}
func (s usageTotals) breakdownAmounts(unit decimal.Decimal, denominator int64) UsageBreakdownAmounts {
	share := ""
	if denominator > 0 {
		share = decimal.NewFromInt(s.consume).Mul(decimal.NewFromInt(100)).DivRound(decimal.NewFromInt(denominator), 2).StringFixed(2)
	}
	return UsageBreakdownAmounts{UsageAmounts: s.amounts(unit), ChargeSharePercent: share}
}
func (b *usageBreakdown) channels(unit decimal.Decimal, names map[int]string) []UserUsageChannel {
	out := make([]UserUsageChannel, 0, len(b.byChannel))
	ids := make([]int, 0, len(b.byChannel))
	for id := range b.byChannel {
		ids = append(ids, id)
	}
	sort.Ints(ids)
	for _, id := range ids {
		out = append(out, UserUsageChannel{ChannelID: id, ChannelName: names[id], UsageBreakdownAmounts: b.byChannel[id].breakdownAmounts(unit, b.total.consume)})
	}
	return out
}
func (b *usageBreakdown) models(unit decimal.Decimal) []UserUsageModel {
	out := make([]UserUsageModel, 0, len(b.byModel))
	names := make([]string, 0, len(b.byModel))
	for name := range b.byModel {
		names = append(names, name)
	}
	sort.Slice(names, func(i, j int) bool {
		a, c := b.byModel[names[i]].consume, b.byModel[names[j]].consume
		if a == c {
			return names[i] < names[j]
		}
		return a > c
	})
	for _, name := range names {
		out = append(out, UserUsageModel{ModelName: name, UsageBreakdownAmounts: b.byModel[name].breakdownAmounts(unit, b.total.consume)})
	}
	return out
}

// Source groups describe current channel configuration, not model families or cloud invoices.
// Deleted/unrecognised channels remain in Other, so no billed usage disappears.
func usageProvider(channelType int) string {
	switch channelType {
	case constant.ChannelTypeAzure:
		return "azure"
	case constant.ChannelTypeGemini, constant.ChannelTypeVertexAi, constant.ChannelTypePaLM:
		return "google"
	case constant.ChannelTypeAws:
		return "aws"
	case constant.ChannelTypeAnthropic:
		return "anthropic"
	case constant.ChannelTypeOpenAI, constant.ChannelTypeOpenAIMax:
		return "openai"
	default:
		return "other"
	}
}
func (b *usageBreakdown) providers(unit decimal.Decimal) []UserUsageProvider {
	out := make([]UserUsageProvider, 0, len(b.byProvider))
	for _, provider := range []string{"azure", "google", "aws", "anthropic", "openai", "other"} {
		if total := b.byProvider[provider]; total != nil {
			out = append(out, UserUsageProvider{Provider: provider, UsageBreakdownAmounts: total.breakdownAmounts(unit, b.total.consume)})
		}
	}
	return out
}
