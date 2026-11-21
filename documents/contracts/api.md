# HTTP 接口契约

更新：2026-11-21。实现来源：[路由](../../server/server.js)、[认证](../../server/auth.js)。

## 通用约定

JSON 请求/响应，最大 30 MiB。用户接口要求 Authorization: Bearer <token>；验证码登录、健康检查例外。注销验证码发送仍需当前会话。身份来自令牌，不能指定 owner。API 响应不缓存。

错误为 {error,code?}；400 参数错误，401 会话失效，403 未授权，409 幂等或重试冲突，410 输入/图片过期，413 大小或容量限制，426 客户端需升级，429 次数/预算/并发限制，503 服务未配置。实体 CAS 冲突作为 push 结果逐条返回。

## 已接入路由

| 方法与路径 | 输入 | 响应/约束 |
|---|---|---|
| GET /api/health | 无 | ok,service=yixianzhi,syncVersion=2,dataVersion=2,demo,aiReady |
| POST /api/auth/send-code | email,purpose=login 或 delete | ok；delete 须登录；非生产演示可返回 devCode |
| POST /api/auth/login | email,code | email,token,generation；验证码单次消费 |
| POST /api/auth/logout | {} | 撤销当前会话 |
| POST /api/account/delete | confirm=DELETE,code | 注销专用验证码；成功后本机清理 |
| GET /api/consents | 无 | ai_processing,analytics |
| POST /api/consents | purpose,granted:boolean | purpose,granted,version |
| POST /api/media/upload | image:data URL | ref:media:<sha256>；单张 3 MiB |
| GET /api/media/:id | SHA-256 路径参数 | dataUrl；账号归属检查 |
| POST /api/media/collect | {} | deleted 数量 |
| POST /api/sync/pull | cursor?,watermark?,limit? | entities,cursor,watermark,hasMore,syncVersion |
| POST /api/sync/push | mutationId,changes | 每条 status=ok/conflict 与 current；批次最多 100 |
| POST /api/ai/operations | kind,input,actionId,retry? | HTTP 202，operationId,kind,status,updatedAt 及完成结果 |
| GET /api/ai/operations | 无 | 当前账号最近 100 个 operations |
| GET /api/ai/operations/:id | 操作 ID | 状态和完成结果；已删试穿返回 deleted |
| POST /api/ai/operations/:id/retry | actionId | 显式重试，HTTP 202；保留原 ID |
| POST /api/segment/start | image,requestId,actionId,retry? | jobId；图片可为已上传引用 |
| POST /api/segment/result | jobId,got? | status,error?,targets；got 为已取目标索引 |
| POST /api/segment/retry | jobId,index,actionId | 操作状态；-1 整体/全部失败项，非负为指定目标 |
| GET /api/segment/jobs | 无 | jobs；当前账号未完成/有失败任务 |
| POST /api/track | event,session_id,page,props | 匿名或无统计授权时忽略 |
| GET /api/admin/stats | days? | 管理员 Bearer ADMIN_TOKEN，最多 30 日 |

aiReady 只反映模型密钥存在，不证明预算、授权或真实供应商可用。CORS 允许 APK localhost origin 和 ALLOWED_ORIGINS；CORS 不代替鉴权。

## 同步结构

push 的 changes 项是 {kind,id,data,deleted,expectedVersion}。列表 kind 为 customItems/customOutfits/models/history；成员为 favorites/wardrobe/deletedItems/processedSegmentTargets，data=true；设置 kind=setting，id 为 account/profile/onboarded/privacyOk/curModel/historySeeded。

账号只同步 nick/avatar。实体最多 64,000 字节；主要列表最多 1000，自配搭配含 1～4 个唯一 ID、名称最多 80 字符。图片必须先上传，仅指定图片字段可用 media 引用。

响应 results 每项为 {key,status,current}；current 包含 kind,id,data,version,deleted。客户端不得把 push 回执当作 pull 游标。分页语义与媒体宽限见 [M4](../modules/m4-sync.md)。

旧 /api/state/pull、push 仅供未迁移快照使用，首次 v2 同步原子迁移后返回 426。不要混用两套写协议。

## AI 动作幂等

每次明确点击生成、整理或重试创建 actionId（8～100 位字母/数字/下划线/连字符）。客户端发请求前保存编号，同次重传必须复用编号和请求体。服务端在同一事务内绑定动作、任务及次数；动作回执没有 TTL，账号注销时清理。

重复动作始终返回已绑定任务，不因任务失败或结果被删除启动下一轮。用户重新点击且原试穿已删时，由服务端创建后继任务并保留原墓碑；查询与旧 POST 不走此分支。过期任务按 ID 重试返回 410，重新选择完整输入后可明确确认 retry:true，保留原操作累计上限。

## AI 输入与结果

TRYON：modelImage,modelId,outfitId?,scene?,items:[{id,category,image}]；RECOMMEND：wardrobe:[{id,category,name,custom,gender,labels}],around?；VALIDATE：image。模型/提示词由服务端控制。

试穿 done 返回 image 引用、record 与 mock；推荐返回 items/reason；质检返回 pass 等。SPLIT 由 segment/start 创建，目标 state 为 pending/running/done/fail，稳定衣物 ID 为 c_<jobId>_<index>。父任务 done 不表示所有目标都成功，客户端展示逐件失败。

旧 /api/segment、detect、segment-one、validate-photo、recommend、tryon 已封闭供应商路径，配置满足时返回 426，缺配置时可返回 503。不能绕过任务、授权和预算。
