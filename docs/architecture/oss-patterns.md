# 开源项目经验迁移：hypit 等视频 DSL 项目的可借鉴点

调研时间 2026-10-03。目的是判断哪些做法能迁移到本项目（ElevenLabs BYOK 创作工具），
哪些属于它自己的场景、与我们无关。

## hypit 是什么

`hypit-ai/hypit`，给 AI Agent 用的**视频 DSL（`.svml`，作者自述为"视频版 HTML"）+
执行运行时**。核心主张：丢一条参考视频，Agent 把它拆成可编辑、可重跑的工作流，
然后换人物/产品/语言批量出变体。

关键事实（来自 README 与多方评测，标注为已读未实测）：
- 软件开源免费、无席位费无渲染费无水印；**模型 API 费用另算**
- 用**自定义开源许可证**，非 MIT/Apache，商业化/多租户/SaaS 需先看条款
- 纯代码渲染的画面不调模型，成本可为 0
- 依赖无头 Chromium 渲染

## 五条可迁移的工程原则

### 1. 产物是工程，不是成片 ⭐ 已落地

hypit 最值钱的一点：跑完留下一份**结构化工程**，而不是一个 MP4。
价值随迭代累积，工具淘汰了工程还在。

**本项目对应**：`ProjectStore` 已经是「工程」而非「结果」——带 `schemaVersion`、
`revision`、`content` JSON、`assetRefs`。变体从工程派生，不从成片派生。

**已实现**：`ProjectStore.deriveVariant()`（本轮新增，7 项测试）。见下方"已落地"。

### 2. 变量具名，结构复用 ⭐ 已落地

hypit 的一句话设计是**素材锚定在台词的词上，不锚在时间轴的秒数上**。
换一句台词，相关画面自动重排；否则每次改稿都要逐帧手动对齐。

**本项目对应**：把"锚在时间/序号上"换成"锚在具名参数上"。

`deriveVariant` 记录 `derivedFrom: {id, revision, changed}`——
变体知道自己从哪一版、哪些变量真的变了，而不是复制一份改不动的快照。
`intentId` 去重键（`provider+model+voice+参数`）是同一思想的更早实例。

### 3. 纯代码渲染作零成本兜底

hypit 的字幕、动效、代码绘制画面不调模型，成本为 0。

**本项目对应**：凡是**不需要模型**的部分必须本地完成——
波形可视化、字幕排版烧录、音频时长/格式探测、静音检测、文件完整性校验。
这些即使一个 Provider 都没配也应该能跑。

**我们已有的**：资产去重（内容哈希）、时长/格式元数据、下载与完整性校验。

### 4. 模型层可插拔 + BYOK

hypit 不绑厂商，Seedance/可灵/MiniMax/WhisperX 随意切，可接本地模型。

**本项目对应**：`adapters` 按 providerId 注册，适配器实现固定接口
（`submit`/`submitSts`/`submitAsync`/`pollStatus`/`cancel`/`fetchArtifact`/`normalizeError`/`estimateCost`）。
新增一个 Provider 不改页面代码。

**我们还差的**：本地模型 Provider 尚未实现（目前只有 elevenlabs 一个）。

### 5. 成本透明是产品特性

hypit 反复强调"软件 $0、模型另算"，批量前先算 API 费用。

**本项目对应**：已经有 `COST_STATE = estimated/reported/reconciled/unknown`，
未知一律 `null` 而非 0，失败也记 unknown。本项目在这点上已达标。

## 明确**不**迁移的部分

| hypit 的做法 | 为什么不适用于本项目 |
|---|---|
| Agent Skill 分发（`npx skills add`） | 我们是 Web 应用，不是 Agent 工具。分发形态不同。 |
| 无头 Chromium 渲染视频 | 我们产出音频/图像/视频**文件**，不需要自己实现渲染引擎；那是模型侧的事。 |
| 复刻他人爆款视频 | 涉及版权与肖像权。`SCOPE.md` 已排除，**不做绕过**。 |
| 自定义许可证 | 我们的开源许可证待用户确认（D2），不照搬。 |

## 已落地（本轮）

`ProjectStore.deriveVariant(id, {name, variables})`：

- 结构（`content.beats` 等）原样保留
- 只有具名变量被替换，未改动的保持不变
- 记录 `derivedFrom: {id, revision, changed}`，`changed` 只含**真的变了**的键
- **复用 `assetRefs`**，不重新生成任何素材
- 派生本身**不执行任何任务**；要出片仍走正常的费用确认路径
- 变体可继续再派生（链式）

7 项测试覆盖上述全部性质，其中"派生不重新生成"和"不列未改动的变量"是重点。

## 下一批可落地的

1. **Project 声明式化**——`content` 从 UI 状态堆积收敛为稳定的声明式 schema，
   让工程可 diff、可重跑（对应 hypit 的"视频版 HTML"）
2. **纯代码渲染兜底**——波形/字幕排版/时长探测不依赖任何 Provider
3. **本地模型 Provider**——`adapters` 注册表已经留好位置

## 证据说明

以上为**阅读公开资料得出，未运行 hypit**。其"总成本 $1.15/条"等数字是项目方口径，
不是独立实测，本文不作为结论依据。
