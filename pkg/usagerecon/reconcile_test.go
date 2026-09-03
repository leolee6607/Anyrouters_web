package usagerecon

import (
	"bytes"
	"strings"
	"testing"
	"time"
)

func testMapping(t *testing.T, yaml string) *AzureMapping {
	t.Helper()
	m := &AzureMapping{}
	m.Format = "wide"
	m.DateColumn = "Date"
	m.KeyColumn = "Deployment"
	m.Columns.InputTokens = "InputTokens"
	m.Columns.OutputTokens = "OutputTokens"
	m.Columns.Cost = "Cost"
	if err := m.Validate(); err != nil {
		t.Fatal(err)
	}
	return m
}

func TestLoadAzureCSVWideAndDuplicates(t *testing.T) {
	m := testMapping(t, "")
	csvData := `Date,Deployment,InputTokens,OutputTokens,Cost
2026-08-01,dep-a,1000,200,1.5
2026-08-01,dep-a,500,100,0.5
2026-08-02,dep-a,10,,
`
	azure, skipped, err := LoadAzureCSV(strings.NewReader(csvData), m)
	if err != nil {
		t.Fatal(err)
	}
	if len(skipped) != 0 {
		t.Errorf("skipped = %v", skipped)
	}
	day1 := azure["2026-08-01\x00dep-a"]
	if day1 == nil {
		t.Fatal("missing 2026-08-01 dep-a")
	}
	if day1.InputTokens != 1500 || day1.OutputTokens != 300 || day1.Cost != 2.0 {
		t.Errorf("merged bucket = %+v", day1)
	}
	if day1.DuplicateRowsMerged != 1 {
		t.Errorf("DuplicateRowsMerged = %d, want 1", day1.DuplicateRowsMerged)
	}
	day2 := azure["2026-08-02\x00dep-a"]
	if !day2.HasInput || day2.HasOutput || day2.HasCost {
		t.Errorf("presence flags = %+v (empty cells must stay 未提供, not zero)", day2)
	}
}

func TestLoadAzureCSVMeterLongAndAdjustments(t *testing.T) {
	m := &AzureMapping{}
	m.Format = "meter_long"
	m.DateColumn = "Date"
	m.KeyColumn = "ResourceId"
	m.Columns.Quantity = "Quantity"
	m.Columns.MeterName = "MeterName"
	m.Columns.Cost = "Cost"
	m.Columns.ChargeType = "ChargeType"
	m.UnitScale = 1000000
	m.MeterRules = []MeterRule{
		{Match: `(?i)\bcachd?\b|\bcd\b`, Direction: "cache_read"},
		{Match: `(?i)\bin(p)?\b`, Direction: "input"},
		{Match: `(?i)\bout(p)?\b`, Direction: "output"},
	}
	if err := m.Validate(); err != nil {
		t.Fatal(err)
	}
	csvData := `Date,ResourceId,MeterName,Quantity,Cost,ChargeType
2026-08-01,res-a,gpt mn in gl 1M Tokens,0.5,1.0,Usage
2026-08-01,res-a,gpt mn out gl 1M Tokens,0.2,2.0,Usage
2026-08-01,res-a,gpt mn cd in gl 1M Tokens,0.1,0.05,Usage
2026-08-01,res-a,whatever,1,0.01,RoundingAdjustment
2026-08-01,res-a,mystery meter,1,0.5,Usage
`
	azure, skipped, err := LoadAzureCSV(strings.NewReader(csvData), m)
	if err != nil {
		t.Fatal(err)
	}
	bucket := azure["2026-08-01\x00res-a"]
	if bucket.InputTokens != 500000 || bucket.OutputTokens != 200000 {
		t.Errorf("tokens = %+v", bucket)
	}
	// cd rule fires before in rule: cached input goes to cache_read only.
	if bucket.CacheReadTokens != 100000 {
		t.Errorf("CacheReadTokens = %v, want 100000", bucket.CacheReadTokens)
	}
	if bucket.AdjustmentCost != 0.01 {
		t.Errorf("AdjustmentCost = %v (RoundingAdjustment must be excluded from usage)", bucket.AdjustmentCost)
	}
	// cost of the adjustment row must not leak into Cost
	if bucket.Cost != 3.55 {
		t.Errorf("Cost = %v, want 3.55", bucket.Cost)
	}
	if len(skipped) != 1 || !strings.Contains(skipped[0], "mystery meter") {
		t.Errorf("skipped = %v (unmatched meters must be reported, not dropped)", skipped)
	}
}

