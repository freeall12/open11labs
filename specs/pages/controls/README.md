# 逐页控件登记表（M0-T02 交付）

本目录是 [specs/pages/README.md](../README.md) 要求的「每页控件登记表」。编制口径与索引如下。

## 数据来源与三方交叉口径

每份登记表的每个控件都做**三方核对**，并显式给出结果：

1. **规范**：五份页面规范（shell.md / voice.md / media.md / editors.md / assets-local.md）与 [INTERACTIONS.md](../../INTERACTIONS.md)、[SCOPE.md](../../SCOPE.md) 要求的操作；引用格式 `规范:pages/voice.md#TTS行`。
2. **代码**：**以 worktree `/Volumes/YANG/11-worktrees/qa` 的 HEAD 提交 `7ed2f05` 为唯一代码基准**（qa 子智能体核对时的提交态）。主工作树中其他 agent 的在途未提交改动（Studio/Flows/Chat/音乐/音色库等新页面）**不属于已实现**，本登记表不采信。引用格式 `代码:src/features/voice/TtsPage.tsx`。
3. **证据**：[specs/routes.json](../../routes.json) 各路由的 `evidence` ID，对应私有研究目录 `research/elevenlabs-2026-10-02/`（截图+快照）。证据是**观察快照**，除 interaction-findings.md 记录了回执的点击外，不构成「已实测」。引用格式 `证据:025-tts-advanced`。

三方结论标记：

- `一致`：规范要求、代码已实现、有证据指向（实现仍可能未达视觉精确验收）。
- `代码超前`：代码已实现但规范/证据未覆盖（候选规范增补，见 [gaps.md](gaps.md)）。
- `不一致`：规范要求但代码缺失/偏离，或代码与规范冲突（逐条列出）。
- `范围外`：SCOPE.md 明确排除，不登记为缺口，仅记录移除事实。

## 来源标签（沿用 specs/pages/README.md）

- `实测`：观察到真实响应。**本目录为纯文档交叉核对，未起服务、未开浏览器，因此本目录中没有任何控件标注为「实测」**；此前 research 动作日志中的点击回执只作为证据强度说明，不升格为实测。
- `文档`：官方 API/能力文档结论，标注日期。
- `本地提案`：因本地 BYOK 需要设计的交互（如费用未知确认、本地预算），不得伪称原站行为。
- `待补采`：证据缺失或 coverage 非 observed，必须在视觉精确验收前补足。

## 每控件的字段映射

specs/pages/README.md 要求的全部字段在各表的列与页首「页面状态」小节中覆盖：

| 要求字段 | 登记表中的位置 |
|---|---|
| 稳定操作ID | 列「操作ID」，格式 `页面.控件名` |
| 标签/aria | 列「标签/aria（位置）」 |
| 入口/位置 | 列「标签/aria（位置）」括号内 |
| 页面状态（默认/加载/空/错误） | 每页表前「页面状态」小节（默认/加载/空/错误/禁用原因） |
| 输入 / 默认值 / 校验边界 | 列「输入·默认值·边界」 |
| 点击/键盘/hover结果 | 列「交互结果」（含 disabled 原因、键盘可用性） |
| 弹层关闭 | 每页表前「弹层」小节（HEAD 无弹层实现时显式写明） |
| 草稿持久化 | 每页表前「草稿持久化」小节 |
| 副作用/费用 | 列「副作用·API/本地」 |
| 公开API或本地操作 | 列「副作用·API/本地」 |
| 证据ID | 列「三方核对（规范/代码/证据）」 |
| 测试ID | 列「测试ID」（HEAD 仅 1 处 data-testid，其余为「无」） |
| 已实测/待验证/不支持 | 列「状态」：`已实现·待验证` / `规范要求·未实现` / `本地提案·待验证` / `范围外·已移除` / `待补采` |

红线遵守：不发明数值上限（代码中的上限一律转抄并标注其核验状态）；原始 buttons.csv 的 3059 条去重控件记录只当作观察线索，不当作「已验证」；费用未知一律写「未知」，不写 0。

## 文件索引

### 已实现页面（HEAD 有真实交互代码）

| 文件 | 覆盖路由 | 控件数 |
|---|---|---|
| [home-shell.md](home-shell.md) | home、全局壳（侧栏/顶栏）、404/范围外状态页 | 29 |
| [voice-tts.md](voice-tts.md) | tts（含 VoicePicker 共用控件） | 26 |
| [voice-sts.md](voice-sts.md) | sts | 16 |
| [voice-isolator.md](voice-isolator.md) | isolator | 13 |
| [voice-dubbing.md](voice-dubbing.md) | dubbing | 11 |
| [voice-stt.md](voice-stt.md) | stt、speakers（占位）+ YouTube 转写（已实现但不可达） | 14 |
| [media-sfx.md](media-sfx.md) | sfx + sfx-history/sfx-favorites（占位） | 16 |
| [media-image-video.md](media-image-video.md) | image-video（image/video/lipsync 三模式） | 12 |
| [assets-projects.md](assets-projects.md) | files + brand-kits（占位） | 17 |
| [provider-settings.md](provider-settings.md) | local-provider-settings、local-jobs、local-storage-settings（本地扩展） | 27 |

### HEAD 未实现（仅规范草案，无代码证据）

| 文件 | 覆盖路由 |
|---|---|
| [pending-studio-flows-chat.md](pending-studio-flows-chat.md) | studio、studio-templates、flows、flow-editor、chat、chat-session、audiobooks、模板/Audio Native/作品/广告引擎（path=null） |
| [pending-voice-media.md](pending-voice-media.md) | 音色库/创建音色/克隆/设计、我的音色、音乐全家、各历史/收藏页、speakers、audio-detector、media-history |

### 缺口汇总

| 文件 | 内容 |
|---|---|
| [gaps.md](gaps.md) | 规范要求但代码缺失、代码超前候选增补、证据缺失待补采，三类汇总 |
