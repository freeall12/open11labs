# open11labs — ElevenLabs 创作工具的 BYOK 本地复刻

> 本仓库**不隶属于 ElevenLabs**，未复制其服务凭证、私有接口、专有字体或商标资产。
> 模型推理仍需网络与用户自己的供应商账户；**没有任何专有模型被离线本地化**。

对 `elevenlabs.io/app` 下**创作工具**的纯源码复刻，外加一套开源、自带密钥（BYOK）、
本地运行的编排与存储层。**原站全部营销与账号相关内容已明确排除**：不做登录/注册/SSO、
头像/个人资料、云工作区/成员/角色、订阅/付费墙/账单/积分、收益分成、市场曲目、
商业授权申请、公开发布/分享、原站开发者与用量门户。保留创作工具与本地 BYOK 必需配置。

当前状态与交接见 [AGENTS.md](AGENTS.md)、[文档入口](docs/README.md)、
[范围裁剪](specs/SCOPE.md)。实施启动提示词见 [GOAL_PROMPT.md](GOAL_PROMPT.md)，
多 Agent 分区见 [COLLABORATION.md](docs/engineering/COLLABORATION.md)。

---

## 运行

### 依赖

Node **≥ 22**（本机实测 v26.7.0 使用 `node:sqlite`）。npm ≥ 10。

### 开发（两进程）

```bash
npm install

# 终端 1：本地 BYOK 服务端（loopback only）
node server/cli.mjs --port 5174 --data ./data

# 终端 2：前端
npm run dev          # http://localhost:5173
```

> **必须显式指定 `--port 5174`**：Vite 开发代理默认把 `/api` 转发到
> `http://127.0.0.1:5174`，而 `server/cli.mjs` 不带参数时默认监听 **5173**。
> 想换端口就设 `EL_API_TARGET=http://127.0.0.1:<port>` 启动 Vite。
> **只跑 `npm run dev` 会得到一个所有 API 调用都失败的界面。**

### 生产（单进程同源）

```bash
npm start            # = npm run build && node server/cli.mjs
```

静态产物与 API 同源，默认 <http://127.0.0.1:5173>。服务端**只绑定回环地址**，
没有 `--host` 开关——把密钥金库暴露到局域网是本版本明确不做的事。

### 校验

```bash
npm run typecheck    # tsc -b --noEmit
npm test             # vitest run
npm run build
```

`npm test` 的**当前真实状态见 [交接检查点](docs/engineering/handoffs/2026-10-03-release-gate.md)**：
331 个用例全部通过，但进程退出码为 **1**（12 个未处理 rejection，来自组件测试里的
相对路径 fetch）。用例通过 ≠ 命令可用，这条不能含糊。

---

## 架构

```
浏览器 ──同源──> 本地服务端（loopback）
                   ├── vault.mjs      write-only 密钥金库（save-only，永不回显）
                   ├── jobs.mjs       持久任务队列（intentId 去重、崩溃安全状态机）
                   ├── cost.mjs       成本账本（未知就写 unknown，不写 0）
                   ├── assets.mjs     内容寻址素材库（从字节嗅探容器，不信客户端 MIME）
                   ├── media.mjs      纯代码媒体分析（零 Provider 可用）
                   ├── safe-fetch.mjs SSRF 防护（逐跳复验、私网/link-local 拒绝）
                   └── ytdlp.mjs      yt-dlp 音频提取（数组传参，shell:false）
                         │
                         └──> 用户自己的 Provider（ElevenLabs / OpenAI 兼容 / 自托管）
```

密钥只在派发瞬间从金库解析，**绝不写入任务快照**。生产静态资源与 API 同源；
Host/Origin/CSRF/会话校验不因为是 localhost 而省略。

### 能力三态与费用

能力一律标 `available` / `unavailable` / `unverified`。**未观察到的能力不得当作支持，
未知的费用不得显示为 0。** 每个 Provider 适配器都返回带 `reason` 的能力项，
成本以 `character-cost` 计量但不换算金额，除非有可核验的价格。

---

## 美术资源来源

| 资源 | 来源 | 许可 |
|---|---|---|
| 图标几何 `src/lib/icons.tsx` | 从参考站渲染 UI 追踪 | **再分发状态未确认（D3，阻塞发布）** |
| 字体 `public/fonts/Outfit-*.woff2` | Google Fonts Outfit | SIL OFL 1.1，见 `OFL-Outfit.txt` |

原站专有的 **Waldenburg 字体已删除**，替换为度量相近的 OFL Outfit，
字形偏差登记在 [`public/fonts/README.md`](public/fonts/README.md)。
公开仓库不得携带不可再分发的专有字体。

图标由 `tools/build-icons.mjs` 从 bundle 提取几何后生成，`src/lib/icons.tsx` 是生成文件：

```bash
node tools/fetch-bundles.mjs   # 下载图标库 bundle（已 gitignore，不入库）
node tools/build-icons.mjs     # 重新生成 src/lib/icons.tsx
node tools/icon-sheet.mjs tools/icons-bundle.js /tmp/sheet.html PlusIcon MicIcon
```

---

## 已知边界（尚未还原 / 未验证）

- **M1-T07 真实 BYOK 链路未验证**：项目发起者未提供测试密钥与预算授权，
  因此能力矩阵保持全 `unverified`，首条真实端到端链路（设钥匙→验证→TTS→提交→
  播放→下载→历史→重启恢复）**没有实测证据**。
- **聊天页未做浏览器端到端验证**：按发起者决定只保留自动化测试证据。
- **逐控件视觉精确验收未完成**：`research/` 下的截图语料含账号标识，保持私有、
  不随仓库分发；像素级比对需在受控环境内另行执行。
- **图标授权未清**：见上表与 `docs/DECISIONS.md` D3。
- m4a/ogg/flac 的时长解析**未实现**，返回 `null` 并说明未做猜测；压缩格式不做波形。

---

## 许可

自有代码 [MIT](LICENSE)。第三方资产按各自条款单列，**不并入 MIT**。
本项目与 ElevenLabs 无隶属或背书关系。
