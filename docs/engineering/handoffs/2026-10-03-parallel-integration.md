# 集成检查点 — 并行多 Agent 一轮（2026-10-03）

本轮把剩余页面从「元数据占位」推进到「真实交互」，并修正了两个此前未被发现的
全局缺陷。四个子 Agent 在**互不重叠的目录**上并行工作，集成者保留共享文件。

## 协作方式

- 契约落在 `docs/engineering/COLLABORATION.md`（铁律 + 目录级所有权 + 已完成现状）
- 通过 `mavis session list` 找到同工作区的兄弟会话（zcode），用 `session send`
  告知边界；它原本正准备基于**过期快照**重做 Studio/Flows/有声书/音乐/说话者，
  并准备 `git commit && git push`（会连带提交本轮的半成品）
- 共享工作树下**只有集成者提交**

分区：`src/features/voice/**` / `src/features/media/**` / `src/features/editors/**` /
`packages/providers/**` + `server/**`，集成者保留 `src/app`、`src/components`、
`src/data`、`src/lib`、`src/features/core`、`src/index.css`、构建配置。

## 两个此前未被发现的全局缺陷

### 1. 颜色令牌整体失效（影响每一个页面）

`src/index.css` 把设计令牌存成 **HSL 通道三元组**（`0 0% 100%`），
而 Tailwind v4 的 `@theme inline` 让工具类直接发出
`background-color: var(--background)` —— 三元组不是合法颜色，于是
`bg-background`、`bg-gray-950`、`text-foreground` **全部渲染为透明**。

实测证据（修复前）：

```
bg-gray-950    -> rgba(0, 0, 0, 0)
bg-gray-300    -> rgba(0, 0, 0, 0)
bg-background  -> rgba(0, 0, 0, 0)
bg-gray-alpha-100 -> rgba(0, 0, 0, 0.043)   ← 十六进制，正常
```

修复：在令牌源头包一层 `hsl()`，使每个令牌自身就是完整颜色，
`@theme inline` 无需改动。修复后同一探测为 `rgb(23,23,23)` / `rgb(184,184,184)` /
`rgb(255,255,255)`。这一个修复让弹层不透明、按钮变实心、开关可见——全站保真度
的提升主要来自这里，而不是逐页调参。

### 2. Provider 域名白名单忽略了平台类型

`assertAllowedBaseURL` 无论 `type` 是什么都只校验 ElevenLabs 的主机列表。
修复前 `type:"elevenlabs" + baseURL:"https://api.openai.com/v1"` 的行为取决于
调用方是否碰巧传对参数。现在按平台隔离，实测拒绝：

| 尝试 | 结果 |
|---|---|
| `elevenlabs` → `api.openai.com` | 400 `provider host not registered for elevenlabs: api.openai.com` |
| `anthropic` → Google 主机 | 400 `provider host not registered for anthropic: generativelanguage.googleapis.com` |
| `type:"made-up-vendor"` | 400 `provider host not registered for type "made-up-vendor"` |
| 自托管公网主机 + http | 400 `provider baseURL must be https` |
| loopback http 未勾选自托管 | 400 `本机地址需要显式标记为自托管 Provider 才允许使用` |
| `user:pw@` 嵌入凭据 | 400 `baseURL must not embed credentials` |

## 子 Agent 产出

