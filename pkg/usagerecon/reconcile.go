package usagerecon

import (
	"encoding/csv"
	"fmt"
	"io"
	"sort"
	"strconv"
	"strings"
	"time"
)

// SiteDaily is the site side of the reconciliation, read back from the
// canonical CSV and re-keyed on the configured join key.
type SiteDaily struct {
	Date string
	Key  string

	InputTokens     float64
	OutputTokens    float64
	CacheReadTokens float64
	Requests        float64
	AmountUSD       float64

	ErrorLogged        float64
	RetryAttempts      float64
	ClientDisconnected float64
	RowsLocalEstimated float64
	RowsCacheWriteEst  float64
	RowsZeroUsage      float64

	MappingMissing bool // join key column was empty (channel not in channel_map)
}

// DiffRow is one (date, key, measure) comparison line.
type DiffRow struct {
	Date    string
	Key     string
	Measure string // input_tokens | output_tokens | cache_read_tokens | requests | amount_usd
	Site    string // numeric, or "未提供"
	Azure   string // numeric, or "未提供"
	AbsDiff string
	PctDiff string // (site-azure)/azure, "N/A" when denominator is 0 or a side is missing
	Labels  string
}

// ReconcileResult carries everything the report writer needs.
type ReconcileResult struct {
	Rows          []DiffRow
	Skipped       []string
	SiteTotal     map[string]float64
	AzureTotal    map[string]float64
	OverThreshold int
	Threshold     float64
}

// LoadSiteCSV reads the canonical daily usage CSV produced by the export
// subcommand, aggregating by (date, siteKey).
func LoadSiteCSV(r io.Reader, siteKey string) (map[string]*SiteDaily, error) {
	cr := csv.NewReader(r)
	header, err := cr.Read()
	if err != nil {
		return nil, fmt.Errorf("read site header: %w", err)
	}
	col := make(map[string]int, len(header))
	for i, name := range header {
		col[name] = i
	}
	for _, required := range []string{"date", siteKey, "requests_success", "tokens_input", "tokens_output", "tokens_cache_read", "amount_usd"} {
		if _, ok := col[required]; !ok {
			return nil, fmt.Errorf("site CSV missing column %q (is this the canonical export format?)", required)
		}
	}
	num := func(record []string, name string) float64 {
		v, _ := strconv.ParseFloat(record[col[name]], 64)
		return v
	}
	out := make(map[string]*SiteDaily)
	for {
		record, err := cr.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		date := record[col["date"]]
		key := record[col[siteKey]]
		id := date + "\x00" + key
		bucket, ok := out[id]
		if !ok {
			bucket = &SiteDaily{Date: date, Key: key, MappingMissing: key == ""}
			out[id] = bucket
		}
		// Azure Monitor InputTokens is the complete prompt token count, including
		// cached input. New exports carry tokens_prompt_total explicitly. For a
		// v1.0 export, reconstruct it from the mutually-exclusive input buckets.
		if _, ok := col["tokens_prompt_total"]; ok {
			bucket.InputTokens += num(record, "tokens_prompt_total")
		} else {
			bucket.InputTokens += num(record, "tokens_input") + num(record, "tokens_cache_read")
			if _, ok := col["tokens_cache_write"]; ok {
				bucket.InputTokens += num(record, "tokens_cache_write")
			}
		}
		bucket.OutputTokens += num(record, "tokens_output")
		bucket.CacheReadTokens += num(record, "tokens_cache_read")
		bucket.Requests += num(record, "requests_success")
		bucket.AmountUSD += num(record, "amount_usd")
		bucket.ErrorLogged += num(record, "requests_error_logged")
		bucket.RetryAttempts += num(record, "retry_attempts")
		bucket.ClientDisconnected += num(record, "client_disconnected")
		bucket.RowsLocalEstimated += num(record, "rows_local_estimated")
		bucket.RowsCacheWriteEst += num(record, "rows_cache_write_estimated")
		bucket.RowsZeroUsage += num(record, "rows_zero_usage")
	}
	return out, nil
}

