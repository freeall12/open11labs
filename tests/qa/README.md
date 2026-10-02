# tests/qa — QA 补缺测试（2026-10-03）

由 QA 子智能体C 新增，只含新文件，不改任何存量测试。运行：`npm test`（全量）或
`npx vitest run tests/qa`（仅本目录）。基线核对：补测前全库 306 通过/17 文件（GOAL.md
所称 331 与实测不符，见"存量问题"），补测后 399 通过/22 文件，退出码 0。

## 文件与覆盖

| 文件 | 用例 | 覆盖目标 | 存量测试为何未覆盖 |
|---|---|---|---|
| `api-breadth.test.mjs` | 24 | 真实 loopback server（随机端口）：`/api/v1/vault`、`/tools`、provider rotate/未知 id、jobs 列表/`events`/`run`/重复 run 409/`poll`（running/draft/unknown 三态）、assets `probe`（WAV/非音频/未知 id）、folders、projects 列表/PUT 保存/409 版本冲突/DELETE 未知/variants、backup 导出+校验（合法/坏版本）、404 `NO_SUCH_ENDPOINT`、400 `BAD_JSON`、413 `BODY_TOO_LARGE` | contract/* 只测类库；integration/* 各只测一个端点族（providers、jobs 创建/取消、cost、上传、voices），其余路由从未在 HTTP 层被断言过 |
| `local-provider-branches.test.mjs` | 22 | `LocalOpenAIAdapter` 错误映射矩阵：无 baseURL、401/403、500（可重试+unknown）、400（不可重试）、AbortError 超时（不可自动重试）；`validateCredential` 非 2xx/坏 JSON/非数组 data；请求体契约（model/temperature/stream/max_tokens）；`fetchArtifact` 成功/缺 content-type/失败；`normalizeError`；baseURL 尾斜杠 | `tests/contract/local-provider.test.mjs` 只走 happy path（models 列表、200 补全、空补全、404、cost/cancel 诚实性），错误分支全部缺失 |
| `page-tts.test.tsx` | 15 | TTS 页（HEAD 已实现）：无/未验证 Provider 门禁+引导链接、超限/近限文案、按模型的参数门禁（不支持参数禁用且不发送）、Pro 格式拦截、费用确认勾选独立门禁、提交 payload（intent 形状、不支持参数被丢弃）、JobPanel；VoicePicker：needsProvider/失败原因/搜索过滤/选中/已选音色消失告警（不自动替换） | routing.test.tsx 只断言每个路由渲染出不同 h1，无任何交互行为测试 |
| `page-voice-tools.test.tsx` | 19 | STS 队列（非音频拒绝点名文件、50MB 网页观察上限、空态、blocked 链、upload→create→run、字节级重复复用）；人声分离（非音频、单文件、对比区、复用）；配音（文件→语言 blocked 链、语言数未核验声明、v1 无编辑器声明、提交 payload、远端项目 id）；YT 转写（yt-dlp 缺失门禁、权利+费用双确认、URL 去.trim 进 intent、转写渲染、复用） | 同上，无页面行为测试；api 模块在模块边界 mock（client 真实行为由 `tests/integration/client.test.mjs` 覆盖） |
| `page-media.test.tsx` | 13 | 音效（空描述门禁、预设只填稿不提交、时长上限文案、payload、产物+会话历史、复用）；图像视频（`?modality=` 深链、需审批模型拦截+说明、切模式重置模型保留草稿、image_generation payload+img 渲染、异步 running 面板+取消范围诚实文案、复用） | 同上 |

合计新增 **93** 用例。Studio/Flows/Chat/音乐/音色库为在途页面，按要求未测。

## 约定

- 集成测试与 `tests/integration/security.test.mjs` 同款：`createLocalServer` + 端口 0 +
  loopback + `adoptActualPort()`，provider adapter 全部 stub（不触网、无真实密钥）。
- 页面测试 mock `@/lib/api` 模块边界；本地 provider 测试注入 `fetchImpl`。所有请求域名为
  127.0.0.1 或纯 stub，无外部网络。
- 每个文件头部注释写明覆盖目标与缺口原因。

## 无法自动化 / 阻塞

- **D7（真实密钥）**：对真实 ElevenLabs 的 validate/voices/TTS/STS/isolation/dubbing/SFX
  端到端行为、真实计费金额——全部需用户自己的密钥与预算授权，本地只能测到门禁与
  "费用未知"披露为止。
- yt-dlp 真实下载公开 YouTube 音轨（网络+工具安装）未自动化，仅覆盖其缺失时的门禁。

## 发现但未修的存量问题

1. **GOAL.md 台账数字过期**：称基线 331 项通过，实测 306（17 文件）。以实测为准。
2. **存量集成测试污染工作树**：`upload.test.mjs` 等起 server 不传 `dataDir` 时
   `AssetStore` 落到 `process.cwd()`，每次 `npm test` 会在仓库根 `assets/` 写入若干
   哈希 mp3（并建 `tmp/`、`exports/`）。本次已清掉当次产物，未改存量测试；修复应让
   这些测试显式传 tmp `dataDir`（归集成测试 owner）。
3. **worktree 内有并发会话产物**：`out/qa/`（页面截图+server.log，5188 端口）与
   `data-qa/` 为另一会话手动起的本地 server 所留，非本套件产物，未动。
4. `tests/README.md` 仍写"待实施"，与现状不符（未改，归文档 owner）。
