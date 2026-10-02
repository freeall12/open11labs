# 开发与运行

## 当前有效

```sh
npm install
npm run dev
npm run typecheck
npm run build
npm run preview
node scripts/check-docs.mjs
node scripts/index-research.mjs  # 仅私有研究已在本机时
```

React19/Vite7/TS/Tailwind4已有首页；无BYOK服务器、路由实现、Docker或正式E2E。`npm run dev`仅是前端，不代表用户钥匙安全代理已实现。

## 实施Agent须补

- 固定满足Vite要求的Node版本，验证D8的OS；不凭本机能跑声称跨平台支持。
- 配置同源本地API代理/发布静态服务；明确端口、loopback绑定、数据目录、首次启动与钥匙设置。
- 增加server/web独立typecheck/build/test/启动脚本，README写真实已存在命令。
- `.env.example`只放示例与无秘密默认值，Provider钥匙不放VITE_*。建议无钥匙也可启动与浏览。
- 真实端到端使用用户授权测试钥匙与预算；未批准只用明确模拟/契约fixtures。
- Docker若交付需Dockerfile/ignore/volume/healthcheck/loopback端口与实际构建记录，不能空Docker文件冒充支持。

不自动执行git push、发布包、改真实账号或调用付费模型。出现别人未提交改动保留；不reset/clean。根配置/依赖改动CORE串行合并。
