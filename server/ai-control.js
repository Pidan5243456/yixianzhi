/* A single process reserves every supplier attempt before sending it. */
const crypto=require('node:crypto'),{AsyncLocalStorage}=require('node:async_hooks');
const {db,transaction,ensureUser}=require('./database'),store=require('./store'),E=require('../js/entities');
const context=new AsyncLocalStorage(),hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const fail=(message,status=400,code)=>Object.assign(new Error(message),{status,code,control:true});
const demo=()=>process.env.NODE_ENV!=='production'&&process.env.DEMO_MODE==='true';
const day=()=>new Date().toISOString().slice(0,10);
function integer(name,fallback=0){const v=process.env[name]===undefined?fallback:Number(process.env[name]);if(!Number.isSafeInteger(v)||v<0||v>1e12)throw fail('AI 额度配置错误：'+name,503);return v;}
function consent(owner,purpose='ai_processing'){return db.prepare('SELECT granted FROM consents WHERE owner=? AND purpose=?').get(owner,purpose)?.granted===1;}
function requireConsent(owner){if(!demo()&&!consent(owner))throw fail('请先同意 AI 处理所选照片和衣物资料',403,'CONSENT_REQUIRED');}
function setConsent(owner,purpose,granted){if(!['ai_processing','analytics'].includes(purpose)||typeof granted!=='boolean')throw fail('授权格式错误');ensureUser(owner);db.prepare('INSERT INTO consents VALUES(?,?,1,?,?) ON CONFLICT(owner,purpose) DO UPDATE SET version=1,granted=excluded.granted,updated_at=excluded.updated_at').run(owner,purpose,Number(granted),Date.now());return {purpose,granted,version:1};}
function dailyLimit(kind){return integer('QUOTA_'+kind+'_PER_DAY',{SPLIT:5,TRYON:20,VALIDATE:30,RECOMMEND:50}[kind]||5);}
function quota(owner,kind){return Math.max(0,dailyLimit(kind)-(store.get('quota:'+kind+':'+owner+':'+day())||0));}
function output(row){return {operationId:row.id,kind:row.kind,status:row.status,...(row.status==='done'?JSON.parse(row.result||'{}'):{}),...(row.error?{error:row.error}:{}),updatedAt:row.updated_at};}
function owned(owner,id){const row=db.prepare('SELECT * FROM ai_operations WHERE owner=? AND id=?').get(owner,id);if(!row)throw fail('任务不存在',404);return row;}
function fingerprint(input){const clean={...input};delete clean.retry;delete clean.requestId;return hash(E.json({input:clean,models:require('./ai/config').MODELS,promptVersion:'2026-11-21-v2'}));}
function find(owner,kind,input){return db.prepare('SELECT * FROM ai_operations WHERE owner=? AND kind=? AND fingerprint=?').get(owner,kind,fingerprint(input));}
function assertCurrent(ctx=context.getStore()){
 if(!ctx)throw fail('缺少 AI 操作上下文',503);require('./auth').requireGeneration(ctx.owner,ctx.generation);
 const row=owned(ctx.owner,ctx.id);if(row.cycle!==ctx.cycle||!['queued','running'].includes(row.status))throw fail('任务状态已变更',409);return ctx;
}
function start(owner,kind,input,fn,{retry=false,renewExpired=false}={}){
 ensureUser(owner);const generation=require('./auth').generation(owner);
 const clean={...input};delete clean.retry;delete clean.requestId;
 const digest=fingerprint(clean);
 let created=false;
 const row=transaction(()=>{
  const old=find(owner,kind,clean);
  if(old&&['done','queued','running'].includes(old.status))return old;
  requireConsent(owner);
  if(old&&(!retry||Date.now()-old.updated_at<10000))throw fail('上次任务未完成，重试可能再次消耗额度',409,'AI_RETRY_REQUIRED');
  const expired=old&&!db.prepare('SELECT 1 FROM operation_inputs WHERE id=? AND expires_at>?').get(old.id,Date.now());
  if(expired&&!renewExpired)throw fail('原输入已过期，请重新选择照片后提交',410);
  if(db.prepare("SELECT count(*) n FROM ai_operations WHERE owner=? AND status IN ('queued','running')").get(owner).n>=3||db.prepare("SELECT count(*) n FROM ai_operations WHERE status IN ('queued','running')").get().n>=integer('AI_MAX_OPERATIONS',12))throw fail('已有任务正在处理，请稍后再试',429);
  if(!quota(owner,kind))throw fail('今日可用次数已用完',429,'QUOTA');
  store.incr('quota:'+kind+':'+owner+':'+day(),172800);
  const id=old?.id||crypto.randomUUID(),now=Date.now();
  db.prepare('INSERT INTO ai_operations VALUES(?,?,?,?,?,NULL,NULL,?,?,1) ON CONFLICT(id) DO UPDATE SET status=excluded.status,result=NULL,error=NULL,updated_at=excluded.updated_at,cycle=ai_operations.cycle+1').run(id,owner,kind,digest,'queued',now,now);
  if(!old||expired)db.prepare('INSERT OR REPLACE INTO operation_inputs VALUES(?,?,?)').run(id,JSON.stringify(clean),now+7*86400000);
  created=true;return owned(owner,id);
 });
 if(created)setImmediate(()=>context.run({owner,id:row.id,cycle:row.cycle,generation},async()=>{
  try{
   assertCurrent();db.prepare("UPDATE ai_operations SET status='running',updated_at=? WHERE id=? AND cycle=?").run(Date.now(),row.id,row.cycle);
   const result=await fn(row.id);assertCurrent();
   // Consent gates sending, not reading or retaining an already produced result.
   transaction(()=>{assertCurrent();if(typeof result?.commit==='function')result.commit();const value=typeof result?.commit==='function'?result.value:result;db.prepare("UPDATE ai_operations SET status='done',result=?,updated_at=? WHERE id=? AND cycle=?").run(JSON.stringify(value),Date.now(),row.id,row.cycle);});
  }catch(e){try{assertCurrent();db.prepare('UPDATE ai_operations SET status=?,error=?,updated_at=? WHERE id=? AND cycle=?').run(e.control||e.status?'failed':'unknown',e.control||e.status?e.message:'处理结果未确认，重试可能再次消耗额度',Date.now(),row.id,row.cycle);}catch{/* Revoked generation must never recreate rows. */}}
 }));return output(row);
}
async function boundedResponse(response,max=8*1024*1024){if(Number(response.headers.get('content-length'))>max)throw fail('供应商响应过大',502);const reader=response.body?.getReader(),parts=[];let size=0;if(reader)try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max)throw fail('供应商响应过大',502);parts.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}return new Response(Buffer.concat(parts),{status:response.status,headers:response.headers});}
async function providerFetch(provider,url,options){
 if(demo())throw fail('演示模式禁止供应商调用',503,'DEMO_NO_PROVIDER');
 const ctx=assertCurrent();requireConsent(ctx.owner);
 const body=JSON.parse(options.body),model=body.model,maximum=integer('AI_MAX_'+provider.toUpperCase()+'_MICRO_USD');
 const globalLimit=integer('AI_GLOBAL_DAILY_MICRO_USD'),userLimit=integer('AI_USER_DAILY_MICRO_USD');
 if(!maximum||!globalLimit||!userLimit)throw fail('AI 预算尚未配置或已关闭',503,'BUDGET_DISABLED');
 if(Buffer.byteLength(options.body)>20*1024*1024)throw fail('AI 请求过大',413);
 const attempt=crypto.randomUUID(),budgetDay=day();
 transaction(()=>{
  assertCurrent();requireConsent(ctx.owner);
  if(db.prepare("SELECT count(*) n FROM ai_usage WHERE status='reserved'").get().n>=integer('AI_MAX_CONCURRENCY',6))throw fail('AI 服务繁忙，请稍后重试',429);
  const total=db.prepare('SELECT coalesce(sum(reserved),0) n FROM ai_usage WHERE budget_day=?').get(budgetDay).n;
  const user=db.prepare('SELECT coalesce(sum(reserved),0) n FROM ai_usage WHERE budget_day=? AND owner=?').get(budgetDay,ctx.owner).n;
  const op=db.prepare('SELECT count(*) n,coalesce(sum(reserved),0) cost FROM ai_usage WHERE operation_id=?').get(ctx.id);
  if(op.n>=integer('AI_MAX_ATTEMPTS_PER_OPERATION',16)||op.cost+maximum>integer('AI_MAX_OPERATION_MICRO_USD',1000000))throw fail('本次任务已达到尝试上限',429);
  if(total+maximum>globalLimit||user+maximum>userLimit)throw fail('今日 AI 预算已用完',429,'BUDGET');
  db.prepare('INSERT INTO ai_usage VALUES(?,?,?,?,?,?,?,?,NULL,?,NULL)').run(attempt,ctx.id,ctx.owner,provider,model,budgetDay,maximum,'reserved',Date.now());
 });
 let status='unknown',usage=null;
 try{
  const signal=options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(150000)]):AbortSignal.timeout(150000);
  const response=await boundedResponse(await fetch(url,{...options,signal}));
  const data=await response.clone().json();usage=JSON.stringify({id:data.id||data.request_id||null,tokens:data.usage?.total_tokens||null,cost:data.usage?.cost??null});status=response.ok?'returned':'rejected';return response;
 }finally{db.prepare('UPDATE ai_usage SET status=?,usage=?,finished_at=? WHERE id=?').run(status,usage,Date.now(),attempt);}
}
db.exec("UPDATE ai_operations SET status='unknown',error='服务重启中断，重试可能再次消耗额度' WHERE status IN ('queued','running'); UPDATE ai_usage SET status='unknown' WHERE status='reserved';");
module.exports={start,find,owned,output,providerFetch,boundedResponse,assertCurrent,consent,setConsent,requireConsent,integer,quota,context,fail};
