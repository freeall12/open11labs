# 视觉复验对照表（共享证据映射）

四个并行 Agent 做「一比一」保真时**共用这一份映射**，避免各自重复研究、各自漂移。
参考图为**只读**参考：只用于比对几何与控件，**不得**从中拷贝资产入库。

证据目录：`research/elevenlabs-2026-10-02/`
- `screenshots/*.png` —— 渲染截图，看几何/控件/间距
- `snapshots/*.txt` —— a11y 树，**看控件清单与标签比看图更精确**，优先读它
- `interaction-findings.md` —— 实测交互结论
- `buttons.csv` —— 控件清单

## 页面 → 参考证据

| 路由 | 中文名 | 参考截图 ID | 备注 |
|---|---|---|---|
| `/app/home` | 主页 | 001, 002 | 002 是无弹层参考态 |
| `/app/voice-library` | 音色 | 027, 038, 039 | 038/039 是筛选面板开合 |
| `/app/voice-library?action=create` | 创建音色 | 030, 034 | 030 是类型菜单 |
| `?creationType=cloneVoice` | 即时克隆 | 031, 032, 033 | |
| `?creationType=voiceDesign` | 声音设计 | 035, 036, 037 | |
| `/app/voice-lab` | 我的音色 | 040, 041 | |
| `/app/speech-synthesis/text-to-speech` | 文本转语音 | 013, 015, 016, 017, 018, 019, 020, 021, 022, 023, 024, 025 | 面板/模型/音色/历史/高级 |
| `/app/speech-synthesis/speech-to-speech` | 变声器 | 100, 101, 102, 103 | |
| `/app/voice-isolator` | 人声分离 | 097, 098 | 098 仍是 loading 态 |
| `/app/speech-to-text` | 语音转文本 | 104, 105, 106, 107, 108, 109, 110, 110b | **106 是核心：转录文件弹层** |
| `/app/speech-to-text/speakers` | 说话者 | 111, 112 | 112 仅骨架屏，稳定态未采 |
| `/app/dubbing` | 配音 | 113, 114, 115, 116, 117, 118 | |
| `/app/sound-effects` | 音效 | 088, 089, 090, 091, 092 | |
| `/app/sound-effects/history` | 音效历史 | 093, 094 | |
| `/app/sound-effects/favorites` | 音效收藏 | 095, 096 | |
| `/app/music` | 音乐 | 074, 075, 076, 077, 078, 079, 080, 081, 082, 083, 084 | 075 默认落在**市场**（已按 SCOPE 移除） |
| `/app/music/history` | 音乐历史 | 078, 079 | |
| `/app/music/saved` | 音乐收藏 | 081, 082 | |
| `/app/music/finetunes` | 音乐微调 | 083, 084 | |
| `/app/image-video` | 图像/视频/口型 | 119, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 131 | 按 `?modality=` 取 |
| `/app/image-video/history` | 生成历史 | 130, 131 | |
| `/app/studio` | 工作室 | 046, 047, 048, 049, 050 | 050 是创建者筛选（**已按 SCOPE 移除**） |
| `/app/studio/templates` | 工作室模板 | 047 | 仅入口，**无整页证据** |
| `/app/flows` | Flows | 051, 052, 053, 054, 055 | 053 是 onboarding |
| `/app/flows/:id` | Flow 画布 | 056, 057, 058, 059, 060, 061 | **058 是核心画布** |
| `/app/creative-agent` | 聊天 | 062, 063, 064, 065 | 065 是引用面板 |
| `/app/creative-agent/chats/:id` | 会话 | 064 | 仅入口 |
| `/app/files` | 素材 | 066, 067, 068, 069, 070, 071 | 070 是新建文件夹弹层 |
| `/app/files/brand-kits` | 品牌套件 | 072, 073 | |
| `/app/audiobooks` | 有声书 | 132, 133 | 133 为 partial-loading |
| `/app/audio-detector` | 音频检测 | 005 | 仅入口，**无整页证据** |
| `/local/settings/providers` | Provider 与密钥 | — | **本地扩展，非复刻** |
| `/local/settings/storage` | 存储设置 | — | **本地扩展** |
| `/local/jobs` | 任务队列 | — | **本地扩展** |
| 全局壳 | 侧栏/顶栏/搜索 | 001, 005, 008, 009, 009b, 009c, 010, 011 | 010/011 全局搜索 |
| 更多工具 | — | 003 | |

## 已按 SCOPE 移除，比对时必须先裁掉

对照前先遮罩/裁掉这些区域，否则会为了「对齐」而把被排除的内容加回来：

- 侧栏底部的账号/平台切换（原站「ElevenCreative / 切换」）+ 头像
- 顶栏的积分胶囊、账号通知铃铛、头像
- 主页的营销轮播（`004-banner-click-blocked`）
- 音色库的「收入」按钮 → 收益/打款/分析/机会四个页面（042-045）
- 音乐的「市场」与「已发布」（075, 085, 086）
- 工作室的「创建者」筛选与「所有者」列（050）
- 全部 `/app/subscription`、`/app/payouts`、`/app/workspace`、`/app/settings`、
  `/app/developers`、`/app/usage`、`/app/iconic-voices`、
  `/app/voices-earnings/*`、`/app/music/published`

移除后**连续布局**，不留空槽、不留 disabled 假入口。

## 比对方法（省时间且不容易自我欺骗）

1. **先读 `snapshots/*.txt` 的 a11y 树**拿到控件清单、标签、顺序 —— 比盯像素准
2. **再看截图**只比对：外边距、控件尺寸/圆角、字重字阶、栅格列数、层级
3. **视口必须一致**：参考 PNG 实测是 **1500×759**（不是 1512×900，早期版本文档写错过）。
   横向比对请按比例缩放，或把本地页面也截成 1500×759 再比 D1
4. **不要比对渲染出来的文字内容**，只比对结构。参考站是真实账号的数据（`chen`、
   gmail 出现在部分截图里），本地是空状态，**内容不同是正常的**

## 工具

用你自己的 `mcp__chrome-devtools__*` 跑真实浏览器：

```
navigate → http://127.0.0.1:5178/<route>
resize_page 1512 900
take_snapshot          # 控件清单
take_screenshot        # 几何
```

**不要**用 `scripts/visual-audit.mjs`：它在本机 exFAT 外置盘上每页约 20 秒，
串行 30 页要 10 分钟。各自用 MCP 浏览器并行快得多。

如果本地服务没起：
```bash
cd /Volumes/YANG/11 && npm run build && (PORT=5178 node server/cli.mjs serve &)
```
端口冲突时换 `PORT=5199` 并同步改 URL。**不要 `pkill` 别人的服务进程**。

## 红线（对每个 Agent 生效）

- 不 commit / push / reset / clean / stash
- 只改自己那一个目录，越界写进报告
- 不编造控件、不编造模型名/能力/时长/价格
- 无密钥即无真实调用；能力未核验就标「未验证」并禁用到有理由为止
