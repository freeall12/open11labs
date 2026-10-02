# 目录架构

保留现有单仓库，不立即迁移apps/web。目录骨架中的README说明归属，业务代码待实施；没有声称 server/测试已运行。

```text
AGENTS.md                 Agent根契约
GOAL_PROMPT.md            可复制的Goal Mode启动提示词
README.md                 既有首页说明+文档入口
specs/                    产品/范围/交互/BYOK/验收/路由
  pages/                  逐模块页面规范
 docs/                    研究摘要、架构、开发/协作/发布
src/                      现有React前端
  components/             保留既有首页组件，逐步抽公共UI
  features/               按工具模块新增（实施时创建）
  app/                    router/layout/state（实施时创建）
  lib/                    共享UI工具；禁止Provider秘密
server/                   本地API/会话/vault/jobs/storage
packages/
  contracts/              共享schema与版本
  providers/              服务端Provider适配器
public/
  assets/                 仅可公开合法资源
  fonts/                  仅已授权可分发字体
 tests/                   unit/contract/integration/e2e/visual
 scripts/                 文档/研究索引及后续工程脚本
research/                 私有原站截图/DOM/动作/官方全文，不发布
 data/                    私有运行数据，实施时创建，不发布
```

上述代码块中开头空格仅排版，无带空格目录名。根package/lock由CORE维护；不要新增另一个包管理器lock。`.v2c`/`.video_agent`/`._*`是其他工具/外置磁盘元文件，不清理用户内容、不当源码。

## 渐进迁移

先新增router/功能模块，旧首页继续运行；确定共享组件后再移动并修引用。模块不能直接import服务端vault。所有秘密依赖不得进入前端传递依赖树。server与web build分离、TypeScript环境类型分离；最终CI需检查两者。

## 忽略与公开

research已经被现有gitignore排除；data/及未来测试产物追加精确ignore。不将研究目录解除ignore，不在public目录建立指向私有研究的symlink。代码、spec和脱敏摘要公开；原始证据/账号/测试真实钥匙不公开。