func TestReconcileDiffLabelsAndZeroDenominator(t *testing.T) {
	site := map[string]*SiteDaily{
		"2026-08-01\x00dep-a": {
			Date: "2026-08-01", Key: "dep-a",
			InputTokens: 1000, OutputTokens: 200, Requests: 10, AmountUSD: 2,
			RetryAttempts: 1, ClientDisconnected: 2, RowsZeroUsage: 1,
		},
		"2026-08-01\x00": { // channel without mapping
			Date: "2026-08-01", Key: "", InputTokens: 5, MappingMissing: true,
		},
		"2026-08-03\x00dep-a": {Date: "2026-08-03", Key: "dep-a", InputTokens: 100},
	}
	azure := map[string]*AzureDaily{
		"2026-08-01\x00dep-a": {
			Date: "2026-08-01", Key: "dep-a",
			InputTokens: 1100, OutputTokens: 0, Cost: 2.1,
			HasInput: true, HasOutput: true, HasCost: true,
		},
		"2026-08-02\x00dep-b": {
			Date: "2026-08-02", Key: "dep-b", InputTokens: 50, HasInput: true,
		},
	}
	now := time.Date(2026, 9, 3, 0, 0, 0, 0, time.UTC)
	result := Reconcile(site, azure, nil, 0.03, now)

	find := func(date, key, measure string) *DiffRow {
		for i := range result.Rows {
			r := &result.Rows[i]
			if r.Date == date && r.Key == key && r.Measure == measure {
				return r
			}
		}
		return nil
	}

	input := find("2026-08-01", "dep-a", "input_tokens")
	if input == nil {
		t.Fatal("missing input diff row")
	}
	if input.PctDiff != "-0.0909" {
		t.Errorf("PctDiff = %s, want -0.0909", input.PctDiff)
	}
	if !strings.Contains(input.Labels, "over_threshold") ||
		!strings.Contains(input.Labels, "retried_on_another_channel") ||
		!strings.Contains(input.Labels, "client_disconnected") ||
		!strings.Contains(input.Labels, "upstream_usage_missing") {
		t.Errorf("labels = %s", input.Labels)
	}

	// denominator 0 => N/A, never a division
	output := find("2026-08-01", "dep-a", "output_tokens")
	if output.PctDiff != "N/A" {
		t.Errorf("zero-denominator PctDiff = %s, want N/A", output.PctDiff)
	}

	// azure-only bucket: site shows 未提供
	azureOnly := find("2026-08-02", "dep-b", "input_tokens")
	if azureOnly == nil || azureOnly.Site != "未提供" || !strings.Contains(azureOnly.Labels, "site_missing") {
		t.Errorf("azure-only row = %+v", azureOnly)
	}

	// site-only bucket: azure shows 未提供 and azure_missing label
	siteOnly := find("2026-08-03", "dep-a", "input_tokens")
	if siteOnly == nil || siteOnly.Azure != "未提供" || !strings.Contains(siteOnly.Labels, "azure_missing") {
		t.Errorf("site-only row = %+v", siteOnly)
	}

	// unmapped channel carries mapping_missing
	unmapped := find("2026-08-01", "", "input_tokens")
	if unmapped == nil || !strings.Contains(unmapped.Labels, "mapping_missing") {
		t.Errorf("unmapped row = %+v", unmapped)
	}

	var buf bytes.Buffer
	if err := WriteSummaryMarkdown(&buf, result); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(buf.String(), "N/A") {
		t.Errorf("summary should surface N/A rates:\n%s", buf.String())
	}
}

func TestLoadSiteCSVRoundTrip(t *testing.T) {
	rows := []*DailyRow{{
		Key:             DailyKey{Date: "2026-08-01", ChannelId: 7, ModelUpstream: "gpt-5.6-dep", ModelSite: "gpt-5.6"},
		RequestsSuccess: 10, TokensPromptTotal: 1050, TokensInput: 1000, TokensOutput: 200, TokensCacheRead: 50, Quota: 500000,
	}}
	channelMap := &ChannelMap{Channels: []ChannelMapEntry{{
		ChannelId: 7, ChannelName: "azure-a", AccountLabel: "account_a",
		AzureResource: "rg-foundry/res-a", Deployment: "dep-a",
	}}}
	var buf bytes.Buffer
	if err := WriteCanonicalCSV(&buf, rows, channelMap); err != nil {
		t.Fatal(err)
	}
	site, err := LoadSiteCSV(bytes.NewReader(buf.Bytes()), "deployment")
	if err != nil {
		t.Fatal(err)
	}
	bucket := site["2026-08-01\x00dep-a"]
	if bucket == nil {
		t.Fatalf("missing joined bucket, got keys: %v", keysOf(site))
	}
	if bucket.InputTokens != 1050 || bucket.Requests != 10 || bucket.AmountUSD != 1.0 {
		t.Errorf("bucket = %+v", bucket)
	}
}

