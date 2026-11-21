# 衣先知

管理自己的衣物，组合并保存穿搭，需要时再生成试穿效果。原生网页界面通过 Capacitor 打包 Android，后端使用 Node.js 和 SQLite。

这是从原型中筛选代码后建立的独立仓库，不包含真实账号数据、密钥、参考项目或旧 APK。当前正在完成 1.4 产品流程与数据链路改造；验收状态见 [任务看板](documents/task-tracker.md)。

## 开发

需要 Node.js 24 和 npm。先安装依赖，再构建静态页面：

```sh
npm ci
npm run build:web
npm start
```

打开 `http://localhost:8394/login.html`，在服务连接页选择本地演示。生产配置从 `server/.env.example` 复制到 `server/.env`，由部署者填写；不要提交该文件。

```sh
npm test
npm run test:product
npm run test:sync
```

Android 构建与后端部署见 [部署指南](documents/core/deployment.md)。[文档索引](documents/index.md) 按核心规范、客户端、业务模块和接口契约组织。

先了解产品可读 [Android 产品需求](documents/clients/android/prd.md)；了解代码和数据可读 [架构说明](documents/core/tech-stack.md)、[数据库设计](documents/contracts/database.md) 与 [接口契约](documents/contracts/api.md)。当前实际检查结果见 [验证记录](documents/testing/latest.md)。

素材来源与待核验事项见 [素材清单](documents/core/assets.md)。本仓库尚未自行指定整仓开源许可证，不能把图标或字体的许可当作所有继承代码与图片的许可。
