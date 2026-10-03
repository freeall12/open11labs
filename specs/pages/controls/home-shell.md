# 控件登记表：全局壳 + 首页 + 状态页

- 代码基准：`/Volumes/YANG/11-worktrees/qa` HEAD `7ed2f05`，文件 `src/app/AppShell.tsx`、`src/components/{Sidebar,TopBar,HomePage,PromptBar,RecentsPanel,ToolGrid,AnimatedAvatar}.tsx`、`src/data/{navigation,tools,recents}.ts`、`src/app/{StatusPages,nav-titles,route-manifest,router}.tsx|.ts`。
- 规范：`specs/pages/shell.md`（R1/R8）、`specs/SCOPE.md`、`specs/INTERACTIONS.md`。
- 证据：routes.json `home` → `001-home`（coverage: observed）；shell.md 引用 001–011。
- 口径：三方核对=规范 shell.md / 代码 HEAD / 证据 001–011。状态列不含「实测」：本表为纯文档核对。

## 页面状态

- **默认**：侧栏展开（lg 视口，`data-sidebar-open=false` 初始为 false 但 CSS 默认展开宽度，折叠由顶栏按钮切换）；首页 Tab=最近，布局=列表。
- **加载**：壳层与首页为纯静态渲染，无加载态。
- **空**：最近/快速入门为硬编码演示数据（`src/data/recents.ts` 注释明示占位），无真实空态分支。
- **错误**：404（未注册路径）与范围外重定向页，见下。
- **范围外移除事实**：`/app/settings`、`/app/workspace`、`/app/subscription`、`/app/payouts`、`/app/developers`、`/app/developers/analytics/usage`、`/app/iconic-voices`、`/app/voices-earnings/*`、`/app/music/published` 共 10 条 excluded 路由由 `route-manifest.ts` 重定向到 `/app/out-of-scope`，不渲染任何账户 UI（`StatusPages.tsx`）。

## 弹层

HEAD 无任何弹层/Popover/Drawer 实现。规范要求的全局搜索命令弹层、添加引用菜单、更多工具菜单、帮助面板、反馈弹窗均未实现（见 gaps）。

## 草稿持久化

无。侧栏开合、提示输入、Tab/布局选择均为组件内 `useState`，刷新即失。规范要求侧栏偏好本地保存（shell.md「展开/收起侧栏→本地保存用户偏好」）——**不一致**。

## 控件表

