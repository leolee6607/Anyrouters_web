package usagerecon

import (
	"testing"
	"time"
)

func TestAggregatorTokenBucketsAndTimezone(t *testing.T) {
	// 2026-08-01 23:30 UTC == 2026-08-02 07:30 UTC+8: the same instant must
	// land in different day buckets depending on the export timezone.
	ts := time.Date(2026, 8, 1, 23, 30, 0, 0, time.UTC).Unix()

	openaiRow := &LogRow{
		Id: 1, CreatedAt: ts, Type: LogTypeConsume, ModelName: "gpt-5.6",
		Quota: 1000, PromptTokens: 2000, CompletionTokens: 300, ChannelId: 7,
		Other: `{"cache_tokens": 500, "cache_write_tokens": 128, "upstream_model_name": "gpt-5.6-dep"}`,
	}

	utcAgg := NewAggregator(time.UTC)
	utcAgg.Add(openaiRow)
	rows := utcAgg.Rows()
	if len(rows) != 1 {
		t.Fatalf("expected 1 row, got %d", len(rows))
	}
	r := rows[0]
	if r.Key.Date != "2026-08-01" {
		t.Errorf("UTC date = %s, want 2026-08-01", r.Key.Date)
	}
	if r.Key.ModelUpstream != "gpt-5.6-dep" || r.Key.ModelSite != "gpt-5.6" {
		t.Errorf("model keys = %+v", r.Key)
	}
	// OpenAI semantics: input excludes cache read and write.
	if r.TokensInput != 2000-500-128 {
		t.Errorf("TokensInput = %d, want %d", r.TokensInput, 2000-500-128)
	}
	if r.TokensCacheRead != 500 || r.TokensCacheWrite != 128 || r.TokensOutput != 300 {
		t.Errorf("token buckets = %+v", r)
	}

	shanghai, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		t.Skip("tzdata unavailable")
	}
	cnAgg := NewAggregator(shanghai)
	cnAgg.Add(openaiRow)
	if got := cnAgg.Rows()[0].Key.Date; got != "2026-08-02" {
		t.Errorf("UTC+8 date = %s, want 2026-08-02", got)
	}
}

func TestAggregatorClaudeSemanticsNoDeduction(t *testing.T) {
	agg := NewAggregator(time.UTC)
	agg.Add(&LogRow{
		Id: 1, CreatedAt: 1000, Type: LogTypeConsume, ModelName: "claude-x",
		PromptTokens: 100, CompletionTokens: 50,
		Other: `{"usage_semantic": "anthropic", "cache_tokens": 400, "cache_creation_tokens": 200}`,
	})
	r := agg.Rows()[0]
	// Claude semantics: input_tokens is already cache-exclusive.
	if r.TokensInput != 100 {
		t.Errorf("TokensInput = %d, want 100", r.TokensInput)
	}
	if r.TokensCacheRead != 400 || r.TokensCacheWrite != 200 {
		t.Errorf("cache buckets = %+v", r)
	}
}

func TestAggregatorRowTypesAndMarkers(t *testing.T) {
	agg := NewAggregator(time.UTC)
	// success with a retry chain and a client disconnect
	agg.Add(&LogRow{
		Id: 1, CreatedAt: 1000, Type: LogTypeConsume, ModelName: "m", ChannelId: 1,
		PromptTokens: 10, CompletionTokens: 5, Quota: 3,
		Other: `{"admin_info": {"use_channel": [1, 2]}, "stream_status": {"end_reason": "client_gone"}}`,
	})
	// zero-usage success row (upstream returned nothing)
	agg.Add(&LogRow{Id: 2, CreatedAt: 1001, Type: LogTypeConsume, ModelName: "m", ChannelId: 1})
	// error and refund rows only count requests
	agg.Add(&LogRow{Id: 3, CreatedAt: 1002, Type: LogTypeError, ModelName: "m", ChannelId: 1, PromptTokens: 999})
	agg.Add(&LogRow{Id: 4, CreatedAt: 1003, Type: LogTypeRefund, ModelName: "m", ChannelId: 1})
	// unknown type ignored entirely
	agg.Add(&LogRow{Id: 5, CreatedAt: 1004, Type: 1, ModelName: "m", ChannelId: 1})

	r := agg.Rows()[0]
	if r.RequestsSuccess != 2 || r.RequestsErrorLogged != 1 || r.RequestsRefund != 1 {
		t.Errorf("request counts = %+v", r)
	}
	if r.RetryAttempts != 1 || r.ClientDisconnected != 1 {
		t.Errorf("retry/disconnect = %+v", r)
	}
	if r.RowsZeroUsage != 1 {
		t.Errorf("RowsZeroUsage = %d, want 1", r.RowsZeroUsage)
	}
	// error rows must not contribute tokens
	if r.TokensInput != 10 {
		t.Errorf("TokensInput = %d, want 10", r.TokensInput)
	}
	if r.Quota != 3 {
		t.Errorf("Quota = %d, want 3", r.Quota)
	}
}
