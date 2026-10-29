# GPT-6.1 Terra 接入

Azure 官方目录与账号模型目录确认 `gpt-6.1-terra`、版本 `2026-10-26` 已可部署。使用现有 foundry-papercoaches 的 GlobalStandard 部署，容量 15000，对应每分钟 1500 万 Token、15000 次请求；沿用 Microsoft.DefaultV2 内容过滤与现有渠道出口。

将 Terra 加入原生 GPT-6 协议识别，Chat 请求通过现有 Responses 适配层处理，保留工具调用和模型身份。支持 none 推理；启用推理时沿用已验证的采样参数清理。

价格配置见 prices.json，采用 OpenAI 公布的标准美元价（每百万 Token）：输入 1、输出 5、缓存读取 0.05、默认缓存写入 1.25。超过 272000 输入 Token 的整次请求按输入及缓存 2 倍、输出 1.5 倍计费。客户组折扣复制同组 GPT-6.1 Sol 当前系数，不改其他模型和历史账单。

上线顺序：先验证 Azure 请求，再发布兼容层镜像，最后补充此模型的费率、目录和现有渠道模型列表。配置操作须比较变更前快照，保留所有其他 JSON 项及渠道字段。运行记录保存在 outputs/20261029-gpt61-terra；凭据不进入源码和记录。

官方来源：[Azure 模型目录](https://ai.azure.com/catalog/models/gpt-6.1-terra)、[OpenAI 能力与价格](https://developers.openai.com/api/docs/models/gpt-6.1-terra)。