| 操作ID | 标签/aria（位置） | 输入·默认值·边界 | 交互结果 | 副作用·API/本地 | 三方核对（规范/代码/证据） | 测试ID | 状态 |
|---|---|---|---|---|---|---|---|
| shell.侧边栏开关按钮 | aria-label「打开/关闭侧边栏」、aria-expanded（顶栏左侧，50px 高） | 无输入 | 点击切换 `sidebarOpen`；顶栏 padding 150ms 过渡；`focus-ring` 键盘可达 | 无副作用；不持久化（规范要求本地保存偏好——不一致） | 规范:shell.md#展开收起侧栏 / 代码:TopBar.tsx+AppShell.tsx / 证据:001-home | `topbar-sidebar-toggle`（全 HEAD 唯一 data-testid） | 已实现·待验证 |
| shell.顶栏页标题 | 纯文本 `<p>`（顶栏） | 无 | 随 pathname 由 `nav-titles.ts` 显示；不可交互 | 无 | 规范:shell.md#应用壳（页标题需真实响应） / 代码:nav-titles.ts / 证据:001-home | 无 | 已实现·待验证 |
| shell.主导航项 | 6 项：主页/音色/工作室/Flows/聊天/素材（侧栏上部） | 无 | `<a href>` 真实路由跳转（react-router 未拦截，整页导航）；hover 变底色；**active 写死「主页」** | 无付费请求 | 规范:shell.md#应用壳「active 写死主页须改为路由匹配」+「工具置顶…激活状态需真实响应」 / 代码:Sidebar.tsx `active={item.label==="主页"}` / 证据:001-home | 无 | **不一致**：导航可用但激活状态未按路由匹配（规范明确要求整改项） |
| shell.本地配置导航项 | 3 项：Provider 与密钥/存储设置/任务队列（侧栏「本地配置」组；本地提案） | 无 | `<a href>` 至 /local/* 三页（已实现，见 provider-settings.md） | 本地配置，无云端调用 | 规范:assets-local.md#本地扩展表 / 代码:navigation.ts LOCAL_NAV / 证据:无（本地扩展无原站证据，属本地提案） | 无 | 本地提案·待验证 |
| shell.已置顶导航项 | 10 项：文本转语音/创建音色/音效/图像和视频/人声分离/变声器/音乐/语音转文本/配音/有声书（「已置顶」组） | 无 | `<a href>` 均指向已注册路由；**图标全部复用 IconStudio 占位** | 无 | 规范:shell.md#应用壳（工具置顶） / 代码:navigation.ts PINNED_NAV / 证据:001-home 侧栏结构 | 无 | 已实现·待验证；图标与原站不一致（待补采原图标，视觉验收前需处理） |
| shell.更多工具按钮 | aria-label「更多工具」（「已置顶」组末尾） | 无 | **`<button>` 无 onClick，点击无任何结果** | 无 | 规范:shell.md#操作登记「更多工具→菜单列模板/Audio Native/作品/广告引擎及pin」 / 代码:Sidebar.tsx L84-98 / 证据:003-more-tools | 无 | **不一致**：规范要求菜单，代码是死按钮 |
| home.页标题 | 「你想创建什么？」（首页顶部） | 无 | 静态展示 | 无 | 规范:shell.md#首页 / 代码:HomePage.tsx / 证据:001-home | 无 | 一致（静态） |
| home.动态创作图标 | 无 aria（提示框左侧装饰动画） | 无 | 装饰动画，不可交互 | 无 | 规范:shell.md#首页「动态创作图标（非账户头像）」 / 代码:AnimatedAvatar.tsx / 证据:001-home | 无 | 一致（装饰） |
| home.添加引用按钮 | aria-label「添加引用」、title「添加文件、生成内容等」（提示框内 +） | 无 | **无 onClick，点击无结果** | 无 | 规范:shell.md#首页「添加引用菜单实测有上传/浏览素材/创建品牌套件；选择引用显示chip，可移除」 / 代码:PromptBar.tsx L24-31 / 证据:002-home-reference（点击有回执的观察） | 无 | **不一致**：规范要求引用菜单+chip，代码是死按钮 |
| home.提示输入框 | `<textarea id="prompt">`，sr-only label，placeholder「创建一则带旁白的产品广告…」（提示框中央） | 文本；默认空；高度 52px 起、最高 200px | 受控输入可打字；无长度上限校验；无草稿持久化 | 无（发送另计） | 规范:shell.md#首页「提示输入」 / 代码:PromptBar.tsx L34-45 / 证据:001-home | 无 | 已实现·待验证（持久化缺失记 gaps） |
| home.Alpha徽标 | 文本「Alpha」（提示框右侧） | 无 | 静态徽标 | 无 | 规范:shell.md#首页「功能徽标」 / 代码:PromptBar.tsx L49-51 / 证据:001-home | 无 | 一致（静态） |
| home.听写按钮 | aria-label「开始听写」（提示框右侧麦克风） | 无 | **无 onClick，点击无结果；不请求设备授权** | 无 | 规范:shell.md#首页「听写请求浏览器设备授权，拒绝/无设备/断开保持输入」 / 代码:PromptBar.tsx L53-59 / 证据:001-home | 无 | **不一致**：死按钮 |
| home.发送按钮 | aria-label「发送」（提示框右侧↑） | 无；输入为空/纯空白时 disabled（灰底） | **空输入禁用已实现；但启用后点击仍无结果（无 onClick/无提交）** | 规范要求提交后导航聊天并发起任务（需费用确认）——未实现 | 规范:shell.md#首页「输入为空禁用发送；提交后导航到聊天/任务」 / 代码:PromptBar.tsx L61-68（`canSend` 有、handler 无） / 证据:001-home | 无 | **不一致**：半实现（禁用态真实，提交缺失） |
| home.工具卡-语音 | sr-only「语音」（工具格第 1 卡，图标 IconWaveform） | 无 | `<a href="/app/speech-synthesis/text-to-speech">` 整卡命中区跳转 TTS 页 | 无 | 规范:shell.md#操作登记「主导航与工具卡→进入目标真实页面」 / 代码:tools.ts HOME_TOOLS / 证据:001-home | 无 | 已实现·待验证 |
| home.工具卡-音乐 | sr-only「音乐」（第 2 卡） | 无 | `<a href="/app/music">` → 音乐页（HEAD 为 ScopeNotice 占位页） | 无 | 同上 / 代码:tools.ts / 证据:001-home | 无 | 已实现·待验证（目标页未实现，见 pending-voice-media.md） |
| home.工具卡-语音克隆 | sr-only「语音克隆」（第 3 卡） | 无 | `<a href="/app/voice-library?action=create&creationType=cloneVoice">` → 音色库占位页（query 参数无组件消费） | 无 | 同上 / 代码:tools.ts / 证据:031-instant-clone | 无 | 已实现·待验证（目标页未实现） |
| home.工具卡-图像 | sr-only「图像」（第 4 卡） | 无 | `<a href="/app/image-video?modality=image">` → 图像模式 | 无 | 同上 / 代码:tools.ts / 证据:122-image-form | 无 | 已实现·待验证 |
| home.工具卡-视频 | sr-only「视频」（第 5 卡） | 无 | `<a href="/app/image-video?modality=video">` → 视频模式 | 无 | 同上 / 代码:tools.ts / 证据:124-video-mode | 无 | 已实现·待验证 |
| home.工具卡-配音 | sr-only「配音」（第 6 卡） | 无 | `<a href="/app/dubbing">` → 配音页（已实现） | 无 | 同上 / 代码:tools.ts / 证据:114-dubbing-home | 无 | 已实现·待验证 |
| home.工具卡-虚拟形象 | sr-only「虚拟形象」（第 7 卡） | 无 | `<a href="/app/avatar">` → **404 页**（routes.json 无 avatar 路由，media.md 仅证据 128 且未建路由） | 无 | 规范:media.md#虚拟形象（保留操作；路由未登记） / 代码:tools.ts / 证据:128（观察） | 无 | **不一致**：入口通向 404；规范要求进入目标真实页面 |
| home.工具卡-更多 | sr-only「更多」（第 8 卡） | 无 | `<button>` **无 onClick，死按钮**（tools.ts `href:null`，代码注释称「opens a menu」但菜单未实现） | 无 | 规范:shell.md#操作登记「更多工具菜单」 / 代码:ToolGrid.tsx L39-42 / 证据:003-more-tools | 无 | **不一致**：死按钮 |
| home.最近/快速入门Tab | role=tab「最近」「快速入门」（最近区顶部） | 默认「最近」 | 点击切换 `aria-selected` 与面板，真实生效；选择不持久化 | 无 | 规范:shell.md#首页「最近/功能模板区」 / 代码:RecentsPanel.tsx TABS / 证据:001-home | 无 | 已实现·待验证 |
| home.最近搜索框 | input type=search，aria-label=placeholder「搜索最近内容...」（Tab 下方） | 文本；默认空 | **无受控 state、无过滤逻辑：输入后列表不变（死输入）**；清除按钮被 CSS 隐藏 | 无 | 规范:shell.md#首页「最近列表/网格、搜索…不能留空handler」+「搜索/过滤→输入、清除、无结果」 / 代码:RecentsPanel.tsx SearchField（无 value/onChange） / 证据:010-global-search（全局搜索，非本框） | 无 | **不一致**：空 handler |
| home.快速入门搜索框 | 同上，placeholder「搜索快速入门…」 | 同上 | 同上，**死输入** | 无 | 同上 / 代码:RecentsPanel.tsx / 证据:011-search-query | 无 | **不一致**：空 handler |
| home.布局切换 | role=group aria-label「查看布局」，两按钮 aria-label「列表视图」「网格视图」（仅最近 Tab 显示） | 默认列表 | 点击切换 `aria-pressed`，列表/网格容器切换真实生效；**网格视图显示文案「网格视图尚未还原」**（诚实占位，非假成功） | 无 | 规范:shell.md#首页「最近列表/网格」 / 代码:RecentsPanel.tsx LayoutToggle / 证据:001-home | 无 | 已实现·待验证（网格视图本身待补采） |
| home.最近列表行 | 6 行演示数据（标题/分类/时间，行整体为 `<a>` 命中区） | 无 | 链接至 /app/sound-effects/history、/app/flows、/app/dubbing、/app/speech-synthesis/text-to-speech 等；hover 变底色 | 无 | 规范:shell.md#首页「数据来自本地仓库，默认空态或显式演示，不使用账号原数据」+「项目菜单」 / 代码:recents.ts（硬编码演示数据）+RecentsPanel.tsx / 证据:001-home | 无 | 已实现·待验证；**不一致点**：数据未接本地仓库（显式演示可接受，但项目菜单缺失） |
| home.快速入门卡 | 9 张模板卡（311:175 占位图+底部标题） | 无 | `<a href="/app/templates/1…9">` → **全部 404**（无 /app/templates 路由；模板工具 path=null 待补采） | 无 | 规范:shell.md/editors.md#模板（path=null 不得猜 URL） / 代码:RecentsPanel.tsx QUICK_STARTS / 证据:003-more-tools | 无 | **不一致**：9 个入口全通向 404 |
| 404.返回主页 | 「返回主页」（NotFoundPage） | 无 | `<Link to="/app/home">` 客户端路由返回 | 无 | 规范:INTERACTIONS#导航「404不静默显示首页」 / 代码:StatusPages.tsx / 证据:无（本地提案行为） | 无 | 本地提案·待验证 |
| oos.返回主页 | 「返回主页」（OutOfScopePage，显示排除原因） | 无 | 同上；页面说明排除依据，不渲染账户 UI | 无 | 规范:SCOPE.md+assets-local.md「旧 /app/settings 等账户路径不渲染账户组件」 / 代码:StatusPages.tsx+route-manifest.ts / 证据:无 | 无 | 本地提案·待验证 |

## 汇总

- 29 个登记项中：**不一致 10 项**（主导航 active、更多工具按钮、添加引用、听写、发送半实现、虚拟形象卡 404、更多卡死按钮、两个搜索框空 handler、快速入门卡 404）；本地提案 3 项；其余已实现·待验证。
- 规范要求且完全缺失的壳层能力（不占用控件行，统一记 [gaps.md](gaps.md)）：全局搜索命令弹层（010/011 证据）、帮助/提问面板（008/009）、反馈弹窗（007）、本地主题/设置入口、面包屑、折叠侧栏 tooltip、移动端视口、暗色模式。
