# 数据库与数据字典

更新：2026-11-22。SQLite user_version=4；同步 syncVersion=2；业务 dataVersion=3。三个版本独立。来源：[database.js](../../server/database.js)。

## 存储布局

DATA_DIR 默认为 server/data，含 yixianzhi.sqlite、运行时 WAL/SHM、media/<账号SHA256>/<图片SHA256> 私有文件。客户端 IndexedDB v2 有 snapshots 和 media 两个仓库，图片以 Blob 保存。

启用 WAL、外键检查和 5 秒 busy timeout。同步事务使用 BEGIN IMMEDIATE，不跨 await。当前部署为单进程 SQLite，不能用多个实例共享此数据目录。在线备份需要一致快照；简单部署可停服备份整个目录。

## 表与用途

| 表 | 主要键与字段 | 用途 |
|---|---|---|
| users | email PK,created_at,last_login_at | 身份索引；ensureUser 会更新 last_login_at，不是严格登录审计 |
| accounts | email PK,generation,active | 活跃/冻结状态，阻断注销回调 |
| account_generation | id 自增 PK | 同邮箱重建也分配新代次 |
| sessions | hash PK,email,generation,expires_at | 随机令牌 SHA-256，30 天，可撤销 |
| consents | (owner,purpose),version,granted,updated_at | AI 与统计独立授权 |
| entities | (owner,kind,id),data,version,deleted | 衣物、搭配、模特、记录、成员和设置 |
| changes | cursor 自增 PK,owner,kind,id,version,data,deleted | 增量日志；新写 data 为 NULL，拉取完整最新实体 |
| mutations | (owner,id),request_hash,result | 推送幂等回执 |
| sync_migrations | owner PK,source_version,migrated_at | 一次性旧快照迁移 |
| user_state | email PK/FK,version,state,updated_at | 未迁移的旧快照；迁移后删除 |
| media | (owner,id),mime,size,path | 私有图片索引及字节容量 |
| media_age | (owner,id),created_at | 最近上传/返回引用的 24 小时宽限起点 |
| ai_operations | id PK,owner,kind,fingerprint,status,result,error,created_at,updated_at,cycle | 持久操作，账号/功能/指纹唯一 |
| operation_inputs | id PK,data,expires_at | 冻结输入和成功中间阶段，7 天恢复窗口 |
| ai_usage | id PK,operation_id,owner,provider,model,budget_day,reserved,status,usage,started_at,finished_at | 每次尝试预留，未知结果不退款 |
| kv | key PK,value,expires_at | 验证码摘要、限流、拆图元数据、子项、永久动作回执；0 表示不按 TTL 过期 |
| events | id PK,ts,event,email,props | 有授权的使用统计 |

外键仅对源码已声明的 users 关联表生效。entities、changes、sessions 等依靠服务层校验归属和删除顺序，不假称数据库已强制所有逻辑关系。索引覆盖账号变更游标、账号任务时间和日期费用。

## 业务实体

| kind | data 摘要 |
|---|---|
| customItems | id,name,cat,ownership,scene,color?,warmth?,originalImage,cutoutImage?,dataUrl,processing?,source,createdAt,updatedAt,labels? |
| customOutfits | id,name,scene,context:{date,scene,temperature},items:衣物ID数组,createdAt,updatedAt |
| models | id,name,dataUrl；默认模特可为 null |
| history | id=h_<operationId>,operationId,modelId,outfitId?,items,scene,context?,time,image,kind |
| 收藏/衣橱示例等成员 | ID 为所属对象 ID，data=true |
| setting | account 仅 nick/avatar；profile 与其他偏好开关 |

穿搭引用衣物 ID，删除衣物不抹去穿搭或历史；页面提示缺失。删除穿搭清理其收藏，保留生成历史。实体墓碑防旧设备及后台结果静默复活。

## 如何理解当前模型

当前共有 17 张业务/基础表。核心采用“通用实体表 + JSON 字段”，并没有独立的 garments、outfits、outfit_items 表。

entities 的主键是 (owner, kind, id)。例如，一件衣服对应 kind=customItems 的一行；名称、类别、场景和图片引用在该行 data JSON 中。一套搭配是 kind=customOutfits 的另一行，items 保存衣物 ID 数组。收藏也是独立成员记录。每行有自己的 version 和 deleted，因此修改一件衣服无需覆盖整份衣橱。

逻辑关系为：账号 → 多件衣物 / 多套搭配 / 多张模特照片 / 多条试穿记录；搭配 → 多个衣物 ID；衣物和试穿记录 → 私有媒体引用。穿搭与衣物之间的关系目前由应用检查，不是独立关联表的外键。

这套结构适合当前单机部署与逐条离线同步；代价是按颜色、季节等复杂查询依赖读取 JSON，数据库不能直接强制所有业务关系。若后续要做大量筛选、穿着统计或运营分析，再迁移为专用衣物/搭配/关联表并建立索引。现在不为尚未实现的功能增加表。

图片字节放服务器私有文件目录，本机另有 Blob 缓存；entities.data 只保存 media 哈希引用，media 表保存归属与文件位置，不把所有照片塞进一个 JSON 或公开静态目录。

## 安全、留存与迁移

图片 ID 为原字节 SHA-256；哈希不是访问凭证。图片查询和引用均检查 owner。数据库不存模型密钥；验证码存 HMAC 摘要；会话原令牌只在客户端账号分区，云端实体与备份剔除它。

用户旧表时间主要为 ISO 文本；任务/授权等使用毫秒。费用为整数 micro USD，budget_day 为 UTC 日期。输入过期表示不再支持旧任务恢复，元数据并不立刻物理删除；媒体回收不再将过期输入当作活引用。

注销先提交冻结，再清理实体、任务、媒体、会话和授权；失败保留冻结并重试。费用匿名化保留全站累计，不保留已注销邮箱。账号代次序列不重置。

升级按版本事务迁移，未来版本拒绝启动。生产升级应先备份，在副本验证迁移/恢复；不得降低 user_version 强行回滚。

媒体和备份细节见 [M4](../modules/m4-sync.md)，费用见 [M3](../modules/m3-ai.md)。

## 1.5.0 数据升级

没有新增衣物表或双写：仍由 entities 作为单一事实来源。ownership 只能为 owned/wishlist，旧记录缺省 owned；预设不写此枚举。购买更新原行，搭配引用不变。originalImage 为本机压缩后的完整上传照片；cutoutImage 为可选透明派生图；dataUrl 是两者的确定性显示别名。相同字节由哈希去重，不重复储存原图和显示图。

processing={source,operationId,version} 关联原图、任务与处理版本，任务状态不在衣物行复制。AI 标签仅在检查结果 suggestions 留存，不覆盖手动字段。CUTOUT 落库重新读取当前行，核对 originalImage，合并当前名称和归属后增加实体版本；删除/换图则只保留任务结果及未应用原因。

业务快照升到3，syncVersion 仍为2，SQLite user_version 仍为4。新版同步请求必须包含 clientDataVersion:3，旧客户端返回426，防止丢字段及 wishlist 回退为 owned。已有旧快照只在未迁移期间支持旧路由；迁移后旧路由拒绝写入。部署时先备份并要求客户端同步升级。

日期按本地日历保存字符串，温度为用户手动设置的°C数字或 null。原图、派生图、处理来源都纳入归属检查、备份和回收；衣物存在期间保留原图，删除及注销仍按留存规则清理。
