# 发布验收（2026-10-02）

已上线，正式版本 `ca-anyrouters-web--params-cd57e8b2b` 100% 流量，Healthy / Running。UTC 13:16:43（北京时间 21:16:43）正式调用验证完成。

- 运行源码：`cd57e8b2b1406da72970b6ab14e62269d64eacb8`。
- ACR 构建：`cce`，成功，用时 6m11s。
- 镜像：`acranyroutersprod.azurecr.io/new-api@sha256:fdce2f40a299a285771361f34728dff27b0429c535faaca6c19d9d8977a63790`。
- 后续提交仅测试夹具和文档；运行代码与发布镜像一致。
- 零流量候选 28/28、正式域名 28/28 符合预期；每轮 23 次正常调用成功，23/23 响应用量与日志、23/23 扣费与当前价格及 default 折扣精确一致。
- 每轮五次无效请求返回明确 400：预算不可等价映射、思考开关冲突、Astra 不支持 none、Responses 预算错误、Gemini image 错误端点。五次均未扣费。
- GPT-5.6 Sol/Terra/Luna、GPT-6 Sol/Luna/Astra、GPT-6.1 Sol 的 Chat/Responses 参数组合通过；Luna/Sol 思考开关与流式通过；Luna/Terra/6.1 Sol 推理工具调用通过；Gemini 3.8 与 codex-auto-review 对照正常。
- 两轮临时测试令牌均已撤销。流式日志均为 ok/done。
- 四份线上安装脚本 SHA-256 与源文件一致，八个模型公开价格和 default 折扣保持一致，Astra 仍输入 10 / 输出 50 美元每百万 token。
- 发布采用零流量 → 1% → 100%；配置/运行模板断言确认除镜像、版本、流量外均与发布前相同。错误审计保持开启。没有数据库迁移或价格、额度、历史消费变更。

## 交接

[PR 34](https://github.com/leolee6607/Anyrouters_web/pull/34)
[Notion 交接](https://www.notion.so/3ed680dd2e7e8165a8c4dcda2af0186f)
[验证摘要](./verification.json)

本地私有证据：`Anyrouters项目总/outputs/20261002-parameter-compat-release`。公开摘要只含人工构造的验证案例，没有客户身份、请求原文或凭据。

错误审计同时存在单次上游 500、客户端中断和先前故障注入测试记录；不把这些记录混同于本次重复的参数错误，也不声称所有历史上游异常已经消失。客户原始 thinking 内容未留存，服务端已验证无歧义别名自动兼容；若客户端设置的是精确预算，仍需按明确提示改用官方 effort 参数，不能保证任意自定义请求自动成功。

## 回退

将 `ca-anyrouters-web--audit-errors-20260930` 设为 100% 流量即可退回发布前应用；不回滚账单或费率。保留旧版本和私有配置快照，不删除已有上游模型部署。
