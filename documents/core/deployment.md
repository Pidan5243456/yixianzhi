# 开发、部署与 Android 构建

更新：2026-11-22。当前 1.5.0 首版已接入核心流程、预算、授权和增量同步，交付调试 APK 与可部署后端。真实服务配置、真机验收及正式签名仍是发布前事项。

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
| AUTH_SECRET | 至少 24 字符的随机秘密，用于验证码 HMAC；会话在数据库中独立撤销 |
| PORT / DATA_DIR | 默认端口 8394；数据库和私有媒体持久目录 |
| OPENROUTER_API_KEY / DASHSCOPE_API_KEY | 模型配置；填入后需配置预算并进行真实供应商联调 |
| DASHSCOPE_API_BASE | 与账号所属服务匹配的后端地址 |
| DM_ACCESS_KEY_ID / DM_ACCESS_KEY_SECRET / DM_ACCOUNT / DM_ENDPOINT | 已配置发信账号的邮件服务 |
| ALLOWED_ORIGINS | 额外网页来源，逗号分隔；APK 来源已内置 |
| MEDIA_QUOTA_MB | 单账号媒体容量，默认 200 MiB；图片独立上传，单张最多 3 MiB |
| QUOTA_*_PER_DAY | 各功能次数限制；0 禁用；每日次数与供应商预算同时校验 |
| ADMIN_TOKEN | 管理统计密钥；不要在共享链接中传递 |

预算变量已完整列入示例，默认全部为 0，真实供应商调用因此关闭。需填写全站/用户日预算及供应商单次保守预留值，单位为整数 micro USD。设置依据见 [M3](../modules/m3-ai.md)；同时配置供应商账户额度。

TRUST_PROXY 只填写实际可信代理 CIDR；未配置时不信任转发头。管理统计通过 Bearer ADMIN_TOKEN 请求头认证，不放在 URL 中。

## Docker 单机部署

已有 Dockerfile 和 compose，尚未在本版本实际启动 Docker 验证。配置好 server/.env 后：

```powershell
docker compose config --quiet
docker compose up -d --build
docker compose logs --tail 100 yixianzhi
```

compose 仅将容器端口绑定到服务器 `127.0.0.1:8394`，由 HTTPS 反向代理对外提供服务。挂载 `yixianzhi_data` 到 `/app/server/data`；不要将其映射到静态站点根目录。

容器采用 node 用户。保证数据卷可写，限制代理请求大小并与应用 30 MiB 上限协调；对外地址必须能被手机访问。手机中的 localhost 指手机自身，不是开发电脑。

部署后先检查 health，再用测试账号验证邮件、手动衣橱和同步。随后主动确认授权，用少量受控请求核对实际模型、用量及预算。health 的 aiReady 只检查密钥存在，不能作为上线验收。

## 备份与升级

备份必须覆盖同一时点的数据库和媒体。简单单机方案是停服务后备份整个持久数据目录，再启动；不停机备份需使用 SQLite 一致备份并与图片清单协调。不要只拷贝运行中的 sqlite 主文件或仅备份 Docker 镜像。

升级前在副本验证迁移与恢复。回滚使用对应代码和同一份完整备份；不可手动降低 user_version。不要执行 `docker compose down -v`，它会删除数据卷。

## Android 调试包

Windows 构建和校验使用 PowerShell 7（pwsh）、Java 21、Android SDK platform 36 / build-tools 36.0.0。校验脚本使用的 .NET API 不兼容旧版 Windows PowerShell 5.1。SDK 路径由参数传入，仓库不携带工具链：

```powershell
.\scripts\build-android.ps1 -AndroidSdk 'C:\Android\Sdk' -JavaHome 'C:\Program Files\Java\jdk-21'
.\scripts\verify-apk.ps1 -AndroidSdk 'C:\Android\Sdk' -JavaHome 'C:\Program Files\Java\jdk-21'
```

脚本先构建网页并同步 Capacitor，再运行 assembleDebug。当前版本产物 `artifacts/yixianzhi-1.5.0-debug.apk`；校验报告 `artifacts/apk-verification.json` 检查签名、包名、中文名称、版本、SDK、资源哈希和私有路径泄漏。

已产出调试 APK，资源校验结果以 [测试记录](../testing/latest.md) 为准。上述脚本不生成正式签名发布包；发布需单独的私钥保管与 release 构建配置，签名私钥不能进入仓库。

## 已安装旧调试包的设备

1.5.0 与本仓库 1.4.0-debug 使用相同调试签名，可覆盖安装。本仓库签名与 AI-dress-up 的 1.3.1-debug 不同，Android 不允许直接覆盖。先在旧 App 导出备份并保管好，再由设备使用者更换安装并导入 .json/.yxz 备份。不要先卸载再寻找本机数据。本次没有读取旧签名私钥或改动设备。正式发布应固定受保护的 release 签名。

## 本地 AI 服务接入

本版提供已验证的 adapter 契约，不内置模型。按 [本地 AI 契约](../contracts/local-ai.md) 实现固定服务端地址，填 LOCAL_AI_URL/TOKEN/VERSION/CAPABILITIES 与正预算后重启后端。能力查询只说明配置允许调用，不代表连接验证成功。APK 永远调用衣先知后端；模型密钥和模型地址不下发到 APK。Docker 访问宿主机时不要误用容器自己的 localhost。邮件、HTTPS、正式签名及真实模型联调仍由部署环境验收。

升级1.5.0前备份数据库和媒体，并同步升级客户端；旧客户端缺 clientDataVersion:3 会收到426，不能继续覆盖新归属/原图字段。后端新增 sharp 原生图片依赖，使用 npm ci 安装当前平台包；不要从 Windows 直接复制 node_modules 到 Linux。
