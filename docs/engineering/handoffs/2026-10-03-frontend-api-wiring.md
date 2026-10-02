# 检查点 2026-10-03 · 前端接入本地 API

## 本次变更

后端已具备能力（密钥、验证、任务、成本、存储、备份），但前端此前全是占位页。
本次把三张本地页面接到真实 API。

### 新增

| 路径 | 作用 |
|---|---|
| `src/lib/api.ts` | API 客户端：会话引导、CSRF 令牌缓存、错误映射 |
| `src/features/core/ProviderSettingsPage.tsx` | 密钥录入/验证/轮换/删除 |
| `src/features/core/LocalJobsPage.tsx` | 任务列表 + 费用账本 + 预算 |
| `src/features/core/LocalStorageSettingsPage.tsx` | 存储用量 + 备份生成 |
| `tests/integration/client.test.mjs` | 11 项，客户端对真实服务端 |

## 同源拓扑

服务端**不设置任何 CORS 头**，因此浏览器只能同源访问。开发环境用 Vite 代理
复现生产拓扑（一个 origin 同时提供页面和 API），而不是为开发放宽服务端检查：

```ts
proxy: { "/api": {
  target: "http://127.0.0.1:5174",
  changeOrigin: true,
  configure(proxy) {
    proxy.on("proxyReq", (req) => {
      req.setHeader("host", API_ORIGIN);
      req.setHeader("origin", `http://${API_ORIGIN}`);
    });
  },
}}
```

Host 与 Origin 都被改写成后端自己的 origin，所以到达服务端的请求与它自己发出的
请求无法区分。

## 会话处理

会话 cookie 是 HttpOnly，JS 看不到也不需要看到；CSRF 令牌可读，变更类请求必须
回显。`ensureCsrf()` 缓存令牌，避免每次请求重新握手。

## 验证

```
npx tsc -b --noEmit   exit 0
npx vitest run        exit 0 — 8 files, 196 tests passed
npx vite build        exit 0
```

真实浏览器（Chrome DevTools）端到端：
- 在 `/local/settings/providers` 填表提交 → 密钥写入服务端
- 页面显示掩码 `sk-b••••••3456`
- **`secretLeaked: false`** — 完整密钥不在 DOM 中
- 状态正确显示「未验证」（未调用验证）
- `/local/jobs` 显示真实成本账本：金额为「暂无已定价记录」（**不是 0**），
  预算作用域声明完整呈现

## 测试抓到的真实缺陷

1. **客户端首次调用若为 GET 会 401** —— 原实现只在变更类请求前引导会话，
   而服务端对读请求同样要求会话。真实浏览器里首次加载设置页就会失败。
   已改为任何请求前都确保会话。
2. **`{...req}` 展开拿不到 headers** —— Node 的 IncomingMessage 不是可安全展开的
   对象，`assertOrigin` 收到 `undefined` 抛错导致 500。改为显式传 `headers`。
3. **测试里 `require` 在 ESM 中不可用**；以及 **fetch spy 自引用递归**
   （在 mock 内部读 `globalThis.fetch` 拿到的是 spy 自己）→ 栈溢出。

## 未完成

- 「音色」「素材」等创作页仍未接入，功能页仍是路由身份 + 未实现状态
- 提交生成任务的 UI 尚未做（M1-T07，需真实密钥）
- 客户端单测未覆盖断网/超时/会话过期后的重试行为
