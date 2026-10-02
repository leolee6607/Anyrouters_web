# 原生 GPT 参数兼容修复（2026-10-02）

## 问题与处理

近期错误审计发现重复的 GPT-5.6 Luna `Unknown parameter: thinking` 和 Sol `Unsupported parameter: temperature`。渠道未启用原样透传，也没有注入 thinking 的参数覆盖。Chat 原生适配器与 Chat→Responses / 原生 Responses 的采样规则不一致；通用请求 DTO 则把其他供应商的 thinking 原样送给 Azure。修改前使用实际适配器复现以上差异。

- 原生 OpenAI/Azure 的 GPT 请求统一处理 Chat、Chat→Responses、Responses 三条路径。思考布尔开关、type=enabled/disabled、enable_thinking 以及 Chat 的 reasoning.effort 别名转换为对应官方字段。
- 保留有效的显式 effort，冲突设置、无等价 OpenAI 语义的 token budget 返回明确 HTTP 400，并禁止重试。不会将预算随意换算成 low/high，也不通过关闭推理掩盖错误。
- GPT-5.6 与当前 GPT-6 支持 none 的型号保留采样参数，包括显式零值；推理模式统一移除不支持的 temperature、top_p、logprobs、top_logprobs / Responses logprobs include。
- Luna/Terra 5.6 带工具的 Chat 请求自动使用原生 Responses，避免推理＋工具在 Chat 上不受支持。已有 GPT-6 路由保持不变。
- OpenRouter、Claude、Gemini 等供应商参数规则不受原生 GPT 规范化影响。显式开启原样透传的管理员配置仍保持原样。
- 同时将 Gemini/Vertex 在 `/v1/images/generations` 上调用 Gemini image 的错误由模糊 500 改为明确 400，指向受支持的 Chat / generateContent 接口。网站聊天区本就使用正确入口。本补丁不宣称新增 OpenAI Images→Gemini 协议桥。

## 验证范围

- 修改前：实际适配器测试复现 thinking 泄漏、Sol Responses 温度未过滤；标准 reasoning_effort 对照正常。
- 修改后：Go 全仓回归；新增别名、冲突、预算、供应商隔离、七型号参数、显式零值和实际 Chat→Responses 出站请求测试。
- Azure 原生验证：5.6 Sol/Terra/Luna 的 none＋temperature/top_p，在 Chat 和 Responses 共六次调用均 200。
- 额外并发检查发现既有 Gemini 测试在并行用例中反复修改 Gin 全局模式；移到测试初始化阶段，相关四包 race 检查全部通过。仅测试夹具改变，不影响运行代码。
- 安装脚本回归：本机 54 pass，20 个 Windows PowerShell 测试因运行环境不支持跳过；脚本文件未修改。前次 Windows CI 不代表本次重新运行。
- 本地全仓测试使用已有前端构建产物完成 go:embed 编译；发布镜像会从源代码重新构建前端。
- 候选、正式域名实际流式/工具/错误不扣费与安装脚本哈希，发布后追加到 release-result.md。

未读取或保存用户完整提示词；公开仓库不包含客户身份、凭据和客户请求原文。现有日志没有 thinking 的具体值，因此不能声称已逐字复现客户原始 payload。若原请求携带 token budget，需要按返回提示改用官方 effort 字段；其他无歧义别名自动兼容。

## 发布与回退

沿用 ACR 构建、Azure Container Apps 零流量候选验证、1%→100% 的流程。仅更新应用镜像，不修改费率、渠道凭据、用户额度、历史消费或数据库结构。发布前保留完整配置私有快照，并断言除了镜像/版本外的模板与配置一致。

回退到发布前 `ca-anyrouters-web--audit-errors-20260930` 100% 流量即可；错误审计环境变量保持开启。镜像与流量最终事实见 release-result.md。

参考：[OpenAI GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna)、[GPT-5.6 Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol)、[GPT-6 参数迁移](https://developers.openai.com/api/docs/guides/latest-model)、[Chat API](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)。
