# Codex CLI 自动兼容升级（2026-09-07）

## 用户确认及边界

Mac mini 上阻止共享配置写入的是旧 Codex CLI。用户手动更新 CLI 后，配置写入
成功，桌面版也可使用。本次只补 CLI 自动安装/升级，不重装、替换或退出桌面应用。
此前探索的桌面 DMG 自动替换代码已经移除，没有发布，也没有改真实应用。

桌面与 CLI 可以读取默认共享配置，但各自运行时仍需兼容；共享配置不意味着更新
CLI 能升级桌面内置程序。不修改计费、API Key 权限、渠道、VM 或数据库。

## 实现

- 官网桌面配置入口 `codex-config.sh` 优先检查 CLI 的真实模型/工具元数据。
- 已兼容：不安装、不追逐版本号。缺失或不兼容：使用官方 CLI 安装器更新。
- 更新后再次校验，选择兼容的新 CLI；不会把安装器退出码 0 当作升级完成。
- 然后继续原有配置备份和写入，不要求用户手动重复命令。
- 安装器失败且 npm 可用时沿用已有 npm 兜底路径；最终仍不兼容则保留原配置。
- 官方安装器可能添加 CLI PATH 设置；调用官方/npm 安装器时不传递 AN Key 环境变量。
- 已安装桌面运行时另外检查；不兼容只提示手动更新，不自动替换应用。
- 终端入口 `codex.sh` 同步加强升级后校验及路径选择。
- 六语言教程明确升级的是 CLI，而非桌面应用。Windows 脚本本次未修改。

官方依据：[Codex CLI 安装及更新](https://learn.chatgpt.com/docs/codex/cli)。

## 验证

新增旧 CLI → 自动升级 → 写入 GPT-6 共享配置测试：修改前退出 1，修改后通过。
另有兼容 CLI 跳过、升级无效只尝试一次且保留 config/auth 的回归测试。
测试使用隔离 HOME、假 CLI/Key/官方安装器，不调用真实付费模型。

最终本地结果：43 通过、7 个 PowerShell 执行测试跳过、0 失败；TypeScript、
修改页面 ESLint、格式检查、Default 构建、Go router 测试及 shell 语法通过。
没有把已撤销桌面更新器的测试结果计入本次 CLI 改动。

命令：

```sh
cd web/default
bun test tests/codex-gpt56-catalog-compat.test.ts tests/docs-codex-install-guidance.test.ts tests/codex-ci-coverage.test.ts
bun run typecheck
bunx eslint src/features/docs/index.tsx
bun run build
```

Windows 执行测试需在已有 PR #27 的两种 Windows CI 上重跑；不能把本机跳过当作通过。
Mac mini 的人工升级和基本使用已获用户确认；本次自动升级流程为模拟回归验证。
长会话 compact/其他工具仍需分别实测，不据此宣布全部端到端兼容。

## 发布状态与待确认计划

### Mac mini 用户回测补充

用户确认 v4 安装可用；CLI 已人工更新，因此不能视作旧 CLI 自动升级真机验收。
原测试包精确恢复因配置后续有修改而停止；用户已验证终端“备份当前配置 →
移走 config/测试包 active.json/私有 Key → logout/login”可切回官方。
官网已有独立的 codex-official 脚本，不是测试包的精确恢复，继续保留。
教程最后新增 Mac 折叠备用重置命令，明确停用模型/MCP/权限配置、保留历史，
备份含凭据、不会降级 CLI。官网安装者先走原官方切换以清理持久环境变量。
Windows 原恢复路径不改。本次不把私有测试包配置写入器替换进官网。
补充后的本地验证：45 通过、7 个 Windows 执行测试跳过、0 失败；
typecheck、修改页面 ESLint、六语言 JSON 格式检查及 Default 构建通过。
备用重置命令在隔离 HOME 中实际执行，验证修改后配置的备份、AN 记录移走、
历史保留、凭据环境隔离及 logout → login 顺序；没有操作真实登录。

本地候选，未推送本次改动、未合并、未发布。沿用 PR #27 的
`test/codex-gpt6-cross-platform` 分支，不覆盖另一个有用户修改的工作区。
版本名称 `codexcli-20260907`，实际发布再固定合并提交 SHA 和镜像 digest。

AN 当前核对为家璇订阅 `d5ac7f26-916f-4bcb-920b-7b32386fe42b` 的
`rg-anyrouters-prod / ca-anyrouters-web`，Multiple 模式；
`ca-anyrouters-web--gpt6-7c1a1439` 承接 100%。

需用户临近确认后：

1. `git push origin HEAD:test/codex-gpt6-cross-platform`，更新现有 PR #27。
2. `gh pr ready 27`，`gh pr checks 27 --watch`，全部通过后按批准的 head SHA 合并。
3. 用现有 Dockerfile 执行 `az acr build`，在 `acranyroutersprod` 构建
   `new-api:codexcli-20260907-<merge-sha8>` 并记录 digest。
4. 用 `az containerapp revision copy` 创建新 digest 的 0% 候选修订；旧版保持 100%。
5. 健康、教程、脚本内容验证后，用 `az containerapp ingress traffic set`
   按 1% → 100% 放量，保留旧修订。

会更新官网公共脚本和教程，含 PR #27 原有 GPT-6 兼容检测/教程；有 ACR 构建及
短时候选实例成本。不变更价格、折扣、模型部署、出口或账号。正式执行前重新核对
生产版本；任一步失败停止并保留现场，不擅自回滚生产。