| Agent | 目录 | 产出 |
|---|---|---|
| voice | `src/features/voice/**` | 新增 `ui.tsx`（消掉 5 份重复的 `Notice`/`TabLink`，草稿持久化，懒加载历史）；TTS 补设置/历史双页签、8 个示例、模型与音色弹层、高级设置、⌘+Enter；配音补 URL 页签与相似度；人声分离补历史；修 `SttPage` 的 `try/finally` 无 `catch` 漏出未处理拒绝；修 JSX 里字面量 `**` |
| media | `src/features/media/**` | 新增 `ui.tsx`（弹层/滑块/chips/提交箭头/费用未知胶囊）与 `drafts.ts`（250ms 防抖草稿，不含密钥）；音效页重写为参考的 composer 形态；音乐页改为两栏 + 项目历史（搜索 + 4 种筛选）；图像视频模型改为取自 `providers.models()` 而非编造；`ArtifactList` 增加 `error`/`onRetry`（向后兼容） |
| editors | `src/features/editors/**` | 新增 `FlowCanvas.tsx`（类型化节点与端口、连线时类型校验、四页签加节点菜单、工具簇、DAG 执行前置校验：环/悬空端口/类型不匹配/缺提示词/缺音色、⌘Z/⌘S、修订冲突提示）与 `Menu.tsx`；Studio 行菜单与编辑器重命名/导出/删除；有声书搜索/筛选/批量生成/取消；**修聊天死链**（见下） |
| providers | `packages/providers/**`、`server/**` | 新增 `lib/transport.mjs`（主机白名单校验 + 三种鉴权 + 脱敏）、`anthropic/adapter.mjs`、`google/adapter.mjs`；resolver 改为按注册表 `adapter` 字段分发，零硬编码平台 id；**修 `/providers/:id/models` 从未传入密钥的真实 bug**；计费优先用 token 计量而非「无计量头」 |

## 集成期修掉的跨模块问题

1. **聊天端到端是断的**：`ChatPage` 用 `p.type === "openai-local"` 过滤可用 Provider，
   而该 id 已不在目录里 —— 聊天页永远选不到任何可对话的凭据，新写的两个适配器不可达。
   改为读 `providersApi.catalog()` 并按 `chat === true` 过滤；无可对话平台时给出
   **信息态**提示（点名已配置平台，并说明 ElevenLabs 没有 completion 端点），
   这不是错误态。
2. **`bootstrap()` 的拒绝会变成未处理拒绝**：缓存的 promise 失败后不再重试，
   且调用方全部放弃时会抛到全局。加 `.catch` 清缓存。
3. **能力接口领域不一致**：回退行用 `providerId:<credentialId>` + `taskType:"text_to_speech"`，
   真实行用平台 id + `"chat"`。统一为平台 id + 新增 `credentialIds`。
4. 标题契约收敛：`PageFrame`（非 `bare`）拥有 `<h1>`；`bare` 页自持标题。
   期间修掉音效/图像/聊天的重复 `<h1>` 与品牌套件/聊天会话的缺失 `<h1>`。
5. 路由切换时 `document.title` 一直是首页。
6. **Flow 画布与外壳重叠**：画布根节点是 `fixed inset-0 z-20`，而外壳顶栏 `z-30`、
   侧栏 `z-40`，画布自己的头部被压在下面，两排控件叠在一起（浏览器截图确认）。
   改为 `top-[50px] lg:left-64`，让画布落在外壳内部，只保留一行头部和一条侧栏。

## 验证（集成者亲跑）

| 命令 | 结果 |
|---|---|
| `npm run typecheck` | **exit 0** |
| `npm run build` | **exit 0**，`✓ built in 11.16s`，CSS 49.28 kB / JS 627.52 kB |
| `npm test` | **331/331 通过，20/20 文件** |
| `npx vitest run tests/contract/routing.test.tsx` | 51/51 |
| `npx vitest run tests/contract/ytdlp.test.mjs` | 11/11（1.18s） |
| 全量路由浏览器巡检 | 30/30 渲染，无崩溃，无 console error |

### 两个未通过项，如实记录

1. **`ytdlp availability probe` 在满负载下会 5000ms 超时**。两个子 Agent 各自独立
   复现，单独跑 11/11 通过（1.18s），最终集成复跑 **331/331 全通过**。这是并发计时
   抖动而非功能失败；根治办法是给该用例加 per-test timeout，本轮未改
   （`tests/**` 不在本轮任何一方的所有权内）。
2. **1 个未处理拒绝**：`Failed to parse URL from /api/v1/session`，
   来自 jsdom 无法解析相对 URL（真实浏览器不会）。voice Agent 用「把我的文件
   全部还原到 HEAD」的反证实验确认：**同一错误在 HEAD 同样存在**，非本轮引入。
   本轮已把缓存 promise 不再保持 rejected 状态，改善但未根除。

## 未完成 / 阻塞（不伪造）

