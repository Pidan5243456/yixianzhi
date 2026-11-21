# HTTP 接口契约

更新：2026-11-21。现行路由来源：[server.js](../../server/server.js)、[auth.js](../../server/auth.js)。新增协议不在本文现行接口表中冒充已提供能力。

## 通用约定

请求和响应使用 JSON。除健康检查、验证码、登录、埋点以及单独管理员鉴权外，均要求 `Authorization: Bearer <token>`。身份来自服务端验证的令牌，不接受请求体指定 owner。

失败响应基本为 `{ "error": "可展示的信息" }`；同步 409 另带当前 `version`。目前没有统一业务错误码协议，新网关的 code 还未完整透传。413 表示请求/图片大小超限，429 表示限流或配额，503 表示配置或服务不可用。

Express JSON 上限 30 MiB。允许的 origin 包括 APK 的 `https://localhost`、`http://localhost` 及 `ALLOWED_ORIGINS`；CORS 不是鉴权措施。API 响应不缓存。

## 当前已挂载路由

| 方法与路径 | 输入 | 主要输出及限制 |
|---|---|---|
| GET `/api/health` | 无 | `ok,service,syncVersion,demo,aiReady`；当前 syncVersion=1，aiReady 仅检查两项密钥存在 |
| POST `/api/auth/send-code` | `email` | `{ok:true}`；开发演示条件满足时另有 devCode |
| POST `/api/auth/login` | `email,code` | `{email,token}`；验证码单次消费 |
| POST `/api/state/pull` | `{}` | `{state,version,schemaVersion:1}`；有快照时另有 dataVersion、updatedAt |
| POST `/api/state/push` | `schemaVersion:1,expectedVersion,state` | `{ok,version,schemaVersion:1,dataVersion:2,updatedAt}`；版本冲突 409 |
| POST `/api/segment/start` | `image,requestId` | `{jobId}`；requestId 为 8～100 位字母/数字/下划线/连字符 |
| POST `/api/segment/result` | `jobId,got?` | `status,error?,targets`；got 是已取得结果的目标序号数组 |
| POST `/api/segment/retry` | `jobId,index` | `{ok}`；输入过期 410；他人任务 404 |
| GET `/api/segment/jobs` | 无 | `{jobs:[{jobId,status,ts}]}`，只含当前账号 |
| POST `/api/segment` | `image` | 旧同步拆图返回；保留兼容，不是当前主要入口 |
| POST `/api/detect` | `image` | 识别目标 `items`；旧兼容接口 |
| POST `/api/segment-one` | `image,target` | 单个处理结果 `item`；旧兼容接口 |
| POST `/api/validate-photo` | `image` | `pass,fail_reasons,primary_reason` 等；页面不再自动调用 |
| POST `/api/recommend` | `wardrobe,around?` | `{items:[id],reason}`；规则回退可能带 fallback；候选最多 1000 |
| POST `/api/tryon` | `modelImage,items` | `{image}`；items 为 1～4 个 `{id,category,image}` |
| POST `/api/track` | `event,session_id,page,props` | `{ok:true}`；当前允许匿名，尚未接入服务端统计授权 |
| GET `/api/admin/stats` | `token,days?` 查询参数 | 管理统计；要求 ADMIN_TOKEN；当前查询令牌方式待改为请求头 |

直接 AI 路由仍在统一网关接入中，挂载不等于配置密钥后即可完整工作。健康检查 aiReady 也不表示已取得授权、预算可用或真实模型联调通过。

## 快照同步示例

```json
{
  "schemaVersion": 1,
  "expectedVersion": 0,
  "state": {
    "dataVersion": 2,
    "account": {"nick": "小衣", "avatar": ""},
    "customItems": [],
    "customOutfits": [],
    "favorites": [],
    "models": [],
    "history": []
  }
}
```

未出现的列表字段由服务端补空；不能用这个示例更新已有账号而期待未传字段自动保留。它是完整替换快照接口。account 中的 token/email 会被剔除，模型密钥不能传入。

图片只允许指定路径中的 PNG/JPEG/WebP data URL，单张解码后不超过 3 MiB。当前客户端不能传入内部 `media:` 引用。主要列表最多 1000，processedSegmentTargets 最多 10000；自配搭配 1～4 个唯一衣物 ID，名称最多 80 字符。

`expectedVersion` 是当前账号快照版本；不是产品版本、dataVersion 或数据库迁移号。对于已有 dataVersion=2 的快照，旧业务版本写入返回 426。整份冲突选择机制见 [M4](../modules/m4-sync.md)。

## 拆图查询

任务状态由 jobs 模块维护；目标 state 为 pending/running/done/fail。已完成目标可带 item；客户端通过 got 只取尚未落库的结果。目标 ID 使用 `c_<jobId>_<index>`，避免丢回执后重复新增。

当前目标结果保留逻辑与新的 ai_operations 状态尚有收尾差异；不能将 jobs 的 done 理解成所有子项成功。含 fail 子项时应展示逐件错误。

## 待实现接口领域

独立授权查询/授予/撤回、通用 AI 操作提交/查询/主动重试、逐实体增量拉取/推送、独立图片上传/读取、服务端退出和账号注销。具体协议需实施后更新此表；现在调用这些新增路径会得到 404。

目标约束分别见 [M0](../modules/m0-system.md)、[M3](../modules/m3-ai.md)、[M4](../modules/m4-sync.md)。数据库结构见 [数据字典](database.md)。
