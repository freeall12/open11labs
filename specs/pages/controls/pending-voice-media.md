# 待实现登记（骨架）：音色库 / 音乐 / 各历史收藏页 / 说话者 / 音频检测

> **无代码证据（除注明占位路由外），来源仅为规范草案。** 本文件所列路由在 qa worktree HEAD `7ed2f05` 均为 ScopeNotice 占位页；状态一律「未实现/待补采」。主工作树在途未提交的音色库/音乐新页面**不采信**。规范依据：`specs/pages/voice.md`、`specs/pages/media.md`。

## 音色库与音色管理（规范：voice.md#音色探索/我的音色、#创建音色）

| 路由 | 证据 | 现状 | 规范要求控件（全部未实现） |
|---|---|---|---|
| voices-explore /app/voice-library | 027-voice-library（observed） | 占位 | 音色搜索；语言/类别/性别/年龄/质量等筛选；排序；列表/集合；详情；预览；选择；收藏/移除；本地集合 |
| voice-create-query ?action=create | 030-create-voice-options（observed） | 占位（query 无组件消费） | 创建类型选择（克隆/设计/…） |
| instant-clone ?creationType=cloneVoice | 032-instant-clone-form（observed） | 占位 | 即时克隆：上传/录音/确认/下一步；素材权利与声音许可确认（未确认禁止提交——红线） |
| voice-design ?creationType=voiceDesign | 035-voice-design（observed） | 占位 | 声音设计：提示/预览/设置/生成/保存 |
| voice-create-alias /app/create-voice | 015-tts-settings（entry-only） | 占位 | 与 create-query 归并的别名页，路径待与原站行为比对 |
| my-voices /app/voice-lab | 041-my-voices-loaded（observed） | 占位 | 我的音色管理（同探索页操作子集+删除/本地集合） |
| voice-collection /app/voice-library/collections/:id | 027（entry-only） | 占位 | 合集页（动态路由，详情未采） |
| iconic-voices、voices-earnings/* | —— | **范围外已移除**（excluded，重定向 /app/out-of-scope），不实现、不补采 | —— |

待补证据：私有/公共声音库 API 权限；混音/专业克隆 API 与审批；账户收益标签已排除。

## 音乐（规范：media.md#音乐行，证据 074–086）

| 路由 | 证据 | 现状 |
|---|---|---|
| music /app/music | 075-music-page（observed；adaptation=移除市场，默认本地生成器） | 占位 |
| music-history / music-saved | 079 / 082（observed） | 占位 |
| music-finetunes | 084（observed） | 占位 |
| music-published | —— | **范围外已移除**（excluded），不实现 |

未实现控件（规范要求）：提示/风格/歌词/参考；纯器乐开关；变体；时长/模型选择；生成/保存；本地历史与曲目编辑/分段/导出；微调（仅公开能力允许）。待验证：音乐创建/查询/编辑/许可接口、长任务状态、每种参数默认值。市场/商用销售/发布不复制。

## 历史/收藏类页面（规范：voice.md / media.md）

| 路由 | 证据 | 现状 |
|---|---|---|
| sfx-history / sfx-favorites | 094 / 096（observed） | 占位（音效生成页内有会话级历史，见 media-sfx.md） |
| media-history /app/image-video/history | 131（**partial-loading**） | 占位，且证据不完整**待补采** |

未实现控件：历史列表/搜索/行菜单/重下原成果；本地历史与供应商历史分别标来源（红线：provider 断网仍可查看已存输出）。

## 说话者页 / 音频检测

| 路由 | 证据 | 现状 |
|---|---|---|
| speakers /app/speech-to-text/speakers | 112（**partial-loading**） | 占位，**待补采** |
| audio-detector /app/audio-detector | 005-profile-menu（entry-only） | 占位；规范注明「仅入口，先补采；如属商业账户功能则按 SCOPE 排除并说明」 |

## STT 上传主页

`stt /app/speech-to-text`（证据 106，observed）：上传/录制/URL 入口、语言选择、音频事件/字幕/逐字/说话人分配/关键术语、编辑器与导出全部未实现（功能性对照见 voice-stt.md；其中 YouTube 转写已写但不可达）。
