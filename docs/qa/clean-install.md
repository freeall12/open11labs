# 干净安装验证(发布门禁 4)— 2026-10-03 03:22(ZCode 实测)

方法:从 HEAD `7ed2f05` 提取 tracked 文件(`git archive`)到全新目录 `/tmp/o11-clean`(内置 APFS,排除 exFAT 与共享 node_modules 干扰),按 README 命令全链路执行。

| 步骤 | 命令 | 结果 |
|---|---|---|
| 依赖安装 | `npm ci --no-audit --no-fund` | **exit 0**(仅 fsevents install-scripts 提示性警告,无阻断) |
| 构建 | `npm run build` | **exit 0**,dist 生成:CSS 34.97 kB / JS 395.97 kB(gzip 7.60/116.73) |
| 启动 | `node server/cli.mjs --port 5195 --root dist --data ./data` | 正常监听 `127.0.0.1:5195`(loopback);vault=memory only(符合默认安全设计) |
| 静态探活 | `curl -sI /` | **HTTP 200**(text/html) |
| API 探活 | `curl /api/v1/session` | **HTTP 200**(会话引导+CSRF 正常) |
| 清理 | kill server | 完成 |

结论:**HEAD 干净安装链路真实可用**,回填 release-prep-2026-10-03.md 门禁 4(此前为「未测」)。

局限说明:本验证基于 HEAD(306 用例态);集成者在途树(331 用例+新页面)提交后,以同法对新 HEAD 复跑一次即可完成门禁 4 的最终闭环。exFAT 主盘上 `npm install` 慢与 Chrome 小文件写放大是环境问题(集成者 visual-audit handoff 已记录),不影响干净目录结论。
