# 本地 AI 接入契约

更新：2026-11-22；应用 1.5.0；adapter protocol=1。接口和替身验证已实现，真实模型尚未接入。实现位于 server/ai/local-gateway.js 和 server/ai-service.js。

## 部署边界

数据路径：Android APK → 衣先知后端 → 部署者的本地 adapter → 模型。APK 只配置衣先知后端根地址。LOCAL_AI_URL 是后端固定调用的完整 HTTP(S) 地址，不接受客户端传入 URL、模型或密钥。LOCAL_AI_TOKEN 仅在服务端通过 Authorization: Bearer 发送；禁止 URL 内账号、查询参数或 fragment，禁止跟随重定向。

后端与模型在同一台电脑时可用 http://127.0.0.1:8789/process。Docker 中的 127.0.0.1 指容器自身；同一 Compose 网络用服务名，Windows Docker Desktop 访问宿主机可用 host.docker.internal。手机的 localhost 指手机本身，不能作为电脑模型地址。跨不可信网络使用 HTTPS。

server/.env.example 中已提供：LOCAL_AI_URL、LOCAL_AI_TOKEN、LOCAL_AI_VERSION、LOCAL_AI_CAPABILITIES（逗号分隔 INSPECT,CUTOUT,TRYON）、LOCAL_AI_TIMEOUT_MS（默认120000，允许20～150000毫秒）。URL/版本/能力缺失时真实禁用。配置存在不代表连接或效果已验证；GET /api/ai/capabilities 返回每项 available/reason 和 connectionVerified:false。TRYON/CUTOUT 同时依赖 INSPECT。

预算须配置 AI_GLOBAL_DAILY_MICRO_USD、AI_USER_DAILY_MICRO_USD、AI_MAX_LOCAL_MICRO_USD 的正整数值。本版不提供零费用绕过模式；这些数字代表内部调用预留额度，不说明本地服务一定收费。INSPECT/CUTOUT 默认每天30/20次；所有调用还受现有并发、单操作累计尝试和额度限制。运行中的任务不会因为修改配置自动重发。

## 三种操作

| kind | 做什么 | 不做什么 |
|---|---|---|
| INSPECT | 判断图片是否适合指定用途，返回通过、拒绝或需重新选图；可建议标签 | 不生成衣物、不自动修改用户标签 |
| CUTOUT | 对已检查的单件衣物去背景，返回同尺寸透明 PNG | 不改款式、图案、颜色，不合成“相似衣物” |
| TRYON | 将已检查的衣物用于已检查的人物照片，生成效果图 | 不承诺实际尺码、合身或购买效果 |

普通上传只在本机压缩和保存，不触发以上操作。用户主动去背景/试穿前，会看到检查与处理可能消耗额度的确认。多件衣物、多个人、无目标或不适合照片，要求换成单件/单人照片；本版不自动选择多个目标，也不批量生成。

## APK → 后端

先按现有授权接口取得 ai_processing 同意，再上传图片得到私有 media:<sha256> 引用。每次明确动作携带新的 actionId；同次重传须复用 actionId 和完全相同请求体。以下是结构示例，图片引用需替换成真实上传结果。

~~~json
{"kind":"INSPECT","actionId":"inspect-user-action-001","input":{"image":"media:<sha256>","purpose":"garment","target":"上衣"}}
~~~

人物检查为 purpose=person,target=full_body；衣物为 purpose=garment,target=上衣/下装/鞋子/连体裙。POST /api/ai/operations 返回202和 operationId；GET /api/ai/operations/:id 查询。检查完成结果为 inspection=passed/rejected/needs_selection，附 reason 和可选 suggestions。只有 passed 可以继续。

~~~json
{"kind":"CUTOUT","actionId":"cutout-user-action-001","input":{"itemId":"c_<uuid>","image":"media:<original-sha256>","target":"上衣","inspectionId":"<garment-inspection-operation-id>"}}
~~~

~~~json
{"kind":"TRYON","actionId":"tryon-user-action-001","input":{"modelImage":"media:<person-sha256>","modelId":"u_<uuid>","inspectionId":"<person-inspection-operation-id>","items":[{"id":"c_<uuid>","category":"上衣","image":"media:<garment-sha256>","inspectionId":"<garment-inspection-operation-id>"}],"scene":"通勤","outfitId":"o_<uuid>","context":{"date":"2026-11-23","scene":"通勤","temperature":18}}}
~~~