func TestMultiDeploymentChannelUsesResourceScopedKey(t *testing.T) {
	rows := []*DailyRow{
		{
			Key:             DailyKey{Date: "2026-08-01", ChannelId: 3, ModelUpstream: "gpt-a", ModelSite: "alias-a"},
			RequestsSuccess: 1, TokensPromptTotal: 100, TokensInput: 100,
		},
		{
			Key:             DailyKey{Date: "2026-08-01", ChannelId: 3, ModelUpstream: "gpt-b", ModelSite: "alias-b"},
			RequestsSuccess: 1, TokensPromptTotal: 200, TokensInput: 200,
		},
	}
	channelMap := &ChannelMap{Channels: []ChannelMapEntry{{
		ChannelId: 3, ChannelName: "azure-a", AccountLabel: "account_a",
		AzureResource: "resource-a",
		Deployments: map[string]string{
			"gpt-a": "deployment-a",
			"gpt-b": "deployment-b",
		},
	}}}
	var buf bytes.Buffer
	if err := WriteCanonicalCSV(&buf, rows, channelMap); err != nil {
		t.Fatal(err)
	}
	site, err := LoadSiteCSV(bytes.NewReader(buf.Bytes()), "resource_deployment")
	if err != nil {
		t.Fatal(err)
	}
	if got := site["2026-08-01\x00resource-a|deployment-a"]; got == nil || got.InputTokens != 100 {
		t.Fatalf("deployment-a bucket = %+v, keys: %v", got, keysOf(site))
	}
	if got := site["2026-08-01\x00resource-a|deployment-b"]; got == nil || got.InputTokens != 200 {
		t.Fatalf("deployment-b bucket = %+v, keys: %v", got, keysOf(site))
	}
}

func TestLoadSiteCSVV10ReconstructsFullPromptTokens(t *testing.T) {
	legacyCSV := `date,deployment,requests_success,tokens_input,tokens_output,tokens_cache_read,tokens_cache_write,amount_usd,requests_error_logged,retry_attempts,client_disconnected,rows_local_estimated,rows_cache_write_estimated,rows_zero_usage
2026-08-01,dep-a,1,100,20,40,10,0.1,0,0,0,0,0,0
`
	site, err := LoadSiteCSV(strings.NewReader(legacyCSV), "deployment")
	if err != nil {
		t.Fatal(err)
	}
	if got := site["2026-08-01\x00dep-a"].InputTokens; got != 150 {
		t.Fatalf("legacy reconstructed input = %v, want 150", got)
	}
}

func TestLoadAzureCSVResourceDeploymentKeyAvoidsCrossResourceCollision(t *testing.T) {
	m := testMapping(t, "")
	m.SiteKey = "resource_deployment"
	m.ResourceColumn = "Resource"
	if err := m.Validate(); err != nil {
		t.Fatal(err)
	}
	csvData := `Date,Resource,Deployment,InputTokens,OutputTokens,Cost
2026-08-01,resource-a,same-name,100,20,1
2026-08-01,resource-b,same-name,200,40,2
`
	azure, skipped, err := LoadAzureCSV(strings.NewReader(csvData), m)
	if err != nil {
		t.Fatal(err)
	}
	if len(skipped) != 0 {
		t.Fatalf("skipped = %v", skipped)
	}
	if got := azure["2026-08-01\x00resource-a|same-name"]; got == nil || got.InputTokens != 100 {
		t.Fatalf("resource-a bucket = %+v", got)
	}
	if got := azure["2026-08-01\x00resource-b|same-name"]; got == nil || got.InputTokens != 200 {
		t.Fatalf("resource-b bucket = %+v", got)
	}
}

func keysOf(m map[string]*SiteDaily) []string {
	var out []string
	for k := range m {
		out = append(out, strings.ReplaceAll(k, "\x00", "|"))
	}
	return out
}
