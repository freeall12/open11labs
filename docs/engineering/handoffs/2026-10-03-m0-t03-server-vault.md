# 检查点 2026-10-03 · M0-T03 本地服务端与钥匙金库

## 本次变更

建立同源本地服务端，实现 `docs/architecture/security.md` 列出的安全门禁与
`specs/BYOK.md` 要求的 write-only 钥匙金库。**未进行任何真实 Provider 调用**
（无测试密钥与预算授权）。

### 新增

| 路径 | 作用 |
|---|---|
| `server/lib/security.mjs` | Host / Origin / CSRF / 会话四道门禁 |
| `server/lib/vault.mjs` | 凭证金库、掩码、轮换、可选加密备份、Provider 域名白名单 |
| `server/index.mjs` | HTTP 服务：同源静态资源 + `/api/v1`，日志脱敏 |
| `server/cli.mjs` | 启动入口，仅绑定 loopback |
| `tests/integration/security.test.mjs` | 26 项安全负例（R7-AC02） |
| `.env.example` | 仅示例与无秘密默认值 |

## 安全门禁

1. **loopback 绑定** — `server.listen(port, "127.0.0.1")`，无 `--host` 逃生口。
2. **Host 校验** — 非本监听地址一律 403，防 DNS 重绑定。静态资源同样校验。
3. **Origin 校验** — 变更类请求必须同源；**缺失 Origin 也拒绝**，不假设安全。
4. **无 CORS 头** — 任何响应都不设置 `Access-Control-Allow-*`。
5. **会话** — HttpOnly + `SameSite=Strict`（非 Lax）+ Port 限定。
6. **CSRF** — 令牌绑定会话，常量时间比较。
7. **write-only 密钥** — API 层**没有任何**读取密钥的端点；`useSecret()` 只在
   进程内供 Provider 适配器调用，不经 HTTP。
8. **Provider 域名白名单** — 拒绝 loopback / 私网 / 169.254 / 非 https / 内嵌凭证
   / 未登记主机。
9. **路径穿越** — 静态路径解析后校验仍在 web root 内。
10. **日志脱敏** — `secret`/`apiKey`/`token` 等字段一律 `[redacted]`。
11. **静态资源** — 响应带 `X-Content-Type-Options: nosniff`。

## 验证

```
npx tsc -b --noEmit     exit 0
npx vitest run          exit 0 — 2 files, 77 tests passed
npx vite build          exit 0
node server/cli.mjs     启动成功，仅监听 127.0.0.1
```

实测流程（`PORT=5177`）：

| 步骤 | 期望 | 实测 |
|---|---|---|
| 无会话访问 API | 401 | 401 `SESSION_REQUIRED` |
| 伪造 Host | 403 | 403 `HOST_REJECTED` |
| 跨站 Origin 提交密钥 | 403 | 403 `ORIGIN_REJECTED` |
| 同源提交密钥 | 201，密钥不回显 | 201，`maskedSecret: "sk-d••••••7890"` |
| 列出密钥 | 不含明文 | ✓ 响应中无明文 |

`lsof` 确认监听地址为 `TCP 127.0.0.1:5177 (LISTEN)`；从 LAN 地址访问连接被拒。

## 测试抓到的真实缺陷

1. **Host 测试是假的** — `fetch` 会剥离 `Host`（浏览器禁止头名），最初的 Host
   断言实际没测到任何东西，且把一个本该 403 的请求变成了 500。改用
   `node:http` 原始请求后才能真正设置该头。
2. **日志脱敏测试无效** — `safeLog()` 没有返回值，测试拿到 `undefined`。
   改为捕获 `console.log` 后才真正验证到脱敏。

这两项都是「测试看起来覆盖了、实际没有」的类型，比没有测试更危险。

## 未完成 / 已知边界

- **Provider 能力与验证**（M1-T04）未做：目前只能存密钥，尚不能验证连通性。
  `validationState` 只有 `unverified`。
- **持久化**：`data/` 目录已存在但金库尚未落盘；加密备份的导入/导出只在
  单元测试中验证，未经进程重启验证。
- **前端未接入 API**：设置页仍是占位说明，未调用 `/api/v1/*`。
- 未做跨平台验证，仅在 darwin-arm64 / Node v26.7.0 上实测。

## 下一步

M1-T04（Provider 适配器与公共契约冻结），随后 M1-T05（任务队列）。
两者都不需要额外授权即可开始；真实 API 调用仍需用户提供密钥与预算。
