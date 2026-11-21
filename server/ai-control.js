/* One Node process per SQLite volume. Budgets are conservative reservations, not provider invoices. */
const crypto=require('node:crypto'),{AsyncLocalStorage}=require('node:async_hooks');
const {db,transaction,ensureUser}=require('./database'),store=require('./store');
const context=new AsyncLocalStorage();
const fail=(message,status=400,code)=>Object.assign(new Error(message),{status,code,control:true});
const day=()=>new Date().toISOString().slice(0,10); // UTC, including every retry's own day.
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
function canonical(v){if(Array.isArray(v))return v.map(canonical);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]));return v;}
function integer(name,fallback=0){const v=process.env[name]===undefined?fallback:Number(process.env[name]);if(!Number.isSafeInteger(v)||v<0||v>1e12)throw fail('AI 额度配置错误：'+name,503);return v;}
function consent(owner,purpose='ai_processing'){return db.prepare('SELECT granted,version FROM consents WHERE owner=? AND purpose=?').get(owner,purpose)?.granted===1;}
function requireConsent(owner){if(!consent(owner))throw fail('请先同意 AI 处理所选照片和衣物资料',403,'CONSENT_REQUIRED');}
function setConsent(owner,purpose,granted){if(!['ai_processing','analytics'].includes(purpose)||typeof granted!=='boolean')throw fail('授权格式错误');ensureUser(owner);db.prepare('INSERT INTO consents VALUES(?,?,1,?,?) ON CONFLICT(owner,purpose) DO UPDATE SET version=1,granted=excluded.granted,updated_at=excluded.updated_at').run(owner,purpose,Number(granted),Date.now());return {purpose,granted,version:1};}
function dailyLimit(kind){return integer('QUOTA_'+kind+'_PER_DAY',{SPLIT:5,TRYON:20,VALIDATE:30,RECOMMEND:50}[kind]||5);}
function quota(owner,kind){return Math.max(0,dailyLimit(kind)-(store.get('quota:'+kind+':'+owner+':'+day())||0));}
function charge(owner,kind){const limit=dailyLimit(kind),key='quota:'+kind+':'+owner+':'+day();if(!limit||!quota(owner,kind))throw fail('今日可用次数已用完',429,'QUOTA');store.incr(key,172800);}
function output(row){let result=row.result?JSON.parse(row.result):null;return {operationId:row.id,status:row.status,...(row.status==='done'?{...result}:{}),...(row.error?{error:row.error}:{}),updatedAt:row.updated_at};}
function owned(owner,id){const row=db.prepare('SELECT * FROM ai_operations WHERE owner=? AND id=?').get(owner,id);if(!row)throw fail('任务不存在',404);return row;}
function start(owner,kind,input,fn,{retry=false}={}){
 const demo=process.env.NODE_ENV!=='production'&&process.env.DEMO_MODE==='true';
 if(!demo)requireConsent(owner);
 const clean={...input};delete clean.retry;delete clean.requestId;
 const fingerprint=hash(JSON.stringify(canonical({input:clean,models:require('./ai/config').MODELS,promptVersion:'2026-11-21-v2'})));
 let created=false;
 const row=transaction(()=>{
  ensureUser(owner);
  let old=db.prepare('SELECT * FROM ai_operations WHERE owner=? AND kind=? AND fingerprint=?').get(owner,kind,fingerprint);
  if(old&&['done','queued','running'].includes(old.status))return old;
  if(old&&(!retry||Date.now()-old.updated_at<10000))throw fail('上次任务未完成，重新提交可能再次消耗额度',409,'AI_RETRY_REQUIRED');
  if(db.prepare("SELECT count(*) n FROM ai_operations WHERE owner=? AND status IN ('queued','running')").get(owner).n>=3)throw fail('已有任务正在处理，请稍后再试',429);
  if(db.prepare("SELECT count(*) n FROM ai_operations WHERE status IN ('queued','running')").get().n>=integer('AI_MAX_OPERATIONS',12))throw fail('服务繁忙，请稍后再试',429);
  charge(owner,kind);
  const id=old?.id||crypto.randomUUID(),now=Date.now();
  db.prepare('INSERT INTO ai_operations VALUES(?,?,?,?,?,NULL,NULL,?,?,1) ON CONFLICT(id) DO UPDATE SET status=excluded.status,result=NULL,error=NULL,updated_at=excluded.updated_at,cycle=ai_operations.cycle+1').run(id,owner,kind,fingerprint,'queued',now,now);
  created=true;return owned(owner,id);
 });
 if(created)setImmediate(()=>context.run({owner,id:row.id},async()=>{
  db.prepare("UPDATE ai_operations SET status='running',updated_at=? WHERE id=?").run(Date.now(),row.id);
  try{const result=await fn(row.id);if(!demo)requireConsent(owner);db.prepare("UPDATE ai_operations SET status='done',result=?,updated_at=? WHERE id=?").run(JSON.stringify(result),Date.now(),row.id);}
  catch(e){const status=e.control?'failed':'unknown';db.prepare('UPDATE ai_operations SET status=?,error=?,updated_at=? WHERE id=?').run(status,e.control?e.message:'处理未完成，请检查任务后决定是否重试',Date.now(),row.id);}
 }));
 return output(row);
}
async function providerFetch(provider,url,options){
 const ctx=context.getStore();if(!ctx)throw fail('缺少 AI 操作上下文',503);
 requireConsent(ctx.owner);
 const body=JSON.parse(options.body),model=body.model;
 const maximum=integer('AI_MAX_'+provider.toUpperCase()+'_MICRO_USD');
 const globalLimit=integer('AI_GLOBAL_DAILY_MICRO_USD'),userLimit=integer('AI_USER_DAILY_MICRO_USD');
 if(!maximum||!globalLimit||!userLimit)throw fail('AI 预算尚未配置或已关闭',503,'BUDGET_DISABLED');
 if(Buffer.byteLength(options.body)>20*1024*1024)throw fail('AI 请求过大',413);
 const attempt=crypto.randomUUID(),budgetDay=day();
 transaction(()=>{
  requireConsent(ctx.owner);
  const active=db.prepare("SELECT count(*) n FROM ai_usage WHERE status='reserved'").get().n;
  if(active>=integer('AI_MAX_CONCURRENCY',6))throw fail('AI 服务繁忙，请稍后重试',429);
  const total=db.prepare('SELECT coalesce(sum(reserved),0) n FROM ai_usage WHERE budget_day=?').get(budgetDay).n;
  const user=db.prepare('SELECT coalesce(sum(reserved),0) n FROM ai_usage WHERE budget_day=? AND owner=?').get(budgetDay,ctx.owner).n;
  const op=db.prepare('SELECT count(*) n,coalesce(sum(reserved),0) cost FROM ai_usage WHERE operation_id=?').get(ctx.id);
  if(op.n>=integer('AI_MAX_ATTEMPTS_PER_OPERATION',16)||op.cost+maximum>integer('AI_MAX_OPERATION_MICRO_USD',1000000))throw fail('本次任务已达到尝试上限',429);
  if(total+maximum>globalLimit||user+maximum>userLimit)throw fail('今日 AI 预算已用完',429,'BUDGET');
  db.prepare('INSERT INTO ai_usage VALUES(?,?,?,?,?,?,?,?,NULL,?,NULL)').run(attempt,ctx.id,ctx.owner,provider,model,budgetDay,maximum,'reserved',Date.now());
 });
 let status='unknown',usage=null;
 try{const response=await fetch(url,options);const data=await response.clone().json();
  usage=JSON.stringify({id:data.id||data.request_id||null,tokens:data.usage?.total_tokens||null,cost:data.usage?.cost??null});status=response.ok?'returned':'rejected';return response;
 }finally{db.prepare('UPDATE ai_usage SET status=?,usage=?,finished_at=? WHERE id=?').run(status,usage,Date.now(),attempt);}
}
// A sent request may have been charged. Startup never automatically replays it.
db.exec("UPDATE ai_operations SET status='unknown',error='服务重启中断，请检查后再决定是否重试' WHERE status IN ('queued','running'); UPDATE ai_usage SET status='unknown' WHERE status='reserved';");
module.exports={start,owned,output,providerFetch,consent,setConsent,requireConsent,integer,quota,context,fail};
