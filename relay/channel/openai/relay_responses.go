package openai

import (
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/logger"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
)

func OaiResponsesHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	defer service.CloseResponseBodyGracefully(resp)

	// read response body
	var responsesResponse dto.OpenAIResponsesResponse
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeReadResponseBodyFailed, http.StatusInternalServerError)
	}
	err = common.Unmarshal(responseBody, &responsesResponse)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
	}
	if oaiError := responsesResponse.GetOpenAIError(); oaiError != nil && oaiError.Type != "" {
		return nil, types.WithOpenAIError(*oaiError, resp.StatusCode)
	}

	if responsesResponse.HasImageGenerationCall() {
		c.Set("image_generation_call", true)
		c.Set("image_generation_call_quality", responsesResponse.GetQuality())
		c.Set("image_generation_call_size", responsesResponse.GetSize())
	}

	// 写入新的 response body
	service.IOCopyBytesGracefully(c, resp, responseBody)

	// compute usage
	usage := dto.Usage{}
	if responsesResponse.Usage == nil {
		service.MarkUsageSource(c, service.UsageSourceMissing)
	}
	if responsesResponse.Usage != nil {
		usage.PromptTokens = responsesResponse.Usage.InputTokens
		usage.CompletionTokens = responsesResponse.Usage.OutputTokens
		usage.TotalTokens = responsesResponse.Usage.TotalTokens
		if responsesResponse.Usage.InputTokensDetails != nil {
			copyInputTokenDetails(&usage.PromptTokensDetails, responsesResponse.Usage.InputTokensDetails)
		}
	}
	recordResponsesOutputToolCalls(info, responsesResponse.Output)
	return &usage, nil
}

func recordResponsesToolCall(info *relaycommon.RelayInfo, outputType string) {
	if info == nil || info.ResponsesUsageInfo == nil || info.ResponsesUsageInfo.BuiltInTools == nil {
		return
	}

	var toolType string
	switch outputType {
	case dto.BuildInCallWebSearchCall:
		toolType = dto.BuildInToolWebSearchPreview
	case dto.BuildInCallFileSearchCall:
		toolType = dto.BuildInToolFileSearch
	default:
		return
	}

	if tool, exists := info.ResponsesUsageInfo.BuiltInTools[toolType]; exists && tool != nil {
		tool.CallCount++
	}
}

func recordResponsesOutputToolCalls(info *relaycommon.RelayInfo, outputs []dto.ResponsesOutput) {
	for _, output := range outputs {
		recordResponsesToolCall(info, output.Type)
	}
}

func OaiResponsesStreamHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	if resp == nil || resp.Body == nil {
		logger.LogError(c, "invalid response or response body")
		return nil, types.NewError(fmt.Errorf("invalid response"), types.ErrorCodeBadResponse)
	}

	defer service.CloseResponseBodyGracefully(resp)

	var usage = &dto.Usage{}
	var responseTextBuilder strings.Builder
	terminalSeen := false
	lastSequenceNumber := 0

	helper.StreamScannerHandler(c, resp, info, func(data string, sr *helper.StreamResult) {

		// 检查当前数据是否包含 completed 状态和 usage 信息
		var streamResponse dto.ResponsesStreamResponse
		if err := common.UnmarshalJsonStr(data, &streamResponse); err != nil {
			logger.LogError(c, "failed to unmarshal stream response: "+err.Error())
			sr.Error(err)
			return
		}
		if streamResponse.SequenceNumber > lastSequenceNumber {
			lastSequenceNumber = streamResponse.SequenceNumber
		}
		sendResponsesStreamData(c, streamResponse, data)
		switch streamResponse.Type {
		case "response.completed", "response.incomplete":
			terminalSeen = true
			if streamResponse.Response != nil {
				if streamResponse.Response.Usage != nil {
					if streamResponse.Response.Usage.InputTokens != 0 {
						usage.PromptTokens = streamResponse.Response.Usage.InputTokens
					}
					if streamResponse.Response.Usage.OutputTokens != 0 {
						usage.CompletionTokens = streamResponse.Response.Usage.OutputTokens
					}
					if streamResponse.Response.Usage.TotalTokens != 0 {
						usage.TotalTokens = streamResponse.Response.Usage.TotalTokens
					}
					if streamResponse.Response.Usage.InputTokensDetails != nil {
						copyInputTokenDetails(&usage.PromptTokensDetails, streamResponse.Response.Usage.InputTokensDetails)
					}
				}
				if streamResponse.Response.HasImageGenerationCall() {
					c.Set("image_generation_call", true)
					c.Set("image_generation_call_quality", streamResponse.Response.GetQuality())
					c.Set("image_generation_call_size", streamResponse.Response.GetSize())
				}
			}
			sr.Done()
		case "response.failed", "error":
			terminalSeen = true
			sr.Done()
		case "response.output_text.delta":
			// 处理输出文本
			responseTextBuilder.WriteString(streamResponse.Delta)
		case dto.ResponsesOutputTypeItemDone:
			// 函数调用处理
			if streamResponse.Item != nil {
				recordResponsesToolCall(info, streamResponse.Item.Type)
			}
		}
	})

	if !terminalSeen {
		apiErr := responsesStreamTerminationError(info.StreamStatus)
		if info.StreamStatus == nil || info.StreamStatus.EndReason != relaycommon.StreamEndReasonClientGone {
			errorEvent := map[string]any{
				"type":            "error",
				"code":            apiErr.GetErrorCode(),
				"message":         "Upstream stream disconnected before completion. Retry the request.",
				"param":           nil,
				"sequence_number": lastSequenceNumber + 1,
			}
			if errorData, err := common.Marshal(errorEvent); err == nil {
				helper.ResponseChunkData(c, dto.ResponsesStreamResponse{Type: "error"}, string(errorData))
				c.Set("responses_stream_error_sent", true)
			}
		}
		return nil, apiErr
	}

	if usage.CompletionTokens == 0 {
		// 计算输出文本的 token 数量
		tempStr := responseTextBuilder.String()
		if len(tempStr) > 0 {
			// 非正常结束，使用输出文本的 token 数量
			completionTokens := service.CountTextToken(tempStr, info.UpstreamModelName)
			usage.CompletionTokens = completionTokens
			service.MarkUsageSource(c, service.UsageSourceLocalEstimate)
		}
	}

	if usage.PromptTokens == 0 && usage.CompletionTokens != 0 {
		usage.PromptTokens = info.GetEstimatePromptTokens()
		service.MarkUsageSource(c, service.UsageSourceLocalEstimate)
	}

	usage.TotalTokens = usage.PromptTokens + usage.CompletionTokens

	return usage, nil
}
