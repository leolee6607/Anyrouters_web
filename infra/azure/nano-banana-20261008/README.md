# Nano Banana 2.1 上架（2026-10-08）

用户要求：核实 `gemini-nano-banana-2.1`，如果官方已发布且现有上游可用，就上架网站，并保证计费、兼容和维护记录完整。

## 验收要求

- 使用真实型号 `gemini-nano-banana-2.1`，Google 2026-10-06 GA；Vertex `anyrouters-prod` 的 global 托管模型已真实出图，不购买预置吞吐、不替换成旧版别名。
- OpenAI Chat 和原生 Gemini API 都能调用；网页识别为图片模型，支持 1K/2K/4K、图生图和流式，单次一张最终图片。聊天格式省略 Google 返回的 thought 草稿图；原生响应保留完整结构。
- 新模型不支持 temperature/topP/topK/seed/logprobs、thinkingBudget、0.5K、多候选。用户显式提交时返回 400；网页不自动注入这些不兼容的参数。thinkingLevel 支持 minimal/medium/high。
- 使用现有表达式计费引擎，按真实输入、缓存、文本/思考输出、图片输出分别计费；不按固定张数估价，不对图片 token 重复收费，不影响旧模型。
- `prices.json` 保存官方价格和从现有 Gemini 图片模型继承的四个分组折扣。官方最新模型概览与价格说明均列出 4K 为 3780 image tokens；生产 4K 实测同为 3780，以 upstream usage 中的实际 image tokens 结算。
- Google 返回 IMAGE_RECITATION 时，原生 HTTP 200 中明确标记不收费，代理转换为明确错误并交由已有失败链全额退回预扣，避免空结果收费。
- 生产验证要对照响应 usage、消费日志、令牌扣费；错误请求无扣费。新模型开放前先验证旧模型；保留旧镜像和受保护配置回退，不修改历史消费。

## 发布步骤

1. 运行 Go、前端类型/规则/构建检查；核对官方说明和上游真实请求。
2. 审查本分支相对 `23778ffb5016bb8cc035f05fbfa54c68e1f7d8eb` 的变更。
3. 从固定提交构建镜像，创建零流量候选并验证现有 GPT/Gemini；按既有流程 1% → 100%，保留发布前 `ca-anyrouters-web--safety-36f364b95`。
4. 用 `generate_migration.py` 从无凭据实时快照生成 `apply.sql`/`rollback.sql`；先事务演练 ROLLBACK，再正式执行。MySQL batch 禁止 --force；JSON 路径断言、渠道旧值和新记录不存在断言不匹配时停止。
5. 等待选项/渠道缓存刷新，验证目录、1K/2K/4K、编辑、流式与扣费、退款；撤销临时测试令牌。
6. 记录实测结果、运行提交和镜像；GitHub、Notion 交接。

## 回退

先执行经重新核对的受保护 `rollback.sql` 撤回新模型配置，再将发布前版本恢复 100% 流量。并发配置修改会使断言失败，禁止覆盖。保留测试日志和历史消费，不删除上游资源。

## 官方来源

- https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/nano-banana-2-1
- https://ai.google.dev/gemini-api/docs/models/gemini-nano-banana-2.1
- https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing
- https://ai.google.dev/gemini-api/docs/pricing

## 调用示例

Ryan 账号对应 `anyrouters-prod`，交接记录与本次上游请求的项目一致。Vertex 使用项目服务账号或具备对应权限的 OAuth access token，不是将邮箱用作 API Key。

站点 OpenAI Chat（`ANYROUTERS_API_KEY` 为用户自己的 Key）：

```bash
curl https://api.anyrouters.com/v1/chat/completions \
  -H "Authorization: Bearer $ANYROUTERS_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"model":"gemini-nano-banana-2.1","messages":[{"role":"user","content":"Create an original gouache illustration of a tiny teal robot watering orange flowers on a curved wooden balcony."}],"reasoning_effort":"minimal","extra_body":{"google":{"image_config":{"image_size":"1K","aspect_ratio":"1:1"}}}}'
```

Vertex 原生：

```bash
curl 'https://aiplatform.googleapis.com/v1/projects/anyrouters-prod/locations/global/publishers/google/models/gemini-nano-banana-2.1:generateContent' \
  -H "Authorization: Bearer $GOOGLE_ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"contents":[{"role":"user","parts":[{"text":"Create an original gouache illustration of a tiny teal robot watering orange flowers on a curved wooden balcony."}]}],"generationConfig":{"responseModalities":["TEXT","IMAGE"],"imageConfig":{"imageSize":"1K","aspectRatio":"1:1"},"thinkingConfig":{"thinkingLevel":"minimal"}}}'
```

不要继承旧版的 sampling 参数或设置多个候选。Chat 输出图片为 Markdown data URI；Gemini 原生输出为 `inlineData`，原生客户端只展示非 `thought` 的最终图片。

## 最终发布结果

后端生产实测四种成功场景和五种参数拒绝场景；响应 usage、消费日志、令牌余额一致，累计测试 quota 58461，临时测试令牌已禁用并设置过期。模型目录修正随 `479fe519c` 月度消费版本发布：默认分组为 0.5x，详情上下文 131072、最大输出 32768，未证实的数据隐私字段留空。线上实际界面核对通过；32 个现有模型定价、分组与端点配置保持一致。

运行镜像和发布交接见 [用户月度消费发布记录](../user-monthly-20261008/README.md)。本次记录区分后端实测版本与最终界面发布版本，后者没有再次改变模型计费或请求转换。

留痕：[PR #36](https://github.com/leolee6607/Anyrouters_web/pull/36)；[Notion 上架记录](https://app.notion.com/p/3f3680dd2e7e819992d4fb7bc0d65bf8)。
