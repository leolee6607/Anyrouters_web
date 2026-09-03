// Package usagerecon implements the phase-1 offline metering tools:
// daily site-side usage export from the logs table, and offline
// reconciliation against operator-provided (desensitized) Azure exports.
//
// Read-only by design: nothing in this package mutates billing state.
package usagerecon

// Log type constants mirrored from model/log.go (kept local so the CLI does
// not import the model package and its server-side dependencies).
const (
	LogTypeConsume = 2
	LogTypeError   = 5
	LogTypeRefund  = 6
)

// QuotaPerUnit mirrors common.QuotaPerUnit's default (500000 quota = $1).
// The export writes both raw quota and the USD conversion; the conversion is
// display-only and never feeds back into billing.
const QuotaPerUnit = 500 * 1000.0

// LogRow is the minimal read-only projection of the logs table used by the
// export. Field tags match the existing column names.
type LogRow struct {
	Id               int    `gorm:"column:id"`
	CreatedAt        int64  `gorm:"column:created_at"`
	Type             int    `gorm:"column:type"`
	ModelName        string `gorm:"column:model_name"`
	Quota            int    `gorm:"column:quota"`
	PromptTokens     int    `gorm:"column:prompt_tokens"`
	CompletionTokens int    `gorm:"column:completion_tokens"`
	IsStream         bool   `gorm:"column:is_stream"`
	ChannelId        int    `gorm:"column:channel_id"`
	Other            string `gorm:"column:other"`
}

// OtherInfo is the tolerant projection of the log "other" JSON blob.
// Unknown keys are ignored; missing keys default to zero values.
type OtherInfo struct {
	UpstreamModelName   string
	UsageSemantic       string // "anthropic" => prompt tokens are cache-exclusive already
	CacheReadTokens     int64
	CacheWriteTokens    int64
	AudioInputTokens    int64
	AudioOutputTokens   int64
	ImageTokens         int64
	UseChannelLen       int
	LocalCountTokens    bool
	CacheWriteEstimated bool
	ClientGone          bool
	ParseFailed         bool
}

// DailyKey identifies one aggregation bucket.
type DailyKey struct {
	Date          string // formatted in the export timezone
	ChannelId     int
	ModelUpstream string
	ModelSite     string
}

// DailyRow is one row of the canonical daily usage format (v1).
type DailyRow struct {
	Key DailyKey

	RequestsSuccess     int64
	RequestsErrorLogged int64
	RequestsRefund      int64
	RetryAttempts       int64
	ClientDisconnected  int64

	TokensInput      int64
	TokensOutput     int64
	TokensCacheRead  int64
	TokensCacheWrite int64
	TokensAudioIn    int64
	TokensAudioOut   int64
	TokensImage      int64

	RowsLocalEstimated      int64
	RowsCacheWriteEstimated int64
	RowsZeroUsage           int64
	RowsOtherParseFailed    int64

	Quota int64
}

// ChannelMapEntry carries operator-provided channel attribution
// (channel id -> account label -> Azure resource -> deployment).
type ChannelMapEntry struct {
	ChannelId    int    `yaml:"channel_id"`
	ChannelName  string `yaml:"channel_name"`
	AccountLabel string `yaml:"account_label"`
	AzureResource string `yaml:"azure_resource"`
	Deployment   string `yaml:"deployment"`
}

// ChannelMap is the top-level channel_map.yaml document.
type ChannelMap struct {
	Channels []ChannelMapEntry `yaml:"channels"`
}

func (m *ChannelMap) Lookup(channelId int) *ChannelMapEntry {
	if m == nil {
		return nil
	}
	for i := range m.Channels {
		if m.Channels[i].ChannelId == channelId {
			return &m.Channels[i]
		}
	}
	return nil
}
