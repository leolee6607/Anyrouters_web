# GPT-6 网页调用修复（2026-09-05）

## 状态

用户已于 2026-09-05 明确要求修好并发布；已完成生产发布及真实请求验收。

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

## 发布验证

1. 已解决 ESLint 依赖冲突：移除跨大版本强制 `brace-expansion: 2.1.1` 的 overrides，让锁文件按调用方范围解析；其余依赖覆盖保留。修改涉及文件的 ESLint 已通过，旧 Next.js 专属禁用注释也已移除。
2. [PR #26](https://github.com/leolee6607/Anyrouters_web/pull/26) 已通过 PR Check 并合入 main：`167496bf`。功能提交 `7c1a1439` 与该合并提交文件树一致。
3. ACR 构建 `cc5` 成功；镜像 `acranyroutersprod.azurecr.io/new-api:gpt6-7c1a1439-20260905`；摘要 `sha256:a8e1119e08ffeb98d0e27d56992f5a459f7fdf64427c61c0ac5801bcebcdd77c`。
4. 新修订 `ca-anyrouters-web--gpt6-7c1a1439` 先 0% 独立地址实测，再 1%，最后 100%；Healthy / Running。旧修订 `ca-anyrouters-web--proxy547b22c` 保留，无正式流量，未删除恢复镜像。
5. 候选地址和正式 `https://anyrouters.com` 均通过 `/pg/chat/completions` 非流式、流式、low/max，携带函数工具及旧 max_tokens/temperature/top_p 均可调用。用户 API 的工具发起、回传、最终答复闭环通过。
6. 正式 API 缓存测试输入 1822、输出 5：第一笔真实缓存写入 1819，扣费 8056 quota（日志 28456）；第二笔流式缓存命中 1819，扣费 735 quota（日志 28457）。与官方配置单价 × 0.7 一致，整数舍入误差不超过 1 内部 quota 单位。没有双收缓存普通输入，也没有新增估算规则。
7. 普通用户 0.7、btob 0.6、b2b_16 0.65、b2b_31 0.4 配置原样保留。测试 Key 均已撤销。
8. Edge 强制刷新后，GPT-6 页已显示“推理”档位控件；真实调用验证针对网页实际请求入口进行，不把历史对话中的旧错误文本当成新请求失败。首页与聊天页面 200，健康接口正常，未授权模型目录 401。

## 边界与恢复

- 本轮覆盖 GPT-6 和相关转换链路，不等于全站所有模型均重新付费验收。
- 若需回退，显式把旧修订恢复为 100% 流量；不回写数据库，不调整上游账号、VM 或折扣。
- 保留既有用量对账观察流程；本轮小额测试不代表长期账单差异已完全消除。

## 环境边界

- AN 网站位于家璇订阅的 `rg-anyrouters-prod / ca-anyrouters-web`。
- GPT-6 位于振川订阅 `rg-foundry / foundry-papercoaches`，AN 渠道 3。
- 本次只发布网站兼容修复，不迁移账号或 VM，不修改其他模型与用户历史账单。
