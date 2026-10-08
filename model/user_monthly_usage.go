package model

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/shopspring/decimal"
)

// UsageMonthLocation is fixed for accounting, independently of the database/session timezone.
var UsageMonthLocation = time.FixedZone("Asia/Shanghai", 8*60*60)

// UsageAmounts contains historical debits, not repriced tokens or payment receipts.
// Decimal strings preserve precision in browsers and CSV exports.
type UsageAmounts struct {
	ConsumeUSD     string `json:"consume_usd"`
	RefundUSD      string `json:"refund_usd"`
	NetUSD         string `json:"net_usd"`
	ConsumeRecords int64  `json:"consume_records"`
	Refunds        int64  `json:"refunds"`
}
type UsageBreakdownAmounts struct {
	UsageAmounts
	ChargeSharePercent string `json:"charge_share_percent"`
}
type UserUsageProvider struct {
	Provider string `json:"provider"`
	UsageBreakdownAmounts
}
type UserUsageModel struct {
	ModelName string `json:"model_name"`
	UsageBreakdownAmounts
}
type UserUsageChannel struct {
	ChannelID   int    `json:"channel_id"`
	ChannelName string `json:"channel_name"`
	UsageBreakdownAmounts
}
type UserUsageMonth struct {
	Month      string              `json:"month"`
	InProgress bool                `json:"in_progress"`
	Channels   []UserUsageChannel  `json:"channels"`
	Models     []UserUsageModel    `json:"models"`
	Providers  []UserUsageProvider `json:"providers"`
	UsageAmounts
}
type UserMonthlyUsage struct {
	UserID      int                 `json:"user_id"`
	Username    string              `json:"username"`
	DisplayName string              `json:"display_name"`
	Year        int                 `json:"year"`
	Timezone    string              `json:"timezone"`
	Currency    string              `json:"currency"`
	AsOf        int64               `json:"as_of"`
	Months      []UserUsageMonth    `json:"months"`
	Total       UsageAmounts        `json:"total"`
	Channels    []UserUsageChannel  `json:"channels"`
	Models      []UserUsageModel    `json:"models"`
	Providers   []UserUsageProvider `json:"providers"`
}
type usageAggregate struct {
	Month     int
	ChannelID int
	ModelName string
	Provider  string `gorm:"-"`
	Type      int
	Quota     int64
	Count     int64
	Invalid   int64
}
type usageTotals struct{ consume, refund, consumeRecords, refunds int64 }

func (s *usageTotals) add(r usageAggregate) error {
	if r.Invalid != 0 || r.Quota < 0 || r.Count < 0 {
		return errors.New("invalid historical usage amount")
	}
	q, n := &s.consume, &s.consumeRecords
	if r.Type == LogTypeRefund {
		q, n = &s.refund, &s.refunds
	}
	if r.Quota > math.MaxInt64-*q || r.Count > math.MaxInt64-*n {
		return errors.New("usage total exceeds supported range")
	}
	*q += r.Quota
	*n += r.Count
	return nil
}
func (s usageTotals) amounts(unit decimal.Decimal) UsageAmounts {
	amount := func(q int64) string { return decimal.NewFromInt(q).Div(unit).String() }
	return UsageAmounts{ConsumeUSD: amount(s.consume), RefundUSD: amount(s.refund), NetUSD: amount(s.consume - s.refund), ConsumeRecords: s.consumeRecords, Refunds: s.refunds}
}