- **真实 Provider 端到端**：用户已明确**不提供测试密钥**。因此
  Anthropic / Google 的**路由存在性**已用无鉴权探测证实（401/403/405），
  **请求/响应形状仍全部标 `unverified`**，没有伪造任何能力。
- **音乐生成**：适配器无 `music_generation` 用例，页面显式拒绝并说明原因。
- **`routes.json` 里 5 条 `path:null`**（studio-editor / templates / audio-native /
  productions / ads-engine）按规则不猜 URL。本地编辑器走
  `LOCAL_DYNAMIC_ROUTES` 的 `/app/studio/:id`，是本地决定而非伪造上游路径。
- **未做像素级 diff**。对照的是参考站截图与 a11y 快照的控件清单，
  不宣称「1:1 视觉一致」。

## 视觉复验产物（部分）

新增 `scripts/visual-audit.mjs`（无新依赖，驱动本机 Chrome headless 逐路由截图 +
生成 `INDEX.md`）。运行方式：

```bash
npm run build
PORT=5178 node server/cli.mjs serve &
node scripts/visual-audit.mjs --base http://127.0.0.1:5178 --out tmp/visual
```

**实测只完成 6/30**，剩余未生成。原因是本工作区在 exFAT 外置盘上，Chrome 每页
启动就写大量小文件，**每页约 20 秒**，30 页需约 10 分钟且与并行任务抢 CPU。
脚本已把 Chrome profile 移到 `tmpdir()`（本地 APFS）以缓解，但仍是瓶颈。
`tmp/` 已 gitignore，产物不入库。

**因此本轮的视觉复验证据分三层，不混为一谈**：

1. **程序化全量**：30 条路由逐条渲染，均未崩溃、无 console error，标题/正文非空
2. **人工抽查（已看截图）**：主页、STT 库页、STT「转录文件」弹层、音色库、
   Studio、Provider 与密钥、Flows 列表、**Flow 画布**、**加节点菜单**
3. **未做**：逐页与参考站的像素级 diff

**画布与外壳重叠的缺陷就是第 2 层发现的** —— 程序化全量巡检不会发现两个控件
叠在一起，它只报告「没有崩溃」。这也是不把「无崩溃」当验收通过的原因。


---

# 第二轮：逐页保真复刻（4 个并行 Agent）

第一轮把页面从占位变成真实实现；第二轮按 `docs/engineering/visual-reference-map.md`
的共享证据映射，逐页对照参考截图与 a11y 快照做保真。四个 Agent 各占一个目录，
各自用独立浏览器实例（`mcp__chrome-devtools__*`），互不重叠。

## 为什么用 MCP 浏览器而不是 headless 脚本

`scripts/visual-audit.mjs` 串行 30 页要约 10 分钟（exFAT 卷上 Chrome 每页启动
约 20 秒）。四个 Agent 各自开一个浏览器实例并行，才让这一轮在可接受时间内完成。
脚本保留，用于一次性全量取证。

## 各 Agent 产出摘要

### 应用壳 + 本地配置页
- 工具宫格间距 **117px → 97.0px**（十宫格实测对齐参考的 10×81 + 9×16 = 954px）
- 提示条到宫格的垂直间距 **20px → 123px**
- 侧栏标题 `置顶项` → **`已置顶`**（参考原文）
- `更多工具` 的 chevron 只在展开时出现
- `配音` 与 `转录` 原本共用同一个 `IconCaption`（两个一模一样��宫格），配音改用新图标
- **删除编造内容**：最近项目原本有 6 条虚构项目 + 虚构的「上周/上个月」时间，
  「快速入门」有 9 个指向 `/app/templates/1..9` 的**死链**。改为读真实任务账本

### 音色页
- **TTS 与变声器由单列改为双列**（左侧脚本 + 右侧设置栏），对齐参考 015/025
- 滑块顺序修正为 标题 → 更慢/更快 → 轨道，并去掉参考中不存在的数字读数
- 模型下拉带 `V2` 徽标；音色/模型为整宽 pill
- 变声器补真实拖放上传、清空队列、总时长、⌘+Enter

### 编辑器页
- **Flow 画布按参考 058 重构**：节点标题移到卡片上方的无框说明行、结果区改
  `aspect-video` 实底、页脚控件居中 pill、连接点与贝塞尔端点精确对齐
