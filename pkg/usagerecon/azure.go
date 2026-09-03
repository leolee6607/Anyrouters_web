package usagerecon

import (
	"encoding/csv"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"
)

// AzureDaily is one (date, key) bucket read from the Azure export.
type AzureDaily struct {
	Date            string
	Key             string
	InputTokens     float64
	OutputTokens    float64
	CacheReadTokens float64
	Requests        float64
	Cost            float64

	// Present tracks which measures the file actually provided, so the diff
	// can report "未提供" instead of a fake 0 (核算规则 §6).
	HasInput     bool
	HasOutput    bool
	HasCacheRead bool
	HasRequests  bool
	HasCost      bool

	DuplicateRowsMerged int
	// AdjustmentCost accumulates Refund / RoundingAdjustment charge rows;
	// they are reported separately and excluded from diff percentages.
	AdjustmentCost float64
}

// LoadAzureCSV reads an Azure export according to the mapping. Unknown or
// unmatched rows are returned in skipped for the report, never silently
// dropped.
func LoadAzureCSV(r io.Reader, m *AzureMapping) (map[string]*AzureDaily, []string, error) {
	cr := csv.NewReader(r)
	cr.FieldsPerRecord = -1
	header, err := cr.Read()
	if err != nil {
		return nil, nil, fmt.Errorf("read header: %w", err)
	}
	col := make(map[string]int, len(header))
	for i, name := range header {
		col[strings.TrimSpace(strings.TrimPrefix(name, "\ufeff"))] = i
	}
	need := func(name string) (int, error) {
		if name == "" {
			return -1, nil
		}
		idx, ok := col[name]
		if !ok {
			return -1, fmt.Errorf("mapping column %q not found in file header %v", name, header)
		}
		return idx, nil
	}

	dateIdx, err := need(m.DateColumn)
	if err != nil {
		return nil, nil, err
	}
	keyIdx, err := need(m.KeyColumn)
	if err != nil {
		return nil, nil, err
	}
	resourceIdx, err := need(m.ResourceColumn)
	if err != nil {
		return nil, nil, err
	}
	inputIdx, err := need(m.Columns.InputTokens)
	if err != nil {
		return nil, nil, err
	}
	outputIdx, err := need(m.Columns.OutputTokens)
	if err != nil {
		return nil, nil, err
	}
	cacheIdx, err := need(m.Columns.CacheReadTokens)
	if err != nil {
		return nil, nil, err
	}
	requestsIdx, err := need(m.Columns.Requests)
	if err != nil {
		return nil, nil, err
	}
	quantityIdx, err := need(m.Columns.Quantity)
	if err != nil {
		return nil, nil, err
	}
	meterIdx, err := need(m.Columns.MeterName)
	if err != nil {
		return nil, nil, err
	}
	costIdx, err := need(m.Columns.Cost)
	if err != nil {
		return nil, nil, err
	}
	chargeTypeIdx, err := need(m.Columns.ChargeType)
	if err != nil {
		return nil, nil, err
	}

	out := make(map[string]*AzureDaily)
	var skipped []string
	line := 1
	for {
		record, err := cr.Read()
		if err == io.EOF {
			break
		}
		line++
		if err != nil {
			return nil, nil, fmt.Errorf("line %d: %w", line, err)
		}
		get := func(idx int) string {
			if idx < 0 || idx >= len(record) {
				return ""
			}
			return strings.TrimSpace(record[idx])
		}

		date, ok := parseDate(get(dateIdx), m.DateFormats)
		if !ok {
			skipped = append(skipped, fmt.Sprintf("line %d: unparseable date %q", line, get(dateIdx)))
			continue
		}
		key := get(keyIdx)
		if m.SiteKey == "resource_deployment" {
			key = ResourceDeploymentKey(get(resourceIdx), key)
		}
		if key == "" {
			skipped = append(skipped, fmt.Sprintf("line %d: empty key column", line))
			continue
		}
		id := date + "\x00" + key
		bucket, exists := out[id]
		if !exists {
			bucket = &AzureDaily{Date: date, Key: key}
			out[id] = bucket
		} else {
			bucket.DuplicateRowsMerged++
		}

		cost, hasCost := parseFloat(get(costIdx))
		chargeType := get(chargeTypeIdx)
		if chargeType != "" && !strings.EqualFold(chargeType, "Usage") {
			// Refund / RoundingAdjustment / Purchase rows: keep them visible
			// but out of the usage diff (核算规则 §5-§6).
			if hasCost {
				bucket.AdjustmentCost += cost
			}
			continue
		}
		if hasCost {
			bucket.Cost += cost
			bucket.HasCost = true
		}

		switch m.Format {
		case "wide":
			if v, ok := parseFloat(get(inputIdx)); ok && inputIdx >= 0 {
				bucket.InputTokens += v
				bucket.HasInput = true
			}
			if v, ok := parseFloat(get(outputIdx)); ok && outputIdx >= 0 {
				bucket.OutputTokens += v
				bucket.HasOutput = true
			}
			if v, ok := parseFloat(get(cacheIdx)); ok && cacheIdx >= 0 {
				bucket.CacheReadTokens += v
				bucket.HasCacheRead = true
			}
			if v, ok := parseFloat(get(requestsIdx)); ok && requestsIdx >= 0 {
				bucket.Requests += v
				bucket.HasRequests = true
			}
		case "meter_long":
			quantity, ok := parseFloat(get(quantityIdx))
			if !ok {
				skipped = append(skipped, fmt.Sprintf("line %d: unparseable quantity %q", line, get(quantityIdx)))
				continue
			}
			meter := get(meterIdx)
			direction := classifyMeter(meter, m.MeterRules)
			tokens := quantity * m.UnitScale
			switch direction {
			case "input":
				bucket.InputTokens += tokens
				bucket.HasInput = true
			case "output":
				bucket.OutputTokens += tokens
				bucket.HasOutput = true
			case "cache_read":
				bucket.CacheReadTokens += tokens
				bucket.HasCacheRead = true
			default:
				skipped = append(skipped, fmt.Sprintf("line %d: meter %q matched no rule", line, meter))
			}
		}
	}
	return out, skipped, nil
}

func classifyMeter(meter string, rules []MeterRule) string {
	for i := range rules {
		if rules[i].compiled != nil && rules[i].compiled.MatchString(meter) {
			return rules[i].Direction
		}
	}
	return ""
}

func parseDate(s string, formats []string) (string, bool) {
	if s == "" {
		return "", false
	}
	for _, f := range formats {
		if t, err := time.Parse(f, s); err == nil {
			return t.Format("2006-01-02"), true
		}
	}
	return "", false
}

func parseFloat(s string) (float64, bool) {
	if s == "" {
		return 0, false
	}
	v, err := strconv.ParseFloat(strings.ReplaceAll(s, ",", ""), 64)
	if err != nil {
		return 0, false
	}
	return v, true
}
