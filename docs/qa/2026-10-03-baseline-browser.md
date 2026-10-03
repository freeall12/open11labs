# 基线浏览器验收报告（HEAD 提交态）

- 日期：2026-10-03（测试执行于本机时间 02:33–03:05）
- 测试人：QA 子智能体 A（ZCode 委派）
- 被测对象：worktree `/Volumes/YANG/11-worktrees/qa`，分支 `zcode/qa`，HEAD `7ed2f05`（feat: 本地/自托管 Provider(OpenAI 兼容协议)）
- 结论速览：**2 个 P1 缺陷、3 个 P2 缺陷、2 个 P3 缺陷、1 个台账不一致；无阻塞级问题；全部 35 条 in-scope 路由可达且无白屏、无 console 错误；11 条 excluded 路由全部正确跳转；持久化与密钥 memory-only 行为符合设计。**
- 测试方式声明：本报告所有"实测"均只打本机 `127.0.0.1` 服务；外部模型调用一律未测（需用户密钥+预算，见 D7/未覆盖项）。未使用任何真实 API 密钥。

## 1. 构建与测试台账核对

| 项 | 命令 | 退出码 | 结果 |
|---|---|---|---|
| 构建 | `npm run build` | 0 | tsc -b 通过；vite 产物 395.97 kB (gzip 116.73 kB) |
| 测试 | `npm test` (vitest run) | 0 | **17 个文件 / 306 条全部通过**（执行于 02:38，仅含 HEAD 已提交用例） |
| 台账 | GOAL.md 称"基线 331 项通过" | — | **不一致**：仓库内不存在 GOAL.md（只有 GOAL_PROMPT.md），`grep -rn "331" --include="*.md"` 全仓库无出处。306 为 HEAD 实测值 |

⚠️ 注意：测试执行期间（02:49–02:58）worktree 内 `tests/qa/` 目录被**另一个并发 agent 持续写入**新测试文件（api-breadth / local-provider-branches / page-tts / page-voice-tools）。本轮 306 条结果不含这些未提交文件；同时证明该 worktree 存在第二个 writer，违反"共享 cwd 同时只允许一个 writer"约定，需协调人仲裁（见 §7）。

## 2. 服务与浏览器环境

- 服务：`node server/cli.mjs --port 5188 --root dist --data data-qa`（data-qa 为全新目录），启动日志确认 `vault: memory only (restart clears keys)`。`curl -sI` 返回 200。
- 浏览器：ego lite（ego-browser 0.5.1.13，Chromium 152），按用户默认指令优先使用；未回退。
- 视口：CDP `Emulation.setDeviceMetricsOverride` 强制 **1500×759 @ DPR 1**（D4 提案基准），截图尺寸一致。
- Console 采集：`window.onerror` + `unhandledrejection` + `console.error` 钩子随 SPA 会话全程采集，**所有路由 0 错误**。

## 3. 逐页验收表（35 条 in-scope 路由）

图例：✅通过 · 🟡缺口（有真实 UI 但不达验收点）· ⬜占位页（ScopeNotice，未实现功能 UI）· 🔒实测受限于 mock

### 3.1 有真实功能 UI 的页面（10 条路由 + 首页）

| 路由 | 验收点 | 结果 | 证据 / 观察 |
|---|---|---|---|
| `/app/home` | 渲染、工具入口、最近列表 | 🟡 | `home.png`：提示输入框、8 个工具入口、最近/快速入门 Tab 均渲染正常。**缺陷 G-01**：最近列表为硬编码假数据（`src/data/recents.ts` 自注 "Placeholder rows"），非真实本地任务历史，违反 SCOPE"最近本地项目/真实历史" |
| `/app/speech-synthesis/text-to-speech` (tts) | 空态门禁、表单、提交链路 | 🟡 | `tts.png`：无 provider 时生成按钮禁用且显示原因"尚未配置 Provider"，字符计数（7/10000）实时正确；Tab 焦点可见（focus-ring）。**缺陷 D-01/D-02/D-03**，详见 §5；mock 链路详见 §6 |
| `/app/speech-synthesis/speech-to-speech` (sts) | 上传校验、门禁 | ✅ | `sts.png`；上传非音频文件得到明确拒绝："已跳过：fake-audio.txt（非音频）"，队列保持为空（`sts-nonaudio-upload2.png`）。文案出现未渲染的 `**未经 API 验证**` 星号 → 记 P3 D-UI-06 |
| `/app/voice-isolator` (isolator) | 空态、门禁 | ✅ | `isolator.png`：500MB 限制标注"未经 API 验证"、费用未知披露、开始分离禁用+原因。同样有裸 `**不是**` 星号（D-UI-06） |
| `/app/dubbing` (dubbing) | 空态、门禁 | ✅ | `dubbing.png`：两步流程说明、provider 门禁、去设置链接 |
| `/app/sound-effects` (sfx) | 预设交互、门禁 | ✅ | `sfx.png`；点击"木门吱呀"预设仅填充描述不自动提交（`sfx-preset-filled.png`，符合文案承诺），生成按钮禁用+原因 |
| `/app/image-video` (+`?modality=video`) | 模式切换 | ✅ | `image-video.png`/`video-mode.png`：图像/视频/口型同步三个 Tab 可切换，模型下拉（Seedream 等）、费用未知披露、门禁齐全 |
| `/app/files` (素材) | 空态、上传/新建控件 | ✅ | `files.png`：空态"素材库为空。生成的产物会自动存在在这里"、上传(0)/新建文件夹/视图切换、单用户本地说明 |
| `/local/settings/providers` | 表单、验证、删除/轮换 | 🟡 | `local-provider-settings.png`：密钥只写不回显（maskedSecret `qa-m••••••-key`）、错误提示带原因。**缺陷 D-04**：无法通过 UI 登记自托管地址（§5） |
| `/local/settings/storage` | 空态 | ✅ | `local-storage-settings.png`：已存素材 0 个/0 B |
| `/local/jobs` | 空态→有任务、费用账本 | ✅ | `local-jobs.png`（空态）→ `local-jobs-with-task.png`（重启后仍显示 text_to_speech 成功记录）；本地预算说明准确（"不控制供应商账户侧花费"） |

