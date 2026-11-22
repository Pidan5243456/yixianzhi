# 测试指南

从 yixianzhi 根目录运行。最新实际结果见 [验证记录](../testing/latest.md)。所有测试使用隔离账号、临时数据库与模型替身。

| 命令 | 验证内容 | 边界 |
|---|---|---|
| npm run build:web | 产品白名单、脚本与资源构建 | 不证明交互或原生设备行为 |
| npm test | 44 项接口/持久化/客户端边界测试：OTP、鉴权、迁移、CAS、媒体、预算竞争、授权撤回、结果事务、注销、子阶段复用、动作幂等 | 无真实模型和邮件 |
| npm run test:product | 6 件预设、来源/候选隔离、隐藏持久、个人空衣橱、手动增改、保存/收藏、缺失衣物、显式演示图及多尺寸页面 | 浏览器 360/375/430/768/1440，非真机 |
| npm run test:journeys | 拥有衣物日常选搭、想买锚点、同ID购买、禁用态、双图备份、稳定内容哈希、磁盘故障原地重试 | 无真实模型；390px 浏览器 |
| npm run test:sync | 两设备预设隐藏、Blob/按需媒体、逐实体合并、冲突、丢回执、在途修改、保存失败、任务恢复/删除、账号隔离 | 本机 HTTP，服务端演示替身 |
| npm run test:release | 远程模式零自动 AI、独立推荐/生成、刷新不重发、超过 30 MiB 流式备份、截断保护、旧版/文本/写故障/竞态、被回收输入恢复与账号延迟响应 | Native Backup 桥接被替换，不能视为 SAF 实机验收 |
| scripts/verify-apk.ps1 | 签名、包名、中文名、版本、SDK、逐文件资源哈希及私有路径 | 不验证相册、相机、设备进程终止 |

先 npm ci 与 build:web，再运行浏览器脚本。当前使用 Windows Chrome 路径 C:/Program Files/Google/Chrome/Application/chrome.exe，其他环境调整 executablePath。测试需可监听本机 TCP；受限环境需要允许本机测试。

NODE_ENV=test、DEMO_MODE 与空供应商/邮件密钥由脚本设置，数据按运行保存在 .tooling/tests。接口脚本拦截外部请求，模型调用只去本地替身。不要用真实 DATA_DIR 运行这些测试。

## 报告与截图

artifacts/product 与 artifacts/journeys 保存页面截图；artifacts/release-checks.json 记录触发数量、备份字节/分块及恢复断言；artifacts/apk-verification.json 记录最终 APK。全部被 Git 忽略，简要证据保存在 documents/testing。

## 还需部署/设备验证

真实邮件的投递与限流、所选模型的响应格式/质量/账单、HTTPS 和反向代理、Docker 数据卷权限与恢复、Android 相册/相机取消和权限、SAF 大文件、手势返回、切后台及系统杀进程。现有自动化结果不替代这些验证。

代码改变后只重跑受影响检查；发布前确保最终网页与 APK 的资源哈希一致。文档检查包括本地链接、接口/数据库版本和已验证边界。
