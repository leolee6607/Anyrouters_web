package usagerecon

import (
	"encoding/csv"
	"fmt"
	"io"
	"strconv"
)

// CanonicalHeader is the column order of the canonical daily usage CSV (v1).
// The reconcile subcommand consumes exactly this format as the site side.
var CanonicalHeader = []string{
	"date", "channel_id", "channel_name", "account_label", "azure_resource", "deployment",
	"model_upstream", "model_site",
	"requests_success", "requests_error_logged", "requests_refund", "retry_attempts", "client_disconnected",
	"tokens_input", "tokens_output", "tokens_cache_read", "tokens_cache_write",
	"tokens_audio_input", "tokens_audio_output", "tokens_image",
	"rows_local_estimated", "rows_cache_write_estimated", "rows_zero_usage", "rows_other_parse_failed",
	"quota", "amount_usd",
}

// WriteCanonicalCSV writes aggregated rows in canonical format, joining the
// operator-provided channel map for attribution columns.
func WriteCanonicalCSV(w io.Writer, rows []*DailyRow, channelMap *ChannelMap) error {
	cw := csv.NewWriter(w)
	if err := cw.Write(CanonicalHeader); err != nil {
		return err
	}
	for _, r := range rows {
		var channelName, accountLabel, azureResource, deployment string
		if entry := channelMap.Lookup(r.Key.ChannelId); entry != nil {
			channelName = entry.ChannelName
			accountLabel = entry.AccountLabel
			azureResource = entry.AzureResource
			deployment = entry.Deployment
		}
		record := []string{
			r.Key.Date,
			strconv.Itoa(r.Key.ChannelId),
			channelName, accountLabel, azureResource, deployment,
			r.Key.ModelUpstream, r.Key.ModelSite,
			i64(r.RequestsSuccess), i64(r.RequestsErrorLogged), i64(r.RequestsRefund),
			i64(r.RetryAttempts), i64(r.ClientDisconnected),
			i64(r.TokensInput), i64(r.TokensOutput), i64(r.TokensCacheRead), i64(r.TokensCacheWrite),
			i64(r.TokensAudioIn), i64(r.TokensAudioOut), i64(r.TokensImage),
			i64(r.RowsLocalEstimated), i64(r.RowsCacheWriteEstimated), i64(r.RowsZeroUsage), i64(r.RowsOtherParseFailed),
			i64(r.Quota),
			fmt.Sprintf("%.6f", float64(r.Quota)/QuotaPerUnit),
		}
		if err := cw.Write(record); err != nil {
			return err
		}
	}
	cw.Flush()
	return cw.Error()
}

func i64(v int64) string { return strconv.FormatInt(v, 10) }