- 工作室：灵感卡改 `aspect-video`、提示条改 42px
- 有声书：**删除「打款/分析/资源」三个已移除功能的伪标签页**（违反 scope 规则）

### 媒体页（Agent 被中断）
已完成音效 composer 重写、音乐双栏页、图像视频控件接线；**在修图像页时被中断**。

## 集成期我修掉的问题

1. **`route-manifest.ts` 存在 TDZ 缺陷**：`PENDING_ROUTES` 读取 `LOCAL_ROUTE_IDS`，
   而该 `const` 声明在其下方 → 运行时读取未初始化的绑定。已调整声明顺序。
2. **`npm test` 之前 exit 1 而非 0**：`Tests 331 passed` 之后有未处理 rejection。
   根因是 jsdom 的 `location` 有 origin 但全局 `fetch` 是 Node undici，直接拒绝
   相对 URL。已在 `tests/setup.ts` 补 fetch stub；**关键约束是只拦相对 URL**，
   否则会把集成测试里指向真实 `http://127.0.0.1:<port>/api/...` 的请求也吃掉，
   用罐头响应替换掉被测服务器（第一次就是这么弄坏的，8 个集成用例变红）。
   现在 `Test Files 20 passed / Tests 331 passed` 且 **exit 0**。
3. **音效页 composer 覆盖空状态**：`sticky bottom-4` 用在最后一个子元素上，
   页面不滚动时会被拉到视口底部、压住上方内容。改为常规流 + 页面留白。
4. **面包屑按 owner 分组导致语义错误**：出现「图像和视频 › 音效」。音效是侧栏
   顶层工具，不是图像视频的子页面。改为**按路由**映射，只有参考里真正嵌套的
   页面才有父级。
5. 服务端补齐 `aspectRatio` / `resolution` / `sound` / `loop` 转发（原先 UI 有
   控件但适配器丢弃）。**注意副作用**：editors Agent 据此发现并删掉了一处
   重复的 `sound_generation` 提交 —— 保留它会重复计费。
6. `PageFrame` 侧边内边距 72px → 48px（对齐参考）；`DropZone` 高度 150px → ~85px。

## 第二轮验证

| 项 | 结果 |
|---|---|
| `npm run typecheck` | **exit 0** |
| `npm run build` | **exit 0** |
| `npm test` | **331/331，exit 0**（20/20 文件） |
| 32 条路由浏览器巡检 | 全部渲染，**每页恰好一个 `<h1>`**，无崩溃 |
| console error | **0** |
| 面包屑 | 已按路由修正 |

## 仍未完成（如实）

- **media Agent 被中断**，图像/视频页的最后一轮几何微调没有收尾，也没有它自己的
  复核报告。该页当前 typecheck/build/test 全绿，但**未经最终视觉确认**。
- **未做逐页像素级 diff**：对照的是参考截图与 a11y 控件清单，不宣称「1:1 视觉一致」。
- **真实 Provider 端到端**仍缺（用户不提供密钥）；音乐生成无适配器用例。


---

# 第三轮：收尾三个未完成项

第二轮结束时剩下三件事，本轮各派一个 Agent 补齐。

## 1. media 收尾（上一轮 Agent 被运行时中断）

它用 CDP 驱动自己的 Chrome 逐页复验，然后报了三件我预没想到的事：

- **发现我自己的 bug**：我此前用正则插入 `const providerNotice = ...` 时，那一行落进了
  JSX 里，**编译通过、但当成字面文本渲染在页面上**。typecheck 和 build 都不会报。
  这是「编译通过 ≠ 正确」的典型，只有看渲染结果才发现。
- **根因定位 `color-scheme`**：`index.html` 的 `<meta name="color-scheme" content="light dark">`
  让 UA 用**深色调色板**渲染所有未样式化的表单控件，复选框在白底上变成**纯黑方块**。
  它用隔离复现证明（加/去这个 meta 对比），不是猜的。
- **`disabled` 按钮不弹 `title`**：未转交控件的原因写在 `title` 上，但浏览器对
  disabled 元素不显示 tooltip，所以原因根本点不出来。改为外层 `<span title>` + `cursor-help`。

