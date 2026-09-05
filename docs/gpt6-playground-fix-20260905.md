# GPT-6 网页调用修复（2026-09-05）

## 状态

修复分支 `fix/gpt6-playground`。用户已于 2026-09-05 明确要求修好并发布；生产验收结果另行追加，不把本地验证等同于线上验收。

## 原因与变更

- 已复现生产 `/pg/chat/completions` 的工具与 reasoning_effort 不兼容错误；旧 max_tokens 参数也会被上游拒绝。
- 现有 Chat → Responses 规则未涵盖 gpt-6-astra；现在原生 OpenAI/Azure 渠道对该精确模型自动使用已有 Responses 桥接。保留 passthrough 的原有行为，不扩大其他模型路由。
- Astra 转换时去除不支持的采样参数，复用 max_tokens → max_output_tokens 映射；明确拒绝 none/minimal，不通过关闭推理掩盖错误。
- 网页识别 Astra，快速档映射 low，增加 max 档与六语言翻译。切回旧模型时 max 安全映射到旧档位。
- 修正非流式 Responses → Chat 转换遗漏缓存写入用量，以及文字与工具调用并存时丢失工具调用的问题。
- 不修改价格表达式、分组折扣、Azure 配额或出口 VM。

## 已完成本地验证

- `go test ./...` 全量测试通过。
- Astra 请求参数、工具下一轮回传、文本与工具并存、缓存用量保留等专项测试通过。
- 网页档位与请求构造 7 项测试通过。
- TypeScript 类型检查通过；default 与 classic 两个前端生产构建通过。
- 独立计费验证通过：普通计费、缓存不双算、272000/272001 分界、缓存长上下文。

## 发布前未完成

1. 已解决 ESLint 依赖冲突：移除跨大版本强制 `brace-expansion: 2.1.1` 的 overrides，让锁文件按调用方范围解析；其余依赖覆盖保留。修改涉及文件的 ESLint 已通过，旧 Next.js 专属禁用注释也已移除。
2. 已获发布确认；构建镜像并验证候选版本，不覆盖或删除旧生产版本。
3. 实测新版本 `/pg/chat/completions` 普通、流式、工具完整往返与 low/max，核验真实用量及扣费；最后在 Edge 确认档位显示和网页回复。
4. 验收后再更新 Git/Notion 为“生产已完成”。

## 环境边界

- AN 网站位于家璇订阅的 `rg-anyrouters-prod / ca-anyrouters-web`。
- GPT-6 位于振川订阅 `rg-foundry / foundry-papercoaches`，AN 渠道 3。
- 本次只发布网站兼容修复，不迁移账号或 VM，不修改其他模型与用户历史账单。
