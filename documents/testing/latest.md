# 最近验证记录

日期：2026-11-22。仓库 yixianzhi，版本1.5.0 / Android code8，可部署候选版。以下是本轮实际执行结果；真实模型尚未接入。

| 检查 | 结果 | 范围 |
|---|---|---|
| npm run build:web | 通过 | 最终网页资源构建 |
| npm test | 44/44 通过 | 原28项；新增检查凭据/本地adapter/双图回收等12项及4项账号切换边界 |
| npm run test:product | 通过 | 6件预设、手动增改、保存/收藏、缺失衣物、多尺寸页面、零自动AI |
| npm run test:journeys | 通过 | 日常仅拥有衣物、日期/手动温度、想买锚点、购买同ID、禁用态、原图/透明图备份、删后编辑保护 |
| 新边界回归 | 通过 | 同字节 dataURL/media 转换和元数据修改不使结果失效；同ID换图会失效；磁盘故障后购买/编辑搭配可原地重试 |
| npm run test:sync | 通过 | 两设备实体同步、Blob懒加载、冲突/丢回执/在途编辑、失败保存、任务恢复/删除及账号隔离 |
| npm run test:release | 通过 | 远程模式自动AI提交0，独立推荐与生成、刷新不重发；替身执行，没有真实供应商请求 |
| 流式备份 | 通过 | 13张PNG；图片33419673字节；备份44564871字节；691个桥接块；截断保护与完整恢复 |
| npm audit | 0漏洞 | sharp已使用修复版0.35.5；截至本次安装审计结果 |
| 独立产品复核 | 本轮范围通过 | 设计前评审，实施后发现并修复账号切换、内容指纹、演示凭据和购物锚点，持久化重试追加复核通过 |
| 文档与语法 | 通过 | 23份Markdown、68个本地链接无缺失，59个脚本语法通过，git diff --check无错误 |
| APK构建与校验 | 通过 | 336个资源哈希一致；包名/中文名/版本/SDK/签名正确；私有路径0 |
| 真实模型/邮件/公网/Docker | 未执行 | 配置待部署者填写，模型效果、速度、费用尚未验收 |
| 真机/SAF/正式签名 | 未验证 | 浏览器及Native Backup桥接替身不代替设备验收 |

APK：artifacts/yixianzhi-1.5.0-debug.apk，109262329字节。包名com.yixianzhi.app，最低API24，目标API36。

SHA-256：760808F73642EFB7B0EA3479F27D7411747A2A24F5C39C99048DB45E456DCEFC

本仓库1.4.1和1.5.0 APK公开签名证书SHA-256相同：75db31a3a535f493e680e7d89c4915c674a23cdb1d65ef2a8f4d5630149d12c7，可覆盖安装。本轮未安装或卸载设备App。旧AI-dress-up 1.3.1签名不同，仍须先导出备份，不能直接覆盖。正式发行需要固定受保护的release签名。

机器报告在artifacts/apk-verification.json、artifacts/release-checks.json；截图在artifacts/product与artifacts/journeys，均不提交Git。构建有现存Gradle弃用/SDK XML版本警告，但构建与验包成功。Docker、真机、真实provider、公共部署及素材许可不是本次已通过的项目。