### 3.2 ScopeNotice 占位页（24 条路由，均为 `PageFrame`+`ScopeNotice`，仅显示路由元数据卡片）

以下路由**渲染正常、无白屏、无 console 错误**，但没有任何功能控件（buttons=2 仅侧栏开关），截图均为占位卡片（`<route-id>.png`）：

`/app/voice-library`(voices-explore)、`/app/voice-library?action=create`(voice-create-query)、`/app/create-voice`、`/app/voice-lab`、`/app/voice-library/collections/:id`、`/app/speech-to-text`(stt)、`/app/speech-to-text/speakers`、`/app/audio-detector`、`/app/sound-effects/history`、`/app/sound-effects/favorites`、`/app/music`（含"本地化调整：移除市场/营销"说明行）、`/app/music/history`、`/app/music/saved`、`/app/music/finetunes`、`/app/image-video/history`、`/app/studio`、`/app/studio/templates`、`/app/flows`、`/app/flows/:id`、`/app/creative-agent`(chat)、`/app/creative-agent/chats/:id`、`/app/audiobooks`、`/app/files/brand-kits`。

说明：任务简报预判 Studio/Flows/聊天/音乐/音色库为"minimax 在途未提交页面"，实测 **HEAD 7ed2f05 已包含这些路由的注册与占位组件**（`src/app/router.tsx` PAGES 全量注册），只是功能 UI 未实现。本轮按简报要求不判失败，但计入完成度：**35 条路由中 11 条有真实 UI，24 条为占位（69%）**。

### 3.3 特殊路由

| 路由 | 结果 | 证据 |
|---|---|---|
| `/app/out-of-scope` | ✅ | `excluded-out-of-scope.png`："已移除 已按范围裁剪 该页面不包含在本地版本中" |
| 未知路由（`/app/definitely-not-a-route`） | ✅ | 本地 404："找不到这个页面" |
| 深链接（服务端 history fallback） | ✅ | 35 条路径 `curl` 全部 200 且直接 `goto` 可渲染 |

## 4. excluded 路由验证（11 条，全部通过）

`/app/iconic-voices`、`/app/voices-earnings/payouts`、`/app/voices-earnings/analytics`、`/app/voices-earnings/library-gaps`、`/app/music/published`、`/app/settings`、`/app/workspace`、`/app/subscription`、`/app/payouts`、`/app/developers`、`/app/developers/analytics/usage` — 逐一客户端访问，**全部 replace 跳转 `/app/out-of-scope`**，页面无任何登录/头像/订阅/升级类控件（自动扫描 hasAccountUI=false），符合 SCOPE.md"本地 404 或统一明确跳转"。

## 5. 缺陷与缺口清单

### P1（主流程不可用/语义错误）

**D-01 TTS 提交后任务永远停留在 draft（页面缺 `/run` 调用）**
- 复现：注册可用 provider → TTS 页输入文本+音色+勾选费用确认 → 点击"生成语音" → 任务面板显示"任务 draft"，轮询 8s+ 无变化。
- 根因：`src/features/voice/TtsPage.tsx` `generate()` 只调 `jobsApi.create`，从不调 `jobsApi.run`（STS/SFX/Dubbing/Isolator/YouTube 转写页都调了，仅 TTS 遗漏）；服务端 `POST /api/v1/jobs` 只落库不执行，执行需显式 `POST /jobs/:id/run`。
- 证据：`tts-job-stuck-draft.png`；job `dbb7e86e` 在 GET /api/v1/jobs 中 `status:"draft"`；mock 日志 8s 内无任何请求。

