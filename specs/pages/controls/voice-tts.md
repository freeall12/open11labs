# 控件登记表：文本转语音（TTS）

- 代码基准：qa worktree HEAD `7ed2f05`，`src/features/voice/TtsPage.tsx` + `src/features/voice/VoicePicker.tsx`（共用）+ `src/lib/api.ts`。
- 规范：`specs/pages/voice.md#TTS行`（证据 012–025）、`specs/INTERACTIONS.md`、`specs/BYOK.md`（费用未知确认）。
- 证据：routes.json `tts` → `025-tts-advanced`（coverage: observed）。
- 口径提示：本页是 BYOK 功能性实现，**未对齐 025-tts-advanced 截图的原站布局/字号/间距**；视觉复刻属未完成（记 gaps）。

## 页面状态

- **默认**：加载 Provider 列表后自动选第一个 `available` 的，否则取第一条；模型=Multilingual v2；格式=MP3 44.1kHz 128kbps；参数 稳定性 0.5 / 相似度 0.75 / 风格 0 / 语速 1.0 / 说话人增强开；文本空；未勾费用确认。
- **加载**：`providers.list()` 期间提交按钮禁用，显示「正在读取本地 Provider…」。
- **空**：无文本 → 提示「请输入要朗读的文本」；无任何 Provider → 警告条+「去本地设置添加密钥」链接；音色列表空 → 「没有匹配的音色」。
- **错误**：Provider 读取失败红色提示；Provider 非 available → 状态+lastError 警告条；文本超上限红字；提交失败显示 ApiError safeMessage；任务 failed/unknown_submission 显示 `safeMessage（提交确定性：…）`。
- **禁用原因链**（提交按钮，按序）：加载中 → 未配置 Provider → Provider 非 available → 未选音色 → 文本超上限 → 格式需权限 → 未勾费用确认 → 提交中。

## 弹层

无弹层。规范中 TTS 的设置面板/历史菜单/模型全列表弹层均未实现。

## 草稿持久化

无。文本/参数/模型/格式/音色全在组件 state，刷新丢失；切换模型**保留**参数 state 但提交时丢弃当前模型不支持的字段（代码注释与行为一致）。

## 控件表