// Reconcile joins both sides and emits one DiffRow per (date, key, measure).
// now is injected for the late-arrival label so tests stay deterministic.
func Reconcile(site map[string]*SiteDaily, azure map[string]*AzureDaily, skipped []string, threshold float64, now time.Time) *ReconcileResult {
	if threshold <= 0 {
		threshold = 0.03
	}
	result := &ReconcileResult{
		Skipped:    skipped,
		SiteTotal:  make(map[string]float64),
		AzureTotal: make(map[string]float64),
		Threshold:  threshold,
	}

	ids := make(map[string]struct{}, len(site)+len(azure))
	for id := range site {
		ids[id] = struct{}{}
	}
	for id := range azure {
		ids[id] = struct{}{}
	}
	sorted := make([]string, 0, len(ids))
	for id := range ids {
		sorted = append(sorted, id)
	}
	sort.Strings(sorted)

	for _, id := range sorted {
		s := site[id]
		a := azure[id]
		date, key := splitId(id)

		baseLabels := rowLabels(s, a, date, now)

		type measure struct {
			name       string
			siteVal    float64
			siteHas    bool
			azureVal   float64
			azureHas   bool
			extraLabel string
		}
		measures := []measure{}
		if a != nil || s != nil {
			measures = append(measures,
				measure{"input_tokens", fval(s, func(x *SiteDaily) float64 { return x.InputTokens }), s != nil, aval(a, func(x *AzureDaily) float64 { return x.InputTokens }), a != nil && a.HasInput, ""},
				measure{"output_tokens", fval(s, func(x *SiteDaily) float64 { return x.OutputTokens }), s != nil, aval(a, func(x *AzureDaily) float64 { return x.OutputTokens }), a != nil && a.HasOutput, ""},
				measure{"cache_read_tokens", fval(s, func(x *SiteDaily) float64 { return x.CacheReadTokens }), s != nil, aval(a, func(x *AzureDaily) float64 { return x.CacheReadTokens }), a != nil && a.HasCacheRead, "cache_usage_estimated"},
				measure{"requests", fval(s, func(x *SiteDaily) float64 { return x.Requests }), s != nil, aval(a, func(x *AzureDaily) float64 { return x.Requests }), a != nil && a.HasRequests, ""},
				measure{"amount_usd", fval(s, func(x *SiteDaily) float64 { return x.AmountUSD }), s != nil, aval(a, func(x *AzureDaily) float64 { return x.Cost }), a != nil && a.HasCost, ""},
			)
		}

		for _, m := range measures {
			// A measure the file never provided is "未提供", not zero.
			if !m.siteHas && !m.azureHas {
				continue
			}
			labels := append([]string{}, baseLabels...)
			if m.extraLabel != "" && s != nil && s.RowsCacheWriteEst > 0 {
				labels = append(labels, m.extraLabel)
			}
			row := DiffRow{Date: date, Key: key, Measure: m.name}
			if m.siteHas {
				row.Site = fnum(m.siteVal)
				result.SiteTotal[m.name] += m.siteVal
			} else {
				row.Site = "未提供"
			}
			if m.azureHas {
				row.Azure = fnum(m.azureVal)
				result.AzureTotal[m.name] += m.azureVal
			} else {
				row.Azure = "未提供"
			}
			if m.siteHas && m.azureHas {
				diff := m.siteVal - m.azureVal
				row.AbsDiff = fnum(diff)
				if m.azureVal == 0 {
					row.PctDiff = "N/A"
				} else {
					pct := diff / m.azureVal
					row.PctDiff = fmt.Sprintf("%.4f", pct)
					if pct > threshold || pct < -threshold {
						result.OverThreshold++
						labels = append(labels, "over_threshold")
					}
				}
			} else {
				row.AbsDiff = "N/A"
				row.PctDiff = "N/A"
			}
			row.Labels = strings.Join(labels, ";")
			result.Rows = append(result.Rows, row)
		}
	}
	return result
}