**它无法确认的**（已如实记录）：未做像素级 diff；生成历史页缺一个 composer（参考 131 有，
需要重构 740 行文件，已留给集成者）；没有真实密钥，所有提交/取消/轮询/下载状态只读代码未实跑；
参考里存在**自相矛盾**的地方（077 与 080 的控件顺序不一致），它没有硬猜。

## 2. visual-audit 提速（根因与我的假设不同）

我给的简报假设「每页启动一次 Chrome 是瓶颈」。**Agent 证明这个假设是错的**：

```
chrome --headless=new --virtual-time-budget=3500 --screenshot=out.png <url>
→ 200 秒后仍在运行，被工具超时杀掉
```

**Chrome 的 `--screenshot` 模式在这个页面上根本不会自行退出**，去掉 virtual-time 也一样。
旧脚本的 `execFile(60s 超时)` 是唯一终结它的东西，所以每页正好 60 秒；而且因为 kill 会和
Chrome 的落盘竞争，工具本身还是**不稳定**的（29 页里 6 页 FAIL，exit 1）。

改成单浏览器 + CDP 后：

| | 墙钟 | 每页 | 结果 |
|---|---|---|---|
| 改前 | **1741.1 s**（29 分钟） | 60.0 s | 23/29，exit 1 |
| 改后 | **21.3 s** | 0.71 s（中位 0.60） | **29/29，exit 0** |

**约 82 倍**。它还证明了**加载事件不能当就绪信号**：`/app/speech-to-text` 在 935 ms 触发
`Page.loadEventFired` 时 DOM 还是空的；`/local/jobs` 会先画出 240 字符的**部分**树再填到 340。
所以就绪判定加了「DOM 签名稳定」这一层，并用「250 ms 预算下 29/29 判为未就绪」证明该判定
不是恒真。

## 3. storage 首次保真（此前从未做过）

对照 066-071 重写了素材页。它发现：

- **我给的简报把 070 说成「弹层」，但证据显示那是行内可编辑行**。它以证据为准。
- **又一处会编造数字的 bug**：服务端把 `referencedBy` 放在 `error` **旁边**，而 `api.ts`
  只把 `error` 塞进 `details`，于是 UI 读到 `undefined`，**准备打印「0 个工程」**。
  我已在 API 层修（把同级字段并入 `details`），它同时做了客户端兜底。
- 服务端**没有文件夹的重命名/移动/删除**，所以文件夹行没有 `⋯` 菜单；它没有编一个出来。

## 集成期我修的

1. `index.html`：`color-scheme` 改 `light`（修全站表单控件），`lang` 改 `zh-Hans`
   （修 UA 日期选择器暴露繁体 a11y 名）。
2. `src/lib/api.ts`：同级错误字段并入 `details`。
3. `src/features/shared/PageFrame.tsx`：`brand-kits` 标题改 `素材`（073 的形态是父标题 + 标签页）。

## 第三轮验证

| 项 | 结果 |
|---|---|
| `npm run typecheck` | **exit 0** |
| `npm run build` | **exit 0** |
| `npm test` | **331/331，exit 0** |
| 视觉索引 | **29/29 路由，21.7 s**，全部 1512×900，中位 95 KB（最小 62 KB，非空白帧） |
| 逐张抽查 | 素材页、音乐页人工看图确认为真实渲染 |

## 仍然未完成

- **未做逐页像素级 diff**，不宣称「视觉 1:1」。
- **生成历史页缺 composer**（参考 131 有）。
- **真实 Provider 端到端**缺（无密钥）；音乐生成无适配器用例，页面显式拒绝。
- 服务端缺文件夹重命名/移动/删除。
- 参考证据本身有缺口：说话者页只有骨架屏、音频检测只有入口、有声书是 partial-loading。


---

# 第四轮：生成历史页补 composer（最后一个已知缺口）

把 `/app/image-video`（探索）与 `/app/image-video/history`（历史）**合并为一个组件**，
按 `tab` prop 渲染，对齐参考 130/131：历史页同样带 composer、三个筛选 chip 和示例卡。

Agent 修的不只是外观，还有真 bug：

