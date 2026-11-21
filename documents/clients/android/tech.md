# Android 技术方案

更新：2026-11-21。当前实现路径依据本仓库源码；未做本版本真机验收。

## 容器与构建

包名 `com.yixianzhi.app`，显示名“衣先知”，开发版本 `1.4.1` / versionCode `7`。最低 API 24，编译/目标 API 36，构建工具 36.0.0，Java 21。

`npm run build:web` 根据白名单生成 `www/`；`cap sync android` 将它同步到 Android 工程。APK 内本地 origin 为 `https://localhost`，远程后端地址单独配置，页面不是从服务器远程加载。

[MainActivity.java](../../../android/app/src/main/java/com/yixianzhi/app/MainActivity.java) 注册 `Backup` 插件。Debug 允许混合内容；Release 在 WebView 禁止混合内容，主 manifest 禁止明文流量。正式环境用 HTTPS，不能通过关闭校验来处理证书问题。

## 本机状态与生命周期

`LocalState` 使用 IndexedDB `yixianzhi` 的 `snapshots` 仓库，以 `AppAPI.scope|账号` 为分区。`scope` 区分不同后端和本地演示。内存中的 Store 是页面读写入口，快照、v2 基线/游标/冲突和新图片 Blob 同事务保存。

`AppNav` 在内部链接、返回、退出前等待处理队列和保存队列。跨异步操作使用分区 key 与 epoch 防止旧账号响应写入新账号。

图片处理与提交进入等待队列；切换服务和退出先等待本机处理，bfcache 恢复时复位导航锁。远程生成不阻塞离开，由服务端持久保存。设备进程终止和厂商 WebView 行为仍需真机验证。

## 相册、相机与备份

衣物页面通过文件 input 选择照片，通过 `capture` 请求系统拍摄；源文件前端限制 20 MB，压缩为最长边 1200 的展示副本。后端接受单张不超过 3 MiB 的 PNG/JPEG/WebP，并检查文件头。压缩后仍超限时不得显示云端已保存。

[BackupPlugin.java](../../../android/app/src/main/java/com/yixianzhi/app/BackupPlugin.java) 使用系统 ACTION_CREATE_DOCUMENT。新版 .yxz 备份按 manifest、逐张媒体、结束记录写入；JS 逐块发送 64 KiB 字节，原生按会话/序号校验并写出，关闭流后才返回成功。图片总量上限 200 MiB、文件上限 300 MiB。旧 JSON 备份保留不超过 30 MiB 的兼容导入。

超过 30 MiB 的真实 PNG 备份已在浏览器和原生桥接替身中验证；真机 SAF 文件写入仍待验收。导入先暂存并检查哈希/数量/结束记录，事务提交前不替换现有资料。令牌不进入备份。

## 系统返回键

优先关闭 dialog、模态框、底部抽屉，然后返回上一页；无可返回页面时等待保存后退出。必须在真机验证文件选择取消、相机返回、系统手势、应用切后台和进程终止后的恢复。

## 开发与正式包区别

当前脚本产出 debug APK；版本、包名、签名及资源一致性由 `verify-apk.ps1` 校验。正式包需要单独配置签名和 release 构建流程；私钥不得提交。

具体命令见 [部署指南](../../core/deployment.md)，验证边界见 [测试指南](../../core/testing-guide.md)。
