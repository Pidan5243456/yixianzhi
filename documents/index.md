# 衣先知文档索引

采用 PetNext v2 的模块化组织方式；内容、状态和决策均针对衣先知重新编写。更新日期：2026-11-22。

第一次了解产品先读 Android PRD；参与开发先读技术栈与对应模块；对接后端读接口和数据库契约；部署时读部署与测试指南。本文是入口，进度只以任务看板及实际验证记录为准。

## 核心规范

- [技术栈与架构](core/tech-stack.md)：目录、前后端边界、数据流。
- [开发约定](core/conventions.md)：命名、账号隔离、异步保存、错误处理。
- [决策与风险](core/decisions.md)：产品范围和技术取舍。
- [部署指南](core/deployment.md)：开发、生产配置、Android 打包。
- [测试指南](core/testing-guide.md)：自动化验证及未验证边界。
- [AI 协作流程](core/ai-workflow.md)：设计评审、实施、验收。
- [素材与迁移来源](core/assets.md)：保留资源及许可边界。

## 客户端

- [Android 产品需求](clients/android/prd.md)：用户故事、导航和验收条件。
- [Android 技术方案](clients/android/tech.md)：WebView、文件选择、备份、返回键。

## 业务模块

- [M0 账号与授权](modules/m0-system.md)
- [M1 衣橱管理](modules/m1-wardrobe.md)
- [M2 穿搭与试穿记录](modules/m2-outfits.md)
- [M3 AI 任务与成本](modules/m3-ai.md)
- [M4 媒体与同步](modules/m4-sync.md)

## 协作与契约

- [接口契约](contracts/api.md)
- [本地 AI 接入契约](contracts/local-ai.md)：检查/去背景/试穿、请求响应与配置。
- [数据库与数据字典](contracts/database.md)：现行实体、私有媒体、任务和迁移。
- [最近验证记录](testing/latest.md)：新仓库实际运行结果及未验证边界。
- [任务看板](task-tracker.md)：当前阶段、剩余事项、验证证据。
- [变更记录](changelog.md)：产品版本变化，不记录无关聊天历史。
