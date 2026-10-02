# 检查点 2026-10-03 · 本地/自托管 Provider

## 本次变更

实现 `openai-local` 适配器（OpenAI 兼容协议），对应
`docs/architecture/oss-patterns.md` 中"模型可插拔、不被厂商绑定"那条。
用户自跑 Ollama / LM Studio / vLLM / llama.cpp 即可：**无密钥、零 API 费用、
数据不出本机**。

### 新增 / 修改

| 路径 | 作用 |
|---|---|
| `packages/providers/local/openai-compatible.mjs` | 本地适配器 |
| `server/lib/vault.mjs` | 显式 `selfHosted` 登记；`selfHosted` 出现在公开字段里 |
| `server/lib/runner.mjs` | `setAdapterResolver()`，按 credentialRef 动态解析 |
| `server/index.mjs` | 单一 `adapterForCredential()` 入口 |
| `tests/contract/local-provider.test.mjs` | 18 项 |

## 这是唯一允许访问私网地址的例外，所以单独设防

`docs/architecture/security.md` 写明："自托管配置显式登记，私网允许仅该
Provider 可信 baseURL"。实现成：

| 情况 | 结果 |
|---|---|
| `http://127.0.0.1:11434` **未**标记自托管 | **400 拒绝** |
| `http://127.0.0.1:11434` 标记 `selfHosted: true` | 允许 |
| `http://example.com` 带 `selfHosted` | **仍拒绝** |
| `https://198.51.100.7` 带 `selfHosted` | **仍拒绝**（不在自托管集合） |

关键分界：**回环上的明文 http 可以**（流量不出本机），
**公网主机的 http 不行**（密钥会明文过网）。有测试专门钉这一条。

## 诚实声明

- 能力一律 `unverified`，理由写明「本地模型不等同于供应商专有模型」
- 无 cancel / status 轮询，明确返回 `CAPABILITY_UNAVAILABLE`
- 费用记 `estimated / 0 / api_calls`，但**带 source**——
  "本地推理无按次计费"和"费用未知"不是一回事
- 服务未启动时 `validationState=network_error`，
  与 `auth_failed` **严格区分**：前者是没开服务，后者是密钥不对

## 架构调整：适配器按 credential 解析

原先适配器按 providerId 静态注册。本地适配器的 baseURL 因机器而异，
所以改为**每个 credential 解析一次**（`setAdapterResolver`），
凭据可以在进程运行期间增删。新增 Provider 只改 `adapterForCredential` 一处，
页面永远不 import 适配器。

## 验证

```
npx tsc -b --noEmit   exit 0
npx vitest run        exit 0 — 16 files, 306 tests passed
npx vite build        exit 0
```

真实 HTTP 实测：

```
1) 未标记自托管     -> HTTP 400  本机地址需要显式标记为自托管 Provider 才允许使用
2) 标记自托管       -> HTTP 201  selfHosted=True
3) 验证(服务未启动)  -> network_error: 无法连接本地服务：http://127.0.0.1:11434（服务是否已启动？）
```

## 过程中修掉的自身问题

- 补丁一度留下 `adapterFor` / `adaptersByCredential` 死代码与
  未定义的 `adapterForCredential`，导致 28 项测试失败。已收敛为单一入口。
- 改选项名时破坏了既有测试的注入契约（`providerAdapters`），
  已恢复并同时支持按 credential 与按 provider type 两级覆盖。
- Provider 创建的校验错误原先返回 500，已改为 400。

## 未完成

- 本地语音模型（本地 TTS/STT 走同一协议）未接，仅实现对话
- 本地 Provider 尚未接 UI（设置页需加"自托管"开关）
- 未做真实本地服务联调（本机未装 Ollama）