**D-02 本地 Provider 的 TTS dispatch 语义错误：聊天端点冒充 TTS 成功（错误形状的成功）**
- 复现：对 D-01 卡住的 job 手动 `POST /jobs/:id/run`（带会话+CSRF+Origin）→ 返回 `status:"succeeded"`，产物为 15 字节 `reply.txt`（内容 "mock-chat-reply"）。
- 根因：runner `text_to_speech` 分支调 `adapter.submit({key, voiceId, text,...})`，而 `packages/providers/local/openai-compatible.mjs` 的 `submit` 是**聊天补全**（`/v1/chat/completions`），text/voiceId/outputFormat 全部被丢弃；mock 日志证实 `/v1/audio/speech` 从未被应用调用（仅出现我自测的一次）。本地适配器未实现 submitStt/submitSfx/submitIsolation/submitSts/submitDubbing/submitAsync，其余任务类型会以 `TypeError` 归类为 INTERNAL 失败。
- 影响：TTS 任务以 text/plain 产物"成功"，UI 还会用 `<audio>` 播放该 txt（`tts-e2e-final.png` 显示"下载 reply.txt"）。违反"对每个控件提供可观察结果/不支持要给中性原因"的验收线。
- 证据：`out/qa/mock-requests.log`（应用侧仅命中 `/v1/chat/completions`，body `{"model":"local","temperature":0.7,"stream":false}`）；资产 `data-qa/assets/cf/cf41946b-*.txt`。

### P2（承诺的本地路径走不通/多标签页互踢）

**D-04 UI 无法登记自托管 Provider（新提交 7ed2f05 的功能 UI 不可达）**
- 复现：Provider 设置页填 `http://127.0.0.1:5190` + 任意密钥 → 保存 → 报错"本机地址需要显式标记为自托管 Provider 才允许使用"，但**表单没有任何"自托管"开关**；`AddProvider` 硬编码 `type:"elevenlabs"`（`src/features/core/ProviderSettingsPage.tsx:107`），而服务端 `vault.put` 明确支持 `selfHosted:true`+`type:"openai-local"`。
- 影响：BYOK 自托管链路在 UI 层断裂，只能靠带外 API 调用（本轮即如此继续的 E2E）。服务端+适配器+安全放行（`assertAllowedBaseURL allowPrivate`）都已就位，缺的就是表单字段。
- 证据：`provider-selfhost-ui-reject.png`。

**D-05 `GET /api/v1/session` 每次都签发新会话，多标签页必然互相踢掉 CSRF**
- 复现：Tab A 打开应用（缓存 csrfToken A）→ 任何一次新的 `/api/v1/session` GET（开 Tab B、或任何带外调用）→ Tab A 之后所有写操作 403 `CSRF_REJECTED`，直至整页刷新。
- 根因：`server/index.mjs` session handler 无条件 `sessions.issue()` 并 Set-Cookie 覆盖，不复用现有会话。
- 证据：server.log 时间线 `provider.validated` 失败前一条 `rejected CSRF_REJECTED`（18:53:08），换新会话后同一端点立即成功（18:53:20）。
- 附带说明：正常单标签页用户感知不到（SPA 只 bootstrap 一次），但双开标签是常态操作。

### P3（低危/外观）

- **D-UI-06** 文案中的 Markdown 源码符号直接显示：`**不是**`、`**未经 API 验证**`（isolator/sts 页截图可见）。
- **G-01**（同 §3.1，定性为缺口而非 P1 是因其为首页展示层）首页"最近"为硬编码占位数据（`src/data/recents.ts`），未接本地任务历史。
- **D-03**（观察项，非故障）本地适配器 `validateCredential` 成功即标"可用"，但模型列表仅计数（modelCount=2），TTS 页模型仍全为"未验证"占位枚举（eleven 系模型 ID），与本地 provider 无对应关系说明——与"能力不假装核验"原则一致，但模型枚举对 openai-local 类型语义不匹配，建议后续在 UI 区分。

### 台账不一致

- **L-01** GOAL 台账"331 项通过"无出处（无 GOAL.md 文件，全仓库 grep 无 "331"）；HEAD 实测 306 项。

## 6. Mock 端到端链路明细（全部本机 127.0.0.1）

Mock：`out/qa/mock-openai.mjs`（5190 端口，`/v1/models` 返回 2 个模型、`/v1/audio/speech` 返回程序生成的合法 WAV 8044 字节、`/v1/chat/completions` 返回固定 JSON；每次调用落盘 `mock-requests.log`）。

