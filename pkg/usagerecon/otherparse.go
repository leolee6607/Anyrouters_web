package usagerecon

import (
	"github.com/QuantumNous/new-api/common"
)

// ParseOther extracts the token detail and audit markers from a log row's
// "other" JSON. The schema of this blob drifts across versions, so parsing is
// deliberately tolerant: missing keys are zero, unexpected shapes are skipped,
// and a top-level parse failure only sets ParseFailed (the row still counts
// toward request totals with its column-level tokens).
func ParseOther(other string) OtherInfo {
	var info OtherInfo
	if other == "" || other == "{}" {
		return info
	}
	var raw map[string]interface{}
	if err := common.UnmarshalJsonStr(other, &raw); err != nil {
		info.ParseFailed = true
		return info
	}

	info.UpstreamModelName = asString(raw["upstream_model_name"])
	info.UsageSemantic = asString(raw["usage_semantic"])
	info.CacheReadTokens = asInt(raw["cache_tokens"])
	info.CacheWriteTokens = effectiveCacheWrite(raw)
	info.AudioInputTokens = asInt(raw["audio_input"])
	info.AudioOutputTokens = asInt(raw["audio_output"])
	info.ImageTokens = asInt(raw["image"])
	info.CacheWriteEstimated = asBool(raw["cache_write_estimated"])

	if adminInfo, ok := raw["admin_info"].(map[string]interface{}); ok {
		info.LocalCountTokens = asBool(adminInfo["local_count_tokens"])
		if useChannel, ok := adminInfo["use_channel"].([]interface{}); ok {
			info.UseChannelLen = len(useChannel)
		}
	}
	if streamStatus, ok := raw["stream_status"].(map[string]interface{}); ok {
		if asString(streamStatus["end_reason"]) == "client_gone" {
			info.ClientGone = true
		}
	}
	return info
}

// effectiveCacheWrite mirrors dto.Usage.EffectiveCacheCreationTokens: the
// native cache_write_tokens is preferred, falling back to the legacy
// cache_creation_tokens, falling back to the Claude 5m/1h split sum. Values
// are never added across aliases to avoid double counting.
func effectiveCacheWrite(raw map[string]interface{}) int64 {
	if v := asInt(raw["cache_write_tokens"]); v > 0 {
		return v
	}
	if v := asInt(raw["cache_creation_tokens"]); v > 0 {
		return v
	}
	return asInt(raw["cache_creation_tokens_5m"]) + asInt(raw["cache_creation_tokens_1h"])
}

func asString(v interface{}) string {
	s, _ := v.(string)
	return s
}

func asBool(v interface{}) bool {
	b, _ := v.(bool)
	return b
}

func asInt(v interface{}) int64 {
	switch n := v.(type) {
	case float64:
		if n < 0 {
			return 0
		}
		return int64(n)
	case int64:
		if n < 0 {
			return 0
		}
		return n
	case int:
		if n < 0 {
			return 0
		}
		return int64(n)
	default:
		return 0
	}
}