服务器读取检查任务与冻结输入，核对当前账号、图哈希、purpose、target、adapterVersion、真实执行模式和有效输入期限。客户端 pass=true 无效；mock、fallback、失败、未知、错图、错用途和过期凭据均不能放行。试穿检查的是实际提交的显示图；去背景检查的是 originalImage。透明派生图用于试穿时需要它自身对应的检查。

检查缓存按图、用途、目标、版本及7日时间桶复用，输入最多保留7天；跨桶后首次主动处理重新检查。修改 LOCAL_AI_VERSION 使旧检查失效，更新模型/规则时应一起更新该版本。演示与真实模式使用不同缓存指纹。

## 后端 → 本地 adapter

固定 URL 接收 POST JSON。三个操作共用以下信封，必须原样回传 protocol、kind、operationId、adapterVersion。model 用于后端用量账本，当前为 local-加版本号，不允许 APK 指定。

~~~json
{
  "protocol":1,
  "kind":"INSPECT",
  "operationId":"<server-operation-id>",
  "adapterVersion":"my-model-v1",
  "model":"local-my-model-v1",
  "input":{
    "image":"data:image/jpeg;base64,<bytes>",
    "purpose":"garment",
    "target":"上衣",
    "adapterVersion":"my-model-v1",
    "processingMode":"real",
    "inspectionEpoch":2968
  }
}
~~~

input 是服务端冻结后的规范化输入，media 引用已在服务端转为 data URL。CUTOUT 输入包含 image,purpose,target,itemId,inspectionId,adapterVersion；TRYON 输入包含 modelImage,items,inspectionId,modelId,outfitId,scene,context,adapterVersion。图片都直接在 JSON 中，禁止返回外部下载 URL。

检查响应示例：

~~~json
{"protocol":1,"kind":"INSPECT","operationId":"<same-id>","adapterVersion":"my-model-v1","status":"passed","reason":"单件衣物，轮廓完整","suggestions":{"category":"上衣","color":"白色","warmth":"light"}}
~~~

status 也可为 rejected（例如未发现衣物）或 needs_selection（例如多件同类衣物）。reason 是不超过200字符的面向用户说明；suggestions 仅保留 category/color/warmth，每值最多40字符，当前不自动采纳。

去背景和试穿响应示例（TRYON 将 kind 改为 TRYON）：

~~~json
{"protocol":1,"kind":"CUTOUT","operationId":"<same-id>","adapterVersion":"my-model-v1","image":"data:image/png;base64,<transparent-png-bytes>"}
~~~

不得返回 mock 或 fallback 成功。adapter 可以返回非2xx表示明确拒绝；后端对外只给受控错误，不透传模型日志或密钥。

## 图片、任务和失败

单张图片最大3 MiB，PNG/JPEG/WebP，宽高64～4096像素、最多16777216像素，拒绝多帧和解码错误；输入/输出均真实解码。CUTOUT 必须有透明像素且与原图宽高相同。解码全局最多2张并发，单次任务的多张输入按顺序校验。供应商请求最大20 MiB、响应最大8 MiB；超时最多150秒。普通上传仍沿用3 MiB文件校验；以上更严格的尺寸/解码要求在 AI 执行前生效。

任务 queued → running → done / failed / unknown。422表示图片或检查不适用，409表示内容/版本变化，429表示次数/预算/并发限制，503表示配置关闭，502表示 adapter 拒绝或响应不符合契约。网络中断/超时可能已执行，记 unknown，保留预留额度且不自动重试。只有用户主动确认才重试，adapter 应按 operationId 去重并能返回已经完成的结果；同一操作可跨显式重试周期再次到达。

CUTOUT 完成先保存派生媒体，再在事务中确认衣物存在且 originalImage 未变，只合并 cutoutImage/dataUrl/processing/updatedAt。改名、购买状态和其他字段保留。结果含 applied:true，或 applied:false 和 reason（衣物已移除/原照片已更换）。未应用结果仍可在任务记录看到原因，不恢复已删衣物。原图在衣物存在期间保留；删除和注销仍按媒体回收规则执行。

TRYON 结果图片、history 实体及操作 done 原子提交。账号代次失效的回调不得落库；舞台按内容哈希识别换图，旧结果不会覆盖新选择。

## 验证与待接入

npm test 中的 local-ai.test.cjs 使用拦截式本地供应商替身，覆盖请求信封、成功/拒绝/多目标、非法图片/响应、超时、检查凭据、预算配置、撤回授权、幂等和晚结果。没有向真实模型发请求。替身通过不代表模型语义检查、去背景质量、试穿质量、速度或费用已经验收。配置完成后须在隔离账号做小额真实联调，再开放给用户。
