package model_setting

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestDefaultGeminiImageModelsSupportImagine(t *testing.T) {
	for _, model := range []string{
		GeminiNanoBanana21,
		"gemini-3-pro-image",
		"gemini-3.1-flash-image",
		"gemini-3.1-flash-lite-image",
	} {
		require.True(t, IsGeminiModelSupportImagine(model), model)
	}
}