| 步骤 | 通道 | 结果 | 证据 |
|---|---|---|---|
| 1. UI 登记自托管地址 | 浏览器表单 | ❌ 400"本机地址需要显式标记为自托管"（D-04） | `provider-selfhost-ui-reject.png` |
| 2. API 直注 provider | 页内 fetch（带会话+CSRF） | ✅ 201 `cred_murblfry_1`, type=openai-local, selfHosted=true, maskedSecret 回显 | server.log `provider.created` |
| 3. 验证连接 | 服务端→mock `/v1/models` | ✅ `available`，modelCount=2，密钥不回传 | mock.log `GET /v1/models auth=Bearer qa-mock-…-> 200`；`provider-validated.png`（验证按钮在 UI 因 D-05 需刷新后重试，API 直验成功） |
| 4. TTS UI 提交 | 浏览器表单→`POST /jobs` | ✅ 创建成功（意图去重 ID、参数裁剪正确：style/speed 未发给 Multilingual v2） | `tts-ready-to-submit.png` |
| 5. 状态流转 | UI 轮询 | ❌ 卡 `draft`（D-01） | `tts-job-stuck-draft.png` |
| 6. 手动执行 | `POST /jobs/:id/run` | ⚠️ `succeeded` 但走 `/v1/chat/completions`，产物 `reply.txt`（D-02） | mock.log；`tts-e2e-final.png` |
| 7. 历史出现 | `/local/jobs` 页 | ✅ 显示 text_to_speech 成功记录 | `local-jobs-with-task.png` |
| 8. 可下载 | 资产 API/UI 链接 | ✅ `/api/v1/assets/cf41946b…` 15 字节 text/plain（内容为 mock 聊天文本，非音频） | API 响应、`data-qa/assets/cf/` |
| 9. `/v1/audio/speech` 被调用次数 | mock 日志 | **应用链路 0 次**（仅我预先自测 mock 时的 1 次） | `mock-requests.log` 全文 |

结论：**"任务创建→状态流转→产物生成→历史→可下载"的骨架各环节都存在且可观察，但 TTS 与本地 Provider 的组合在 HEAD 无法产出真实音频（D-01+D-02），自托管登记在 UI 层断裂（D-04）。** 若 mock 改为只实现 `/v1/audio/speech`，HEAD 的本地 TTS 将完全没有可达路径。

## 7. 持久化与密钥（符合设计）

kill 5188 → 同 `--data data-qa` 重启：
- 任务历史仍在：`GET /jobs` 返回 `dbb7e86e succeeded`（SQLite jobs db）。
- 素材仍在：`reply.txt` 15 字节（`data-qa/assets/cf/`）。
- 密钥清空：`GET /providers` 返回 `[]`；启动日志两轮均打印 `vault: memory only (restart clears keys)`。
- UI 复核：重启后 TTS 页回到"尚未配置 Provider"门禁、生成禁用（截图记录于测试日志）。

## 8. 每项标注

- 构建测试/路由渲染/excluded 跳转/持久化/错误路径/mock 链路：**实测**（本机 5188/5190 服务+ego lite 浏览器）。
- 真实供应商生成（ElevenLabs/其他云）：**未测**——需用户密钥与预算批准（AGENTS 红线+D7），本轮全部使用本机 mock。
- 23 条占位页的高保真视觉验收：**未测**——无功能 UI 可验，仅验证了可达性与占位一致性。

## 9. 未覆盖项（待后续轮次）

1. **minimax 在途功能页**（任务简报所列，待其提交后复验）：本轮 HEAD 已含全部路由注册，但 Studio/Flows/聊天/音乐/音色库/STT/说话者/有声书/品牌套件等 24 条路由的功能 UI 为占位，待实现后需完整逐页复验。
2. 双 provider 并存（elevenlabs 官方 + openai-local）时的模型/能力列表 UI。
3. 录音（MediaRecorder）路径、上传 >50MB 拒绝、异步任务（图像/视频/dubbing）轮询链路（本地适配器不支持，未驱动）。
4. `tests/qa/` 由并发 agent 新增的用例（api-breadth / local-provider-branches / page-tts / page-voice-tools）：未运行、未评审——**该 worktree 在我测试期间存在第二个 writer（02:49–02:58 持续写入），需协调人确认工位归属**。

## 10. 环境遗留说明

- 已清理：5188 服务、5190 mock 均已 kill（`lsof` 确认端口释放）；ego lite 任务空间已 `finish({keep:[]})`。
- worktree 内新增（均不入库/属测试产物）：`out/`（47 张截图+mock 脚本+日志）、`data-qa/`。`git status` 确认**无任何已跟踪源码文件被修改**；`assets/*.mp3`（02:38 npm test 集成测试产物）与 `tests/qa/`（并发 agent 所写）非本 QA 创建，未触碰。
- 主工作树 `/Volumes/YANG/11` 仅新增了本报告文件（`docs/qa/`），未做其他任何写入。
