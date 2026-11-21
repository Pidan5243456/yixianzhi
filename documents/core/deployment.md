# 开发、部署与 Android 构建

更新：2026-11-21。当前 1.4.0 为开发版，预算/授权/增量同步仍未接入完成。以下是可复现的启动和构建流程，不代表当前代码已满足正式上线条件。

## 本地开发

在仓库根目录使用 Node.js 24 和 npm：

```powershell
npm ci
npm run build:web
npm start
```

浏览器打开 `http://localhost:8394/login.html`，从服务连接页选择“本地演示”。本地演示不需要模型或邮箱密钥；它不等于已经连接云端。修改页面后重建 `www`，否则服务仍展示旧资源。

需要测试服务端演示登录时，在独立开发终端设置：

```powershell
$env:NODE_ENV = 'development'
$env:DEMO_MODE = 'true'
$env:DATA_DIR = Join-Path (Get-Location) '.tooling/dev-data'
npm start
```

不要将演示开关用于生产。默认开发签名密钥仅用于本机。不要用测试命令指向真实 DATA_DIR。

## 环境配置

仅在尚无配置时，将 [server/.env.example](../../server/.env.example) 复制为 `server/.env`，由部署者填写。真实配置不进 Git、APK 或网页目录。当前加载器支持简单 `KEY=value`，不要写 shell 表达式；系统环境中的非空值优先。

| 配置 | 用途 |
|---|---|
| NODE_ENV / DEMO_MODE | 生产使用 production / false |
| AUTH_SECRET | 至少 24 字符的随机秘密；变更会影响既有令牌 |
| PORT / DATA_DIR | 默认端口 8394；数据库和私有媒体持久目录 |
| OPENROUTER_API_KEY / DASHSCOPE_API_KEY | 模型配置；填入后仍需完成 M3 接入及联调 |
| DASHSCOPE_API_BASE | 与账号所属服务匹配的后端地址 |
| DM_ACCESS_KEY_ID / DM_ACCESS_KEY_SECRET / DM_ACCOUNT / DM_ENDPOINT | 已配置发信账号的邮件服务 |
| ALLOWED_ORIGINS | 额外网页来源，逗号分隔；APK 来源已内置 |
| MEDIA_QUOTA_MB | 单账号媒体容量，默认 200；现行全量同步仍受 30 MiB 请求限制 |
| QUOTA_*_PER_DAY | 各功能次数限制；当前新旧实现的 0 语义尚待统一 |
| ADMIN_TOKEN | 管理统计密钥；不要在共享链接中传递 |

预算变量及其当前接入状态见 [M3](../modules/m3-ai.md)。不要把示例中的次数配额当作已完成的成本硬上限。

## Docker 单机部署

已有 Dockerfile 和 compose，尚未在本版本实际启动 Docker 验证。配置好 server/.env 后：

```powershell
docker compose config --quiet
docker compose up -d --build
docker compose logs --tail 100 yixianzhi
```

compose 仅将容器端口绑定到服务器 `127.0.0.1:8394`，由 HTTPS 反向代理对外提供服务。挂载 `yixianzhi_data` 到 `/app/server/data`；不要将其映射到静态站点根目录。

容器采用 node 用户。保证数据卷可写，限制代理请求大小并与应用 30 MiB 上限协调；对外地址必须能被手机访问。手机中的 localhost 指手机自身，不是开发电脑。

部署后先检查 health，再用测试账号验证邮件、手动衣橱和同步。当前版本未达到完整 AI 上线门槛，不能仅凭 health 的 aiReady 发布。

## 备份与升级

备份必须覆盖同一时点的数据库和媒体。简单单机方案是停服务后备份整个持久数据目录，再启动；不停机备份需使用 SQLite 一致备份并与图片清单协调。不要只拷贝运行中的 sqlite 主文件或仅备份 Docker 镜像。

升级前在副本验证迁移与恢复。回滚使用对应代码和同一份完整备份；不可手动降低 user_version。不要执行 `docker compose down -v`，它会删除数据卷。

## Android 调试包

Windows 构建和校验使用 PowerShell 7（pwsh）、Java 21、Android SDK platform 36 / build-tools 36.0.0。校验脚本使用的 .NET API 不兼容旧版 Windows PowerShell 5.1。SDK 路径由参数传入，仓库不携带工具链：

```powershell
.\scripts\build-android.ps1 -AndroidSdk 'C:\Android\Sdk' -JavaHome 'C:\Program Files\Java\jdk-21'
.\scripts\verify-apk.ps1 -AndroidSdk 'C:\Android\Sdk' -JavaHome 'C:\Program Files\Java\jdk-21'
```

脚本先构建网页并同步 Capacitor，再运行 assembleDebug。当前版本预期产物 `artifacts/yixianzhi-1.4.0-debug.apk`；校验报告 `artifacts/apk-verification.json` 检查签名、包名、中文名称、版本、SDK、资源哈希和私有路径泄漏。

产物路径是构建约定，是否已经产出以 [测试记录](../testing/latest.md) 为准。上述脚本不生成正式签名发布包；发布需单独的私钥保管与 release 构建配置，签名私钥不能进入仓库。