// GetUserMonthlyUsage makes one bounded aggregate query against LOG_DB. Channel
// labels come from DB separately, so installations with a separate log DB work.
func GetUserMonthlyUsage(ctx context.Context, userID, year int, asOf time.Time) (*UserMonthlyUsage, error) {
	now := asOf.In(UsageMonthLocation)
	if userID <= 0 || year < 2000 || year > now.Year() {
		return nil, errors.New("invalid user or usage year")
	}
	if common.QuotaPerUnit <= 0 || math.IsInf(common.QuotaPerUnit, 0) || math.IsNaN(common.QuotaPerUnit) {
		return nil, errors.New("invalid quota conversion")
	}
	var user struct {
		Id          int
		Username    string
		DisplayName string
		Type        int
	}
	if err := DB.WithContext(ctx).Model(&User{}).Select("id, username, display_name").Where("id = ?", userID).First(&user).Error; err != nil {
		return nil, err
	}
	months := 12
	if year == now.Year() {
		months = int(now.Month())
	}
	start := time.Date(year, 1, 1, 0, 0, 0, 0, UsageMonthLocation)
	end := start.AddDate(1, 0, 0)
	if asOf.Before(end) {
		end = asOf
	}
	var clauses []string
	var args []interface{}
	for m := 1; m <= months; m++ {
		upper := start.AddDate(0, m, 0).Unix()
		clauses = append(clauses, "WHEN created_at < ? THEN ?")
		args = append(args, upper, m)
	}
	selector := "CASE " + strings.Join(clauses, " ") + " END AS month, channel_id, COALESCE(model_name, '') AS model_name, type, SUM(quota) AS quota, COUNT(*) AS count, SUM(CASE WHEN quota < 0 THEN 1 ELSE 0 END) AS invalid"
	var rows []usageAggregate
	err := LOG_DB.WithContext(ctx).Model(&Log{}).Select(selector, args...).Where("user_id = ? AND created_at >= ? AND created_at < ? AND type IN ?", userID, start.Unix(), end.Unix(), []int{LogTypeConsume, LogTypeRefund}).Group("month, channel_id, model_name, type").Order("month, channel_id, model_name, type").Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	ids := make([]int, 0, len(rows))
	seen := map[int]bool{}
	for _, r := range rows {
		if !seen[r.ChannelID] {
			ids = append(ids, r.ChannelID)
			seen[r.ChannelID] = true
		}
	}
	var channels []struct {
		Id   int
		Name string
		Type int
	}
	if len(ids) > 0 {
		if err := DB.WithContext(ctx).Model(&Channel{}).Select("id, name, type").Where("id IN ?", ids).Find(&channels).Error; err != nil {
			return nil, err
		}
	}
	names := map[int]string{}
	providers := map[int]string{}
	for _, c := range channels {
		names[c.Id] = c.Name
		providers[c.Id] = usageProvider(c.Type)
	}
	unit := decimal.NewFromFloat(common.QuotaPerUnit)
	report := &UserMonthlyUsage{UserID: user.Id, Username: user.Username, DisplayName: user.DisplayName, Year: year, Timezone: "Asia/Shanghai", Currency: "USD", AsOf: asOf.Unix(), Months: make([]UserUsageMonth, 0, months)}
	annual := newUsageBreakdown()
	monthly := make([]*usageBreakdown, months)
	for i := range monthly {
		monthly[i] = newUsageBreakdown()
	}
	for _, row := range rows {
		row.Provider = providers[row.ChannelID]
		if row.Month < 1 || row.Month > months {
			return nil, errors.New("invalid usage month")
		}
		if err := annual.add(row); err != nil {
			return nil, err
		}
		if err := monthly[row.Month-1].add(row); err != nil {
			return nil, err
		}
	}
	for i, group := range monthly {
		report.Months = append(report.Months, UserUsageMonth{
			Month:        fmt.Sprintf("%04d-%02d", year, i+1),
			InProgress:   year == now.Year() && i+1 == int(now.Month()),
			UsageAmounts: group.total.amounts(unit),
			Channels:     group.channels(unit, names), Models: group.models(unit), Providers: group.providers(unit),
		})
	}
	report.Total = annual.total.amounts(unit)
	report.Channels = annual.channels(unit, names)
	report.Models = annual.models(unit)
	report.Providers = annual.providers(unit)
	return report, nil
}