- **`drafts.ts` 的防抖写入在卸载时被取消**，也就是说导航前最后输入的那几字**恰好会丢**。
  改成卸载时 flush。
- **标签页链接丢掉 `?modality=`**，每次切页都把模式重置回图像。参考 131 自己的 URL 就是
  `/app/image-video/history?modality=lipsync`。
- **口型同步的拒绝提示会被"未配置 Provider"的横幅压掉**——也就是说一旦用户配了密钥，
  拒绝原因就消失了。改为口型同步模式下无条件显示。
- composer 的模型按钮与「模型」筛选 chip **无障碍名撞车**，都叫 `模型`。
- 折叠态的恢复建议按钮跑到了模式标签左边；131 里它在标签行右侧。
- `LIPSYNC_RESOLUTIONS` 回退到 720p，131 显示的是 1080p。

## 集成期我修的三件（都是它标记为"不在我 lane"的）

1. **服务端真 bug：`sniffContainer` 把任何 `ftyp` 盒子都判成 `audio/mp4`**，
   于是真实 h264 视频上传被拒：`文件内容（audio/mp4）与声明的类型（video/mp4）不一致`。
   也就是说**视频根本传不上去**。改为读 `hdlr` 盒里的 handler（`vide`/`soun`）判定，
   品牌名只作兜底。用 ffmpeg 生成的真实 mp4 验证通过，且音频 m4a 仍正确判为 `audio/mp4`。
2. 面包屑 `media-history` 由「生成历史」改为「图像和视频」（131 的形态是父标题 + 标签页）。
3. `PageFrame` 增加 `showCompactHeading`。**这里我自己踩了一次坑**：第一版把紧凑标题
   渲染成 `<span>`，看起来对，但页面从无障碍树里消失了——`Unable to find an accessible
   element with the role "heading"`。改为真正的 `<h1>`，只是字号变小。

## 第四轮验证

| 项 | 结果 |
|---|---|
| `npm run typecheck` | **exit 0** |
| `npm run build` | **exit 0** |
| `npm test` | **331/331，exit 0** |
| 视觉索引 | **29/29 路由，21 秒** |
| Agent 自测 | 26 项 CDP 交互断言通过；筛选在**真实上传**的 png+webm 上验证（视频 1 / 图像 1 / 上传 2） |
| 测试数据 | 已清空（0 assets） |

## 全部四轮结束时的状态

- 33 条可路由 / 11 条按 SCOPE 排除 / 5 条待补采证据
- 28,000+ LOC，`typecheck` / `build` / `test` 三关 exit 0
- 29 条路由全部有截图，且逐张确认是真实渲染而非加载帧

## 仍然未完成（最终如实清单）

- **未做逐页像素级 diff**，不宣称「视觉 1:1」。
- **真实 Provider 端到端**未跑（用户不提供密钥）；音乐生成无适配器用例，页面显式拒绝。
- ~~根因已修但未补回归测试~~ → **已补**（见下）。
- 服务端仍无文件夹重命名/移动/删除。
- 参考证据本身有缺口：说话者页只有骨架屏、音频检测只有入口、有声书是 partial-loading。
- 字体用 OFL Outfit 替代原站专有 Waldenburg，字形差异已登记——**这是有意偏差**。


---

# 回归测试补齐（收尾）

为 mp4 类型判定补了两条用例，并**验证它们不是空断言**：

- `types an mp4 container by its track handler, not by the ftyp box`
  —— 视频 handler 判为 `video/mp4`；共享 `isom` 品牌下的音频仍判为 `audio/mp4`。
- `still refuses a declared type that contradicts the bytes`
  —— handler 判定不能变成「一律放行」：文件声明 `soun` 而调用方声称 `video/mp4`
  时仍然被拒。

**非空验证**：把修复临时改回 `if (tag(4,4) === "ftyp") return "audio/mp4"`，第一条
立刻失败（1 failed / 24 passed）；改回修复后 25/25 通过。只看「测试通过」无法证明
测试有用，这一步是为了证明它真的在守那条线。

最终门禁：`typecheck` 0 · `build` 0 · `test` **333/333 exit 0**（20/20 文件）。
