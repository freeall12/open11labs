# ElevenLabs BYOK Clone — 首页前端复刻

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

## 已知边界（未还原部分）

以下几项**没有**做到 1:1，如实标注：

1. **Waldenburg 字体**
   标题字体是 ElevenLabs 的专有字体（`Waldenburg_*.woff2`），未打包。本仓库内置了从原站 `@font-face` 提取的**度量兼容回退**（`ascent-override: 89.65%`、`descent-override: 22.9%`、`size-adjust: 106.97%`），行高与视觉尺寸对齐，但字形不同。
   如需真字体：把授权文件放入 `public/fonts/`，取消 `src/fonts.css` 中的注释。

2. **图标 path 数据**
   浏览器的 DOM 查询层会剥离 SVG 的 path 几何数据（只返回元素标签，如"更多"= 1 个 `path` + 3 个 `circle`）。图标按可见形状手写为 24×24 / currentColor 等价图形，**结构对齐、几何为近似**。有原始资源时替换 `src/lib/icons.tsx` 里的 `d` 即可。

3. **营销横幅**
   按你的批注不复刻。`HomePage.tsx` 中对应位置留了注释锚点。

4. **最近列表的网格视图**
   列表视图已还原；切到网格视图时显示占位文案，尚未还原。

5. **快速入门模板缩略图**
   卡片栅格结构已还原（3 列、311×175、12px 间距、底部标题遮罩），缩略图为占位渐变。

6. **垂直节奏**
   原站用 `9dvh` 做首屏留白，该值随视口高度变化。两页对比时视口高度不同（真实 800px / 本地 1028px），故纵向绝对坐标不可直接比对；横向几何与盒模型尺寸已逐项对齐。

7. **暗色主题**
   令牌值已完整实现（`--lighten-*` 全套来自原站），但未做逐像素视觉校验。

8. **数据**
   `src/data/recents.ts` 为示例数据。**未**写入你账号里的真实项目内容。接 BYOK 时替换该数据源即可。

---

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
  lib/icons.tsx      图标集
```

---

## 下一步

按你的节奏继续。可选方向：

- 还原 Waldenburg 字体与图标原始资源（需要你提供授权文件）
- 复刻「网格视图」与模板缩略图
- 接 BYOK 层：把 `src/data/` 换成真实数据源
- 复刻下一个页面（工作室 / 音色库 / Flows）
