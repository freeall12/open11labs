# 控件登记表：语音转文本（STT）+ YouTube 转写

- 代码基准：qa worktree HEAD `7ed2f05`。
- 涉及代码：`src/features/voice/pages.tsx`（SttPage/SpeakersPage 为占位）、`src/features/voice/YoutubeTranscription.tsx`（已实现组件）、`src/app/route-manifest.ts`、`src/app/router.tsx`。
- 规范：`specs/pages/voice.md#STT行`（证据 104–112）。
- 证据：routes.json `stt` → `106-stt-upload-dialog`（observed）、`speakers` → `112-stt-speakers-page`（**partial-loading** 待补采）。

## 页面状态

- `/app/speech-to-text`（stt 主页）：**未实现**。渲染 PageFrame + ScopeNotice（路由 ID/路径/负责人/证据等信息卡），无任何功能控件。规范 104–112 的上传/录制/YouTube/URL、语言、音频事件/字幕/逐字/音色分配/关键术语、编辑器/导出全部未实现（见 pending 部分）。
- `/app/speech-to-text/speakers`（speakers）：同上占位，且证据本身 partial-loading 待补采。
- YouTube 转写（本地扩展组件）：状态齐全，见下。

## 重要核对结论（不一致）

**YouTube 转写页已实现但不可达**：`router.tsx` 的 PAGES 注册了 `"stt-youtube": SttYoutubePage`，但 routes.json 中不存在 id 为 `stt-youtube` 的路由，`ROUTABLE_ROUTES` 由 routes.json 派生 → 该组件在任何 URL 下都不会挂载（死代码）。规范 voice.md#STT 明确要求「上传/录制/YouTube/URL」，故功能属于规范要求且已写、缺路由入口与导航入口。修复需改 routes.json/router（超出本表职责，记 gaps）。

## YouTube 转写控件表（代码存在、当前不可达）

本组件定位为**本地扩展**（yt-dlp 开源下载音轨 → 本地素材 → 用户自己的 STT Provider 转写），代码注释与 `--no-cookies` 红线一致。以下「代码」引用 YoutubeTranscription.tsx。

| 操作ID | 标签/aria（位置） | 输入·默认值·边界 | 交互结果 | 副作用·API/本地 | 三方核对（规范/代码/证据） | 测试ID | 状态 |
|---|---|---|---|---|---|---|---|
| yt.未安装yt-dlp警告 | 警告条+安装命令 `<code>`（页首） | 无 | 条件渲染（`GET /api/v1/tools` 返回 yt-dlp 不可用时） | 无 | 规范:本地提案（开源工具链） / 代码:L27-32,126-131 / 证据:无 | 无 | 本地提案·待验证（不可达） |
| yt.流程说明 | info「yt-dlp（开源）下载公开视频音轨 → 本机素材库 → 你自己的 STT Provider…」（页首） | 无 | 静态 | 无 | 同上 / 代码:L133-136 / 证据:无 | 无 | 本地提案·待验证 |
| yt.链接输入 | label「YouTube 链接」text input（表单区） | 文本；默认空；仅接受公开链接（无 URL 格式强校验，空则禁用） | 输入即生效 | 无 | 规范:voice.md#STT「YouTube/URL」 / 代码:L138-147 / 证据:无 | 无 | 本地提案·待验证（不可达） |
| yt.仅公开链接说明 | 「仅接受公开链接。不绕过登录墙、年龄门槛或付费墙，也不读取你的浏览器 Cookie。」 | 无 | 静态 | 无 | 规范:AGENTS#红线「不绕过版权/平台限制」 / 代码:L148-150 / 证据:无 | 无 | 本地提案·已实现（红线声明） |
| yt.语言选择 | label「语言」select（表单区） | 自动识别（默认）/en/zh/ja/ko/de/fr/es | 切换即生效 | 提交时 languageCode | 规范:voice.md#STT「语言自动识别/手选」 / 代码:L153-169 / 证据:无 | 无 | 本地提案·待验证 |
| yt.费用未知提示 | 警告「音轨会发送到 {baseURL}…费用未知」（表单区下） | 无 | 静态 | 无 | 规范:AGENTS#BYOK / 代码:L171-174 / 证据:无 | 无 | 本地提案·已实现 |
| yt.权利确认复选框 | checkbox「我确认对该内容有合法的处理权…不用于再分发。」 | 默认不勾 | 不勾禁用提交 | 无 | 规范:AGENTS#红线（素材权利） / 代码:L177-187 / 证据:无 | 无 | 本地提案·已实现 |
| yt.费用确认复选框 | checkbox「我了解会产生费用、金额未知…」 | 默认不勾 | 不勾禁用提交 | 无 | 规范:AGENTS#BYOK / 代码:L188-199 / 证据:无 | 无 | 本地提案·已实现 |
| yt.下载并转写按钮 | 「下载并转写」/「下载并转写中…」（提交区） | disabled 链：加载/未装 yt-dlp/无 Provider/非 available/链接空/两确认未勾/提交中 | 点击 `jobs.create`（intentId=provider+language+URL，重复提示复用不重复计费）→ `jobs.run` → 成功后 `assets.readText` 读回文本（JSON 或纯文本） | 服务端执行 yt-dlp + Provider 转写（费用未知）；中间音频不出服务端 | 规范:voice.md#STT「转录」 / 代码:L84-122,204-214 / 证据:无 | 无 | 本地提案·待验证（不可达） |
| yt.任务面板 | 「任务 {status}」+错误行（提交区下） | 无 | 条件渲染 | 无 | 规范:INTERACTIONS#状态 / 代码:L216-225 / 证据:无 | 无 | 本地提案·待验证 |
| yt.转写结果区 | 「转写结果」：字符数/源时长+只读 textarea rows=12+说明「编辑这里的文字不会重新调用转写」（结果区） | 无 | 成功后显示；编辑被刻意只读化 | 无 | 规范:voice.md#边界「STT编辑器改文字不意味着重新调用转录」 / 代码:L227-251 / 证据:无 | 无 | 本地提案·待验证 |
| yt.去本地设置链接 | 「需要 STT Provider？去本地设置」（页尾） | 无 | Link → /local/settings/providers | 无 | 规范:本地提案 / 代码:L253-258 / 证据:无 | 无 | 本地提案·待验证 |

## STT 主页与说话者页（占位，无代码证据）

| 操作ID | 现状 | 三方核对 | 状态 |
|---|---|---|---|
| stt.上传对话框/录制/URL入口、语言、音频事件/字幕/逐字/说话人分配/关键术语、转录按钮、编辑器、导出 | 全部未实现；页面为 ScopeNotice 信息卡 | 规范:voice.md#STT行 / 代码:pages.tsx `page("stt")` 占位 / 证据:106-stt-upload-dialog（observed） | **规范要求·未实现**（证据已有，可进入实现，不需补采即可开工结构层） |
| speakers.说话者管理页 | 占位 | 规范:voice.md#STT行 / 代码:pages.tsx `page("speakers")` / 证据:112（partial-loading） | **规范要求·未实现**，且**待补采**（112 证据不完整） |

## 汇总

14 个登记项。两处结构性问题记 gaps：YouTube 转写不可达；STT 主页规范要求全部未实现。
