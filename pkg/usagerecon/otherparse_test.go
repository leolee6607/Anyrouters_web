package usagerecon

import "testing"

func TestParseOtherTolerant(t *testing.T) {
	tests := []struct {
		name  string
		other string
		want  OtherInfo
	}{
		{"empty", "", OtherInfo{}},
		{"empty object", "{}", OtherInfo{}},
		{"invalid json", "{not json", OtherInfo{ParseFailed: true}},
		{
			"openai with cache read",
			`{"cache_tokens": 1024, "upstream_model_name": "gpt-5.6-dep", "admin_info": {"local_count_tokens": true, "use_channel": [1, 2, 3]}}`,
			OtherInfo{CacheReadTokens: 1024, UpstreamModelName: "gpt-5.6-dep", LocalCountTokens: true, UseChannelLen: 3},
		},
		{
			"cache write native preferred over legacy alias",
			`{"cache_write_tokens": 256, "cache_creation_tokens": 999}`,
			OtherInfo{CacheWriteTokens: 256},
		},
		{
			"cache write legacy fallback",
			`{"cache_creation_tokens": 300}`,
			OtherInfo{CacheWriteTokens: 300},
		},
		{
			"cache write claude 5m/1h split fallback",
			`{"cache_creation_tokens_5m": 100, "cache_creation_tokens_1h": 50}`,
			OtherInfo{CacheWriteTokens: 150},
		},
		{
			"gpt56 estimated cache write marker",
			`{"cache_write_estimated": true, "cache_write_tokens": 1152}`,
			OtherInfo{CacheWriteEstimated: true, CacheWriteTokens: 1152},
		},
		{
			"client gone stream status",
			`{"stream_status": {"status": "interrupted", "end_reason": "client_gone"}}`,
			OtherInfo{ClientGone: true},
		},
		{
			"anthropic semantic with audio",
			`{"usage_semantic": "anthropic", "audio_input": 500, "audio_output": 700}`,
			OtherInfo{UsageSemantic: "anthropic", AudioInputTokens: 500, AudioOutputTokens: 700},
		},
		{
			"negative and wrong-typed values clamp to zero",
			`{"cache_tokens": -5, "audio_input": "oops", "image": null}`,
			OtherInfo{},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ParseOther(tt.other)
			if got != tt.want {
				t.Errorf("ParseOther() = %+v, want %+v", got, tt.want)
			}
		})
	}
}
