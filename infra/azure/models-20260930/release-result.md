# 发布结果（2026-09-30）

已上线并通过最终验收。最终版本 100% 正式流量，Healthy / Running，2026-09-30 04:37 UTC 完成线上调用验证。

- 最终源代码：025771f3399e4a9b2ccb012b402e343634c9207d。
- ACR：构建 ccd 成功，用时 6m2s。
- 镜像：acranyroutersprod.azurecr.io/new-api@sha256:ddcf307081e515e80d01fc89529e98ef011632768f7d7dcf87a7ee3dfb420550。
- 目标版本：ca-anyrouters-web--models-025771f33。
- 发布前版本：ca-anyrouters-web--metering-5eef3e8e3。
- 首轮上线版本：ca-anyrouters-web--models-ef3158de9（已启用新模型、费率与安装兼容；最终补丁补充 Sol 倍率展示及 Gemini 正常终止）。
- 配置迁移：apply.sql 事务演练先 ROLLBACK，正式执行 MIGRATION_COMMITTED，2026-09-30 04:09:11 UTC。
- 范围校验：无关费率 JSON 路径保持一致；旧渠道模型保留；其他渠道字段不变；部署模板、环境变量和流量以外配置不变。
- 候选首轮：8 项实际请求全部通过，扣费精确一致。
- 首轮生产：26 项请求全部 HTTP 200，usage 与消费日志一致，26 条扣费符合最新价格及分组折扣。
- 安装脚本：线上四份文件哈希与发布源文件一致；Shell 测试通过，Windows PowerShell / pwsh CI 通过。
- 原生 Codex 模型目录：CLI 0.159.2 确认三个 GPT 新模型，未覆盖操作者个人安装与配置。

## 最终验收

- 最终候选版本 Sol / Gemini 共 6 项请求通过，Gemini 正常结束日志为 ok/done。
- 最终正式域名 26/26 请求 HTTP 200，26/26 响应 Token 与消费记录一致，26/26 扣费符合官方新价格与客户分组折扣；7 个流式案例均为 ok/done。
- 公开价格接口中 8 个受影响模型的输入、输出、缓存读取、缓存写入及 default 折扣全部匹配费率清单；数据库其他三个客户分组也已核对。
- 四份安装脚本上线文件哈希与源文件一致。最终代码 Windows CI 两组通过（run 36668628966），Go 补丁回归通过。
- 模型部署采用 Azure GlobalStandard，GCP 使用托管 global publisher model；没有创建付费预置吞吐承诺。

## 交接

[GitHub PR 31](https://github.com/leolee6607/Anyrouters_web/pull/31)
[Notion 发布记录](https://www.notion.so/3eb680dd2e7e8138a5acee58350a28cc)
[Notion 计量待闭合记录](https://www.notion.so/3eb680dd2e7e817390a7e6bb829792a1)

本地完整证据：Anyrouters项目总/outputs/20260930-model-rollout、20260930-metering-review、20260930-price-review。临时测试令牌随测试退出撤销，未上传凭据或用户提示词。

Sol/Astra 历史汇总差额仍待上游请求级证据。Azure diagnostic-settings 为空，不能回溯不存在的诊断导出。未回写历史消费、未追补扣费。