func rowLabels(s *SiteDaily, a *AzureDaily, date string, now time.Time) []string {
	var labels []string
	if s == nil {
		labels = append(labels, "site_missing")
	} else {
		if s.MappingMissing {
			labels = append(labels, "mapping_missing")
		}
		if s.RowsLocalEstimated > 0 || s.RowsZeroUsage > 0 {
			labels = append(labels, "local_estimate_used")
		}
		if s.RowsZeroUsage > 0 {
			labels = append(labels, "upstream_usage_missing")
		}
		if s.ClientDisconnected > 0 {
			labels = append(labels, "client_disconnected")
		}
		if s.RetryAttempts > 0 {
			labels = append(labels, "retried_on_another_channel")
		}
		if s.ErrorLogged > 0 {
			labels = append(labels, "upstream_may_have_billed")
		}
	}
	if a == nil {
		labels = append(labels, "azure_missing")
	} else {
		if a.DuplicateRowsMerged > 0 {
			labels = append(labels, "duplicate_rows_merged")
		}
		if a.AdjustmentCost != 0 {
			labels = append(labels, "adjustment_rows_excluded")
		}
	}
	if t, err := time.Parse("2006-01-02", date); err == nil {
		if now.Sub(t) < 48*time.Hour {
			labels = append(labels, "timezone_or_late_arrival")
		}
	}
	if len(labels) == 0 {
		labels = append(labels, "unknown_if_diff")
	}
	return labels
}

// WriteDiffCSV writes the per-line report.
func WriteDiffCSV(w io.Writer, result *ReconcileResult) error {
	cw := csv.NewWriter(w)
	if err := cw.Write([]string{"date", "key", "measure", "site", "azure", "abs_diff", "pct_diff", "labels"}); err != nil {
		return err
	}
	for _, r := range result.Rows {
		if err := cw.Write([]string{r.Date, r.Key, r.Measure, r.Site, r.Azure, r.AbsDiff, r.PctDiff, r.Labels}); err != nil {
			return err
		}
	}
	cw.Flush()
	return cw.Error()
}

// WriteSummaryMarkdown writes the human-readable roll-up.
func WriteSummaryMarkdown(w io.Writer, result *ReconcileResult) error {
	var b strings.Builder
	b.WriteString("# 对账汇总\n\n")
	b.WriteString("| 指标 | 站内合计 | Azure 合计 | 差异率 (站内-Azure)/Azure |\n|---|---|---|---|\n")
	for _, m := range []string{"input_tokens", "output_tokens", "cache_read_tokens", "requests", "amount_usd"} {
		s, sOk := result.SiteTotal[m]
		a, aOk := result.AzureTotal[m]
		if !sOk && !aOk {
			continue
		}
		pct := "N/A"
		if aOk && a != 0 && sOk {
			pct = fmt.Sprintf("%.4f", (s-a)/a)
		}
		b.WriteString(fmt.Sprintf("| %s | %s | %s | %s |\n", m, fnum(s), fnum(a), pct))
	}
	b.WriteString(fmt.Sprintf("\n- 超过阈值(±%.1f%%)的明细条目：%d\n", result.Threshold*100, result.OverThreshold))
	if len(result.Skipped) > 0 {
		b.WriteString(fmt.Sprintf("- 被跳过的 Azure 行（需人工核对）：%d\n\n", len(result.Skipped)))
		for _, s := range result.Skipped {
			b.WriteString("  - " + s + "\n")
		}
	}
	b.WriteString("\n说明：差异率分母为 0 时输出 N/A；一侧未提供数据输出「未提供」而非 0；Refund/RoundingAdjustment 行单独累计，不计入差异率（对应运营方核算规则）。\n")
	_, err := io.WriteString(w, b.String())
	return err
}

func splitId(id string) (string, string) {
	parts := strings.SplitN(id, "\x00", 2)
	if len(parts) == 2 {
		return parts[0], parts[1]
	}
	return id, ""
}

func fval(s *SiteDaily, f func(*SiteDaily) float64) float64 {
	if s == nil {
		return 0
	}
	return f(s)
}

func aval(a *AzureDaily, f func(*AzureDaily) float64) float64 {
	if a == nil {
		return 0
	}
	return f(a)
}

func fnum(v float64) string {
	if v == float64(int64(v)) {
		return strconv.FormatInt(int64(v), 10)
	}
	return strconv.FormatFloat(v, 'f', 6, 64)
}
