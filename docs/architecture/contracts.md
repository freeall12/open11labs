# 公共契约（实施提案）

此文档是前后端协作契约，不代表现有API。CORE与PROVIDER共同维护版本；先编写TS类型/运行时校验与契约测试，再让各页面实现。产品状态来源为 [BYOK](../../specs/BYOK.md)。

## 数据对象

| 对象 | 必需语义 |
|---|---|
| ProviderConfig | id、类型、显示名、允许baseURL、credentialRef、验证状态/时间；前端只得到掩码与状态，不得到密钥 |
| Capability | providerId、模型API ID/显示名、任务类型、available/unavailable/unverified、理由、输入/输出schema、单位/上下限、权限/价格来源/日期、supportsCancel/statusQuery/streaming/idempotency |
| Job | id、type、providerId/modelId、credentialRef、输入/参数快照、assetRefs、状态/revision、时间、requestId/generationId、输出assetIds、规范化error、费用记录、取消/未知信息 |
| Asset | 本地id、来源/生成job、媒体类型、内容hash、字节数/时长/编码/尺寸、内部安全路径、displayName、许可来源；对浏览器返回受控资源URL而非文件系统路径 |
| Project | id、类型、名称、revision、工程内容版本、assetRefs、draft状态、保存时间；不含云成员/角色 |
| UsageEntry | jobId、Provider、估价/上报/核对/未知状态、计量单位/币种、数值/来源/有效日期；未知不是0 |
| NormalizedError | code、safeMessage、retryable、submissionCertainty、providerRequestId、fieldErrors；不含密钥/敏感原始响应 |

## 本地API资源规划

建议 `/api/v1` 下的providers/capabilities/jobs/assets/projects/settings资源，具体路径由CORE冻结在测试中。不直接暴露供应商任意URL代理。上传为流式multipart并检查体积；二进制输出独立受控资源接口；状态事件可用SSE，客户端断线后用job revision/事件序号补全。

- Provider创建/验证/轮换/删除：有会话/CSRF保护；验证不生成，秘密write-only。
- 创建任务：客户端意图ID→原子创建本地job；重复意图只返回原job。此机制仅避免本地重复，不谎称远端支持幂等。
- 查询/取消任务：明确是否远端可取消；未知提交需要查询/人工确认。
- 导入资产/项目：校验schema版本与安全引用，拒绝路径穿越/zip bomb。
- 导出：生成真实文件/工程bundle，默认不含钥匙、研究账号/绝对路径。
- 删除：确认关联影响；asset仍被工程/执行任务使用时返回可理解冲突。

## Provider 接口语义

`listCapabilities / validateCredential / submit / getStatus / cancel / getArtifact / normalizeError / estimateCost`。无对应远端能力时返回明确unsupported/unverified，不伪造默认结果。streaming与async不是同一模型，适配器需区分二进制立即响应、流与远端任务ID。

LLM适配器通过独立工具schema调用本地typed工具，不将钥匙/系统文件交给模型；工具授权、费用确认、输入来源与产物版本留痕。

## 兼容与错误

版本化schema；数据库/工程迁移先备份；未知字段不能直接透传Provider。至少有 AUTH_REQUIRED、PROVIDER_AUTH_FAILED、CAPABILITY_UNAVAILABLE、VALIDATION_ERROR、RATE_LIMITED、SUBMISSION_UNKNOWN、PROVIDER_REJECTED、ASSET_IMPORT_FAILED、STORAGE_FULL、REVISION_CONFLICT 等安全错误语义。

每次接口变更同时更新前端、Provider与契约fixture；保留旧工程迁移案例。不得由某页面单独拼一套API而绕过共同job生命周期。