| 操作ID | 标签/aria（位置） | 输入·默认值·边界 | 交互结果 | 副作用·API/本地 | 三方核对（规范/代码/证据） | 测试ID | 状态 |
|---|---|---|---|---|---|---|---|
| tts.Provider缺失警告 | 无 aria 的警告条+「去本地设置添加密钥」Link（页首） | 无 | 条件渲染（providers 为空）；链接跳 /local/settings/providers | 无 | 规范:INTERACTIONS#状态「无钥匙」 / 代码:TtsPage.tsx L211-218 / 证据:025-tts-advanced（原站对应状态待比对） | 无 | 已实现·待验证 |
| tts.Provider不可用警告 | 警告条+「前往验证」Link，显示 validationState 与 lastError（页首） | 无 | 条件渲染；链接跳本地设置 | 无 | 规范:voice.md#边界「能力不可用给中性原因」 / 代码:TtsPage.tsx L220-228 / 证据:025 | 无 | 已实现·待验证 |
| tts.能力未验证提示 | info 提示条「所有模型都标为未验证…」（页首） | 无 | 静态；声明本地不断言能力 | 无 | 规范:pages/README「capabilities 运行时边界」 / 代码:TtsPage.tsx L230-235 / 证据:025 | 无 | 已实现·待验证 |
| tts.文本输入 | label「文本」（页首下方） | textarea rows=5，默认空，可拖高 | 受控输入；无 maxLength（超限靠计数提示+禁用提交，不截断） | 无 | 规范:voice.md#TTS「主输入」 / 代码:TtsPage.tsx L239-248 / 证据:013-tts-loaded | 无 | 已实现·待验证 |
| tts.字符计数 | 计数行（文本框下） | 派生自文本与所选模型 maxChars | 五态：空(提示)/正常 `n / max 字符`/接近(>90% 琥珀)/正好等于/超出(红字)；状态驱动禁用 | 无 | 规范:voice.md#边界「等于边界、刚越界…均有用例」 / 代码:TtsPage.tsx L101-121 / 证据:025 | 无 | 已实现·待验证。**注意**：maxChars 值（10000/40000/5000/10000）硬编码于前端常量，未标注核验来源（记 gaps） |
| tts.模型选择 | label「模型」select（参数区上方） | 4 选项：Multilingual v2（默认）/Turbo v2.5/Eleven v3/Eleven v4，选项文本含语言数与上限 | 切换后重算参数可用性与计数上限；**语言数(29/32/70/90)与上限为前端硬编码，未标未验证** | 无 | 规范:voice.md#TTS「模型搜索/全列表」 / 代码:TtsPage.tsx L27-32,264-277 / 证据:016/017-tts-models | 无 | **不一致**：规范要求模型搜索+全列表弹层，代码为普通 select；数值未标核验状态 |
| tts.输出格式选择 | label「输出格式」select（模型旁） | 3 选项：MP3·44.1k·128（默认）/MP3·192（标注需更高权限，未核验）/PCM·44.1k（同前） | 选需权限格式出现琥珀提示「本地无法确认…提交前请确认」并禁用提交 | 无 | 规范:voice.md#TTS「输出格式」 / 代码:TtsPage.tsx L47-51,279-298 / 证据:025-tts-advanced | 无 | 已实现·待验证 |
| tts.稳定性滑块 | label「稳定性」range（参数卡片内） | 0–1 step0.01，默认 0.5；全模型支持 | 拖动更新数值；不支持该参数的模型上禁用并显示「当前模型不支持该参数，不会发送。」 | 提交时仅发送当前模型支持的字段 | 规范:voice.md#TTS「稳定性…及模型专属参数」+INTERACTIONS#参数「不支持字段不传给远端」 / 代码:TtsPage.tsx L34-45,304-309,417-455 / 证据:025 | 无 | 已实现·待验证 |
| tts.相似度滑块 | label「相似度」range | 0–1，默认 0.75；全模型支持 | 同上 | 同上 | 同上 / 代码:L310-314 / 证据:025 | 无 | 已实现·待验证 |
| tts.风格滑块 | label「风格」range | 0–1，默认 0；仅 Turbo v2.5/v3 | 同上（不支持时禁用） | 同上 | 同上 / 代码:L315-319 / 证据:025 | 无 | 已实现·待验证 |
| tts.语速滑块 | label「语速」range | 0.7–1.2 step0.01，默认 1.0；仅 v3/v4 | 同上 | 同上 | 同上 / 代码:L320-329 / 证据:025 | 无 | 已实现·待验证。范围 0.7–1.2 为代码常量，来源未标注（记 gaps） |
| tts.说话人增强复选框 | checkbox+「说话人增强」（参数卡片内） | 默认勾选；仅 Turbo v2.5/v3 | 不支持的模型上禁用（灰字）；提交时仅支持时携带 | 同上 | 规范:voice.md#TTS「说话人增强」 / 代码:TtsPage.tsx L331-341 / 证据:025 | 无 | 已实现·待验证 |
| tts.参数兼容说明 | 静态说明「不适用于当前模型的参数不会被发送…保留草稿文本」（参数卡片底部） | 无 | 静态 | 无 | 规范:voice.md#边界「跨模型参数不兼容提示并保留草稿」 / 代码:L342-344 / 证据:025 | 无 | 一致（说明与实现相符） |
| tts.音色搜索 | label「搜索音色」input（音色区） | 文本；默认空；按名称/ID/类别过滤；Provider 不可用时禁用 | 实时过滤列表（客户端）；与语言筛选叠加 | 无 | 规范:voice.md#TTS「音色搜索」 / 代码:VoicePicker.tsx L60-71,86-95 / 证据:019/020-tts-voices | 无 | 已实现·待验证 |
| tts.语言筛选 | label「语言」select（搜索旁） | 默认「全部（N）」；选项来自音色 labels 键并映射中文名 | 过滤列表；无语言时禁用 | 无 | 同上 / 代码:VoicePicker.tsx L54-58,97-112 / 证据:019 | 无 | 已实现·待验证。语言中文映射表为代码常量（27 种），来源未标注 |
| tts.音色卡片单选 | role=radiogroup aria-label「音色」，卡片 role=radio aria-checked（列表区） | 默认未选 | 点击选中（高亮边框）；卡片内含 `<audio controls preload="none">` 预览（点击不冒泡）；滚动容器 max-h-96；禁用态整组 opacity | 无付费（预览 URL 由本地服务端代理提供） | 规范:voice.md#TTS「音色…选择/预览」 / 代码:VoicePicker.tsx L143-192 / 证据:019/020 | 无 | 已实现·待验证 |
| tts.音色列表错误/空态 | 琥珀提示（无法读取原因或 needsProvider 文案）/红提示（已选音色不在列表，**不静默换声**）/虚线空态 | 无 | 条件渲染；needsProvider 时显示固定文案 | 无 | 规范:voice.md#边界「当前选声不存在/被删除/不可访问不静默换声」 / 代码:VoicePicker.tsx L115-141 / 证据:020 | 无 | 已实现·待验证（三方一致，重点行为） |
| tts.手动输入音色ID | `<details>` summary「手动输入音色 ID」+input（列表下方；本地提案） | 文本；无校验 | 展开后可输入任意 voiceId 直写选中值 | 无 | 规范：未覆盖（候选增补） / 代码:VoicePicker.tsx L194-203 / 证据:无 | 无 | 代码超前·候选规范增补 |
| tts.费用未知提示 | 警告条「费用未知，不会显示为 0」（提交区上方；本地提案） | 无 | 静态 | 无 | 规范:BYOK（费用披露）/AGENTS#红线 / 代码:TtsPage.tsx L358-361 / 证据:无 | 无 | 本地提案·已实现 |
| tts.费用确认复选框 | checkbox「我了解这次提交会产生费用，但金额未知，并同意向 {baseURL} 发送上述文本。」（提交区上方） | 默认不勾 | 不勾则提交禁用；文本动态含 provider baseURL | 无直接副作用 | 规范:AGENTS#BYOK「费用未知…须确认」 / 代码:L362-372 / 证据:无 | 无 | 本地提案·已实现 |
| tts.生成语音按钮 | 「生成语音」/「提交中…」（提交区） | disabled 见页首禁用链 | 点击 `jobs.create({intentId,…})`；intentId= `tts:{provider}:{model}:{voice}`，重复点击服务端按 intent 去重（同一本地任务，不二次提交）；提交后 1.2s 轮询 `jobs.list()` | 创建本地任务→服务端代理调 Provider（费用未知）；**不自动重试付费提交** | 规范:voice.md#TTS「生成/任务」+INTERACTIONS「双击同一提交意图只创建一个本地任务」 / 代码:TtsPage.tsx L140-204,376-386 / 证据:025 | 无 | 已实现·待验证。**缺陷**：轮询成功后取 `assets.list()[0]`（素材库第一条）当产物，未用 `job.outputAssetIds` 定位，可能展示错误产物（记 gaps） |
| tts.取消任务按钮 | 「取消」（任务面板右上，仅可取消状态显示） | 无 | 点击 `jobs.cancel(id)`；失败转红色提示；取消范围由服务端 scope 说明（页面未展示 scope 文案） | 请求停止本地等待；不等于供应商撤销/退款 | 规范:INTERACTIONS#持久化并发「取消只停止本地等待」 / 代码:TtsPage.tsx L389-396,457-483 / 证据:无 | 无 | 已实现·待验证（服务端行为契约见 server） |
| tts.任务面板 | 「任务 {status}」+本地任务 ID 前 8 位+去重说明+错误行（提交区下） | 无 | 条件渲染；终态停止轮询（含 unknown_submission） | 无 | 规范:INTERACTIONS#状态登记「任务提交/运行/未知/失败」 / 代码:L199-204,457-483 / 证据:无 | 无 | 已实现·待验证 |
| tts.产物播放 | `<audio controls>`（产物区） | 无 | 成功后显示；src 为受控 URL | 无自动播放 | 规范:INTERACTIONS#播放「不自动播放」 / 代码:L398-401 / 证据:无 | 无 | 已实现·待验证；产物定位缺陷同上 |
| tts.产物下载 | 「下载 {name}」（产物区） | 无 | `<a download>` 受控 URL | 无 | 规范:voice.md#TTS「下载」 / 代码:L402-408 / 证据:无 | 无 | 已实现·待验证 |
| tts.设置/历史入口 | —— | —— | —— | —— | 规范:voice.md#TTS「设置/历史」「历史菜单」 / 代码:无 / 证据:021-tts-history | 无 | **规范要求·未实现** |

## 汇总

26 个登记项：不一致 2（模型搜索/全列表缺失、设置/历史缺失）；代码超前 1（手动音色 ID）；本地提案 3（费用三件套之两件+提示）；缺陷 1（产物定位取素材库第一条）；视觉复刻未做（整页与 025 截图布局无对齐记录）。
