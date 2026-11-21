# 数据库与数据字典

更新：2026-11-21。SQLite user_version=4；同步 syncVersion=2；业务 dataVersion=2。三个版本独立。来源：[database.js](../../server/database.js)。

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
| customItems | id,name,cat,scene,dataUrl:media引用,source,createdAt,updatedAt,labels? |
| customOutfits | id,name,scene,items:衣物ID数组,createdAt,updatedAt |
| models | id,name,dataUrl；默认模特可为 null |
| history | id=h_<operationId>,operationId,modelId,outfitId?,items,scene,time,image,kind |
| 收藏/衣橱示例等成员 | ID 为所属对象 ID，data=true |
| setting | account 仅 nick/avatar；profile 与其他偏好开关 |

穿搭引用衣物 ID，删除衣物不抹去穿搭或历史；页面提示缺失。删除穿搭清理其收藏，保留生成历史。实体墓碑防旧设备及后台结果静默复活。

## 安全、留存与迁移

图片 ID 为原字节 SHA-256；哈希不是访问凭证。图片查询和引用均检查 owner。数据库不存模型密钥；验证码存 HMAC 摘要；会话原令牌只在客户端账号分区，云端实体与备份剔除它。

用户旧表时间主要为 ISO 文本；任务/授权等使用毫秒。费用为整数 micro USD，budget_day 为 UTC 日期。输入过期表示不再支持旧任务恢复，元数据并不立刻物理删除；媒体回收不再将过期输入当作活引用。

注销先提交冻结，再清理实体、任务、媒体、会话和授权；失败保留冻结并重试。费用匿名化保留全站累计，不保留已注销邮箱。账号代次序列不重置。

升级按版本事务迁移，未来版本拒绝启动。生产升级应先备份，在副本验证迁移/恢复；不得降低 user_version 强行回滚。

媒体和备份细节见 [M4](../modules/m4-sync.md)，费用见 [M3](../modules/m3-ai.md)。
