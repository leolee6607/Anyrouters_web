package usagerecon

import (
	"sort"
	"time"
)

// Aggregator folds log rows into daily buckets. Day boundaries are computed
// in Go from the row's unix timestamp and the export timezone, so the SQL
// side needs no date functions and stays portable across SQLite, MySQL and
// PostgreSQL.
type Aggregator struct {
	loc  *time.Location
	rows map[DailyKey]*DailyRow
}

func NewAggregator(loc *time.Location) *Aggregator {
	if loc == nil {
		loc = time.UTC
	}
	return &Aggregator{loc: loc, rows: make(map[DailyKey]*DailyRow)}
}

func (a *Aggregator) Add(row *LogRow) {
	info := ParseOther(row.Other)

	modelUpstream := info.UpstreamModelName
	if modelUpstream == "" {
		modelUpstream = row.ModelName
	}
	key := DailyKey{
		Date:          time.Unix(row.CreatedAt, 0).In(a.loc).Format("2006-01-02"),
		ChannelId:     row.ChannelId,
		ModelUpstream: modelUpstream,
		ModelSite:     row.ModelName,
	}
	bucket, ok := a.rows[key]
	if !ok {
		bucket = &DailyRow{Key: key}
		a.rows[key] = bucket
	}

	switch row.Type {
	case LogTypeError:
		bucket.RequestsErrorLogged++
		return
	case LogTypeRefund:
		bucket.RequestsRefund++
		return
	case LogTypeConsume:
		// fallthrough to the full accumulation below
	default:
		return
	}

	bucket.RequestsSuccess++
	if info.UseChannelLen > 1 {
		bucket.RetryAttempts += int64(info.UseChannelLen - 1)
	}
	if info.ClientGone {
		bucket.ClientDisconnected++
	}

	prompt := int64(row.PromptTokens)
	completion := int64(row.CompletionTokens)

	// Mutually-exclusive token buckets: for OpenAI-style usage, prompt_tokens
	// is a superset that already contains cache read/write; for Claude-style
	// ("anthropic" semantic) input_tokens excludes cache buckets.
	input := prompt
	if info.UsageSemantic != "anthropic" {
		input -= info.CacheReadTokens + info.CacheWriteTokens
		if input < 0 {
			input = 0
		}
	}
	bucket.TokensInput += input
	bucket.TokensOutput += completion
	bucket.TokensCacheRead += info.CacheReadTokens
	bucket.TokensCacheWrite += info.CacheWriteTokens
	bucket.TokensAudioIn += info.AudioInputTokens
	bucket.TokensAudioOut += info.AudioOutputTokens
	bucket.TokensImage += info.ImageTokens

	if info.LocalCountTokens {
		bucket.RowsLocalEstimated++
	}
	if info.CacheWriteEstimated {
		bucket.RowsCacheWriteEstimated++
	}
	if prompt == 0 && completion == 0 {
		bucket.RowsZeroUsage++
	}
	if info.ParseFailed {
		bucket.RowsOtherParseFailed++
	}
	bucket.Quota += int64(row.Quota)
}

// Rows returns the aggregated buckets sorted by (date, channel, model) for
// deterministic, byte-identical re-runs.
func (a *Aggregator) Rows() []*DailyRow {
	out := make([]*DailyRow, 0, len(a.rows))
	for _, r := range a.rows {
		out = append(out, r)
	}
	sort.Slice(out, func(i, j int) bool {
		ki, kj := out[i].Key, out[j].Key
		if ki.Date != kj.Date {
			return ki.Date < kj.Date
		}
		if ki.ChannelId != kj.ChannelId {
			return ki.ChannelId < kj.ChannelId
		}
		if ki.ModelUpstream != kj.ModelUpstream {
			return ki.ModelUpstream < kj.ModelUpstream
		}
		return ki.ModelSite < kj.ModelSite
	})
	return out
}
