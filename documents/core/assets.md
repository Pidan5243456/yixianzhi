# 素材与代码来源

2026-11-21 从同级 AI-dress-up 筛选迁入产品页面、共享逻辑、Android 源码和构建脚本。版本库未纳入原项目的密钥、用户数据库、参考仓库、历史文档、工具缓存、依赖目录或 APK。构建时复用了本机 Gradle 缓存和 Android SDK；缓存位于忽略目录，不属于交付源码。

- assets/real：原项目衣物、搭配和默认模特图片，供独立灵感示例及旧数据兼容使用；不自动填入新用户衣橱。原项目未提供完整逐图授权记录，公开商用发布前需核验或替换。
- assets/ph：运行中实际使用的缺图占位与模特引导图片。
- assets/ui：Tabler 图标，保留 MIT 许可证及 sources.json。已经移除不再使用的衣柜摄影横幅。
- assets/fonts：用户许可参考 PetNext_APP 的 Noto Sans SC 字体，保留 SIL OFL 1.1 和来源记录。
- Android 图标及启动资源：当前 App 构建所需。

未迁入 Sardrobe、Libre Closet 的源码与素材，也未迁入 PetNext v2 的业务数据或配置。PetNext v2 仅作为 documents 目录组织方式的参考。
