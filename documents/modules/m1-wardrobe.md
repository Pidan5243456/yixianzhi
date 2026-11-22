# M1 衣橱管理

更新：2026-11-22，1.5.0。相册/相机选图 → 本机压缩 → 填名称、类别和归属 → 保存。不强制裁剪，不自动检查、不自动抠图。颜色和保暖程度可选，场景由用户填写。

衣橱包含“我的衣物”“想买”“预设”筛选。6件预设保持包内稳定 ID，可试搭和隐藏，不初始化为用户拥有。自己的衣物 ownership=owned，商品图 ownership=wishlist；旧记录缺归属时按 owned 读取。点击“已购买，移入衣橱”更新同一实体，不复制图片、不更换 ID，已存试搭继续引用它。

| 字段 | 含义 |
|---|---|
| id/name/cat | 稳定身份、最多80字符名称、上衣/下装/鞋子/连体裙 |
| ownership | owned 或 wishlist |
| scene/color/warmth | 手动场景、可选颜色、light/medium/warm 或空 |
| originalImage | 上传后经本机压缩的完整图；不是未经压缩的相机文件 |
| cutoutImage | 可选透明派生图，不覆盖 originalImage |
| dataUrl | 兼容显示引用，始终优先 cutoutImage，否则 originalImage |
| processing | source 原图哈希、operationId、处理版本；权威状态在 ai_operations |
| createdAt/updatedAt | 毫秒时间戳；编辑和购买保留原 ID |

图片字段在服务器和持久快照中使用私有 media 引用，字节单独存储。旧图片作为迁移基准原图，无法从旧生成图恢复历史拍摄原片。上限1000件。

去背景由用户从预览主动发起，先检查照片再去背景；无能力时明确禁用。多件或无目标照片要求重新拍/选，手动保存不受影响。旧生成式“拆图整理”入口已移除，既有任务和历史兼容读取、重试，不把生成衣物当成抠图。

服务器只在原图仍匹配、衣物未删除时应用去背景结果，保留处理中发生的改名和购买状态。编辑表单发现对象已更新/删除会阻止旧表单覆盖。删除衣物不删穿搭和历史，穿搭展示缺失；原图及派生图按统一回收规则清理。

实现：js/wardrobe-model.js、js/pages/add-clothes.js、js/pages/wardrobe.js、server/sync-v2.js。字段细节见数据库契约，模型对接见 local-ai 契约；真实抠图效果和真机相机/相册待验收。
