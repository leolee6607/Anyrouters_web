# 2026-09-30 模型、价格与计量发布

初次上线源代码 `ef3158de9`，ACR 构建 `ccb`。最终补丁源代码 `025771f33`；最终镜像 digest 和构建号见 `release-result.md`。

## 发布内容

- Azure `foundry-papercoaches` 原生部署 GPT-6.1 Sol、GPT-6 Sol、GPT-6 Luna，GlobalStandard 容量各 1000，均通过实际 Responses 请求。原有 Astra 容量不变。
- GCP `anyrouters-prod` 使用 Vertex global 的 Gemini 3.8 Flash 托管模型，原生请求已通过，无需独立 VM/Endpoint。
- GPT 新模型采用原生 Responses 兼容层，保持模型身份，校验推理参数，支持 Chat 转 Responses 和函数工具。
- 四份 Codex 安装脚本校验实际选择模型的官方原生元数据；旧客户端不支持时升级或明确停止，不伪造模型能力。官方 CLI 0.159.2 的 debug models 已确认三个新模型均存在。
- 修复流式 EOF 先于缓冲中的终止帧导致正常请求误记 error/eof 的竞态；实际缺失终止帧仍报告异常。Gemini 以 finishReason 和最终 usage 判断终止，支持 usage 单独后续帧，避免等待不存在的 OpenAI DONE 哨兵。

另移除 GPT-5.6 旧的锁定输出倍率，允许官方更新价格覆盖；Sol 当前输出/输入倍率 5，Terra/Luna 为 6，修正公开价格接口与实际公式的一致性。

## 价格与折扣

`prices.json` 是官方基础美元单价，每百万 Token。GPT 长上下文超过 272,000 输入 Token 后，整次请求输入/缓存/写入价格为 2 倍，输出为 1.5 倍。边界 272000/272001、缓存和四个 GPT 分组均有测试。

| 模型 | 官方输入/输出 | default 实付输入/输出 |
|---|---:|---:|
| GPT-6.1 Sol | 2 / 10 | 1.4 / 7 |
| GPT-6 Sol | 2 / 10 | 1.4 / 7 |
| GPT-6 Luna | 0.1 / 0.5 | 0.07 / 0.35 |
| Gemini 3.8 Flash | 0.75 / 3.75 | 0.375 / 1.875 |
| GPT-5.6 Sol | 4 / 20 | 2.8 / 14 |
| GPT-5.6 Terra | 2 / 12 | 1.4 / 8.4 |
| GPT-5.6 Luna / codex-auto-review | 0.2 / 1.2 | 0.14 / 0.84 |
| GPT-6 Astra（未调整） | 10 / 50 | 7 / 35 |

GPT 组系数 default 0.7、btob 0.6、b2b_16 0.65、b2b_31 0.4；Gemini 新模型继承 3.7 对应系数 0.5 / 0.5 / 0.65 / 0.5。不调整历史扣费，不用折扣弥补对账差异。
Gemini 3.8 global 促销价有效至 2026-12-31；官方宣布 2027-01-01 恢复输入 1.5 / 输出 7.5 / 缓存读取 0.15，届时须复核后同步。未提前应用未来价格。

官方来源：[OpenAI 定价](https://developers.openai.com/api/docs/pricing)、[GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol)、[Google 定价](https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing)。Azure 5.6 实际账单 meter 单价也已核对。

## 发布与回退操作

`apply.sql` / `rollback.sql` 为受保护的局部配置变更，锁定渠道 2/3 及费率选项，断言相关 JSON 路径和渠道列表的预期旧值。使用 mysql batch，**禁止 --force**，否则断言失败可能继续执行。发生错误时必须断开以回滚事务。

先部署候选镜像零流量，验证旧模型，再 1% → 100% 切流量，最后执行 apply.sql。价格/渠道缓存约 60 秒刷新后验证公开目录和实际扣费。数据库事务演练已成功并 ROLLBACK。

必要时先执行受保护 rollback.sql 撤掉新模型及价格配置，再切回 `ca-anyrouters-web--metering-5eef3e8e3` 100%。旧镜像 `sha256:7f75a63bd8967ac88b341bf655d0115d4d22e291f028c0c69addbf2ad7e06f32`。不删除已有上游资源或其他渠道。若当前配置已被别人修改，断言失败后重新审查，不强行覆盖。

## 验证

- Go：relay/helper、relay/common、relay/channel/openai、service/openaicompat、pkg/billingexpr 通过。
- Shell 安装 35 项通过；Windows CI powershell.exe 和 pwsh.exe 两组通过（run 36666287038）。
- TypeScript、相关 ESLint/Prettier、安装文档检查通过。
- setting/ratio_setting 与 Gemini 终止帧回归通过，覆盖 usage 独立末帧及实际截断 EOF；旧预扣费路径 float 截断可相差 1 quota，仅为临时预留，最终结算通过精确公式验证。
- 正式域名 26 项请求均 HTTP 200，响应 Token 与站点消费日志一致，26 条扣费与新费率、分组折扣精确匹配。
- 候选版本现有 Luna/Astra 8 次实际调用通过，Responses/Chat/stream/tool 均 HTTP 200，8 条扣费精确匹配，流式终止为 done。
- Luna/Terra 5.6 的 Chat 函数工具请求按官方限制使用 reasoning_effort=none；其 low+tool 返回 400 属已知官方能力限制，不作为代理故障。

最终流量、生产新模型验证及 Notion 留痕见 `release-result.md`。

## 计量复查

窗口为 UTC 2026-09-24 至 2026-09-28（不含），9 月 30 日取成熟账单。Luna（合并 codex-auto-review）和 Terra 每日 Token 均与实际账单精确一致。Azure 监控漏掉 Luna 长上下文 meter，不能只拿监控总数判断计费错误。

Sol 与 Astra 上游 HTTP 200 请求数量多于站点成功消费；旧 Microsoft 工单已于 8/7 关闭，不能作为本窗口证据。9/30 后续内部核算已将历史费率、折扣与用量分类分开：五类 GPT 共 3,521 笔成功扣费精确复现，同价口径剩余 Sol 12.666695 USD、Astra 1.0200385 USD。按用户最新指示，不联系官方。详见[内部核算](../internal-cost-reconciliation-20260930/README.md)；**不宣称历史每笔失败成本均已重建**。本次 EOF 修复解决日志结束状态，不证明消除 Token 差额。
