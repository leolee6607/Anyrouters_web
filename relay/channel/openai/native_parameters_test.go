package openai

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestNativeAdaptorNormalizesChatAndResponses(t *testing.T) {
	for _, channel := range []int{constant.ChannelTypeOpenAI, constant.ChannelTypeAzure} {
		info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{ChannelType: channel, UpstreamModelName: "gpt-5.6-luna"}}
		req := &dto.GeneralOpenAIRequest{Model: "gpt-5.6-luna", THINKING: []byte(`{"type":"disabled"}`), Temperature: common.GetPointer(0.0)}
		a := &Adaptor{}
		_, err := a.ConvertOpenAIRequest(nil, info, req)
		require.NoError(t, err)
		require.Equal(t, "none", req.ReasoningEffort)
		require.Empty(t, req.THINKING)
		require.NotNil(t, req.Temperature)
		result, err := a.ConvertOpenAIResponsesRequest(nil, info, dto.OpenAIResponsesRequest{Model: "gpt-5.6-sol", Temperature: common.GetPointer(0.7), TopP: common.GetPointer(1.0)})
		require.NoError(t, err)
		response := result.(dto.OpenAIResponsesRequest)
		require.Nil(t, response.Temperature)
		require.Nil(t, response.TopP)
	}
}
