# ElevenLabs BYOK Local — 创作工具复刻

> 当前开发范围与交接：见 [AGENTS.md](AGENTS.md)、[文档入口](docs/README.md)、[范围裁剪](specs/SCOPE.md)。**原站全部营销与账号相关内容已明确排除**；保留创作工具及本地BYOK配置。给实施Agent的启动提示词见 [GOAL_PROMPT.md](GOAL_PROMPT.md)。
>
> 以下为既有首页原型的历史实现说明，不代表全站/BYOK后端已完成；后续以spec与实际验收记录为准。

对 `elevenlabs.io/app/home` 的 1:1 前端复刻，纯源码实现。

**范围**：仅首页（App 外壳 + 首页内容）。营销横幅按要求不复刻。

---

## 运行

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # 产物在 dist/
npm run typecheck
```

技术栈：Vite 7 + React 19 + TypeScript + Tailwind CSS v4。

---

## 忠实度：实测对照表

下表每一行都是用浏览器实测 `getBoundingClientRect()` 得到的，不是目测。

| 测量项 | 真实站点 | 本复刻 | 状态 |
|---|---|---|---|
| 顶栏高度 | 50px（由开关按钮 y=5 h=40 反推） | 50px | ✅ |
| 顶栏开关按钮位置 | x=10, y=5, 40×40 | x=10, y=5, 40×40 | ✅ 完全一致 |
| 顶栏右侧铃铛 | x=909, y=7, 36×36 | 同上 | ✅ |
| 侧边栏展开宽度 | 256px（由导航项 231px 反推） | 256px | ✅ |
| 侧边栏导航项宽度 | 231px | 231px | ✅ 完全一致 |
| 侧边栏导航项左边距 | x=12 | x=12 | ✅ |
| 提示框内容区 x | 261 | 261 | ✅ 完全一致 |
| 提示框内容区宽度 | 417 | 417 | ✅ 完全一致 |
| 提示框最大宽度 | 650px | 650px | ✅ |
| 提示框内容区高度 | 52px | 52px | ✅ |
| 工具卡内容宽度 | 81px（点击区 97px） | 81px（点击区 97px） | ✅ |
| 工具卡数量（宽屏） | 8 | 8 | ✅ |
| 主内容左偏移（侧边栏展开） | — | 268px = 256 + 12(p-3) | ✅ |

### 设计令牌

`src/index.css` 中的所有数值均从生产样式表 `3b7xev0_eu9bg.css` 提取，非目测近似：

- **灰阶** `--gray-50 … --gray-950`：22 级，裸 HSL 通道值（与原站一致，便于 `hsl(var(--x) / <alpha>)` 组合）
- **透明灰** `--gray-alpha-50 … --gray-alpha-950`：22 级，8 位十六进制；浅色为黑低透明，深色为白低透明（`--darken-*` / `--lighten-*`）
- **语义令牌**：`--background` `0 0% 100%`、`--foreground` `240 3% 6%`、`--secondary` → `darken-500`、`--subtle` → `darken-450`、`--border` → `gray-alpha-150`
- **签名阴影** `--shadow-natural-xs`：`0 0 0 1px / 0 1px 1px -.5px / 0 3px 3px -1.5px`，全部 `#0000000f`
- **自定义工具类**：`stack` `hstack` `center` `no-scrollbar` `scroll-subtle` `focus-ring` — 定义与原站逐条对齐

---

## 美术资源：全部来自源站，非手绘

字体和图标都是**从源站抓下来的真实资源**，不是自己画的。

### 字体

`public/fonts/` 下 4 个 woff2，共 161KB，从生产样式表
`19le4vtp6prk5.css` 的 `@font-face` 声明里解析出真实 CDN 路径后下载：

| 文件 | 字重 |
|---|---|
| `Waldenburg_Regular-s.p.43r3ozarrunyz.woff2` | 400 |
| `Waldenburg_Medium-s.p.0dk8kt88f3bhr.woff2` | 500 |
| `Waldenburg_Bold-s.p.3x8ofswqwnzku.woff2` | 700 |
| `Waldenburg_Bold_SemiCondensed-s.p.1xwtlv9quw8fr.woff2` | 700 (HF) |

### 图标

`src/lib/icons.tsx` 是**生成文件**，23 个图标全部由工具从源站 JS bundle 里
提取真实 path/circle 几何后产出：

```bash
node tools/fetch-bundles.mjs   # 下载两个图标库 bundle
node tools/build-icons.mjs     # 生成 src/lib/icons.tsx
```

站点有两套图标库，两套都已在工具里支持：

| Bundle | 图标数 | 包装器 | 判定依据 |
|---|---|---|---|
| `1ez0d0on-xxdx.js` | 1816 | `width=18 viewBox="0 0 18 18"` + `strokeWidth 1.5` | `displayName="X"` |
| `07el4lpsvg9qo.js` | 219 | `size`/`color` props，path 自带 `strokeWidth` | `"X",0,function({size:` |

**图标归属经过真实 DOM 交叉验证**，不是按名字猜的：

- 语音克隆 → `NavVoicesIcon`（真实 DOM 为 4 个 `<path>`，库内仅此图标元素数为 4 且视觉吻合）
- 图像 → `ImageIcon`（真实 DOM 为 1 个 `<path>`，库内同为 1）
- 更多 → `CircleEllipsisHorizontalIcon`（真实 DOM 为 1 path + 3 circle，提取结果完全一致）

`tools/icon-sheet.mjs` 可把任意候选图标渲染成对照表，用于肉眼比对：

```bash
node tools/icon-sheet.mjs tools/icons-bundle.js /tmp/sheet.html PlusIcon MicIcon ...
```

---

## 已知边界（未还原部分）

## 目录结构

```
src/
  index.css          设计令牌（灰阶/透明灰/语义/阴影/工具类）
  fonts.css          Waldenburg 度量兼容回退
  App.tsx            外壳：侧边栏 + 顶栏 + 内容偏移
  components/
    TopBar.tsx       顶栏（开关 / 标题 / 通知 / 头像）
    Sidebar.tsx      可折叠侧边栏（主导航 + 已置顶）
    HomePage.tsx     首页布局
    PromptBar.tsx    提示输入栏（canvas 动态头像 + Alpha 徽章）
    ToolGrid.tsx     8 个工具入口
    RecentsPanel.tsx 最近 / 快速入门双标签 + 搜索 + 布局切换
    AnimatedAvatar.tsx  canvas 多色渐变动效
  data/              导航、工具、最近项数据
  lib/icons.tsx      图标集（生成文件，勿手改）
```

---

## 下一步

按你的节奏继续。可选方向：

- 复刻「网格视图」与模板缩略图
- 接 BYOK 层：把 `src/data/` 换成真实数据源
- 复刻下一个页面（工作室 / 音色库 / Flows）
