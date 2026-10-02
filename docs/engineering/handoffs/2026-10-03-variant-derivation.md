# 检查点 2026-10-03 · 开源经验迁移：变体派生

## 本次变更

按用户要求「参考 hypit 这类开源项目的经验迁移」，完成调研并**落地其中一条**。

调研结论见 `docs/architecture/oss-patterns.md`。可迁移的五条里，
"产物是工程不是成片" + "变量具名、结构复用" 是同一个思想，本轮实现为
`ProjectStore.deriveVariant()`。

## 新增

| 路径 | 作用 |
|---|---|
| `docs/architecture/oss-patterns.md` | 调研结论：哪五条能迁移、哪四条明确不迁移 |
| `server/lib/projects.mjs` | `deriveVariant()` |
| `server/index.mjs` | `POST /api/v1/projects/:id/variants` |
| `src/lib/api.ts` | `projects.deriveVariant()` + `ProjectRecord` |
| `tests/contract/variants.test.mjs` | 7 项 |

## 行为

实测（真实 HTTP）：

```
工程 variables: {host: 主播A, language: zh}, beats: [开场, 要点]
派生 variables: {host: 主播B, language: en, duration: 20}
     structure  : ['开场', '要点']            ← 结构原样保留
     derivedFrom: {id, revision:1, changed:[host, language, duration]}
```

要点：

- **只换具名变量**，结构（`beats` 等）原样保留
- `changed` 只含**真的变了**的键——传了同值不会进列表
- **复用 `assetRefs`**，不重新生成任何素材
- **派生本身不执行任何任务**；要出片仍走正常费用确认路径
- 可链式：变体再派生
- 原工程不受影响

## 明确不迁移的

| hypit 做法 | 原因 |
|---|---|
| Agent Skill 分发 | 我们是 Web 应用，不是 Agent 工具 |
| 无头 Chromium 渲染 | 我们产出媒体文件，不自己实现渲染引擎 |
| 复刻他人爆款视频 | 版权与肖像权；`SCOPE.md` 已排除，不做绕过 |
| 自定义许可证 | 我们的开源许可待用户确认（D2） |

## 验证

```
npx tsc -b --noEmit   exit 0
npx vitest run        exit 0 — 14 files, 277 tests passed
npx vite build        exit 0
```

## 下一批可落地（已写进调研文档）

1. Project 声明式化——`content` 收敛为稳定 schema，可 diff 可重跑
2. 纯代码渲染兜底——波形/字幕排版/时长探测不依赖任何 Provider
3. 本地模型 Provider——`adapters` 注册表已留好位置

## 证据说明

hypit 相关内容为**阅读公开资料得出，未运行该项目**。
其"总成本 $1.15/条"是项目方口径，不是独立实测，本文不作为结论依据。
