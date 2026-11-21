const crypto=require('node:crypto'),store=require('./store'),control=require('./ai-control'),segment=require('./ai/segment'),media=require('./media'),sync=require('./sync-v2');
const {transaction,db}=require('./database'),key=id=>'segjob:'+id,fail=control.fail;
function owned(owner,id){const m=store.get(key(id));if(!m||m.owner!==owner)throw fail('任务不存在',404);return m;}
const save=(id,m)=>store.set(key(id),m);
async function one(owner,id,index){let m=owned(owner,id),t=m.targets[index];if(t.state==='done')return;
 control.assertCurrent();t.state='running';save(id,m);
 try{const ref=store.get(key(id)+':img');if(!ref)throw fail('原照片已过期，请重新选择',410);
  const imageInput=media.inflate(owner,ref);
  const result=require('./auth').demo?{item:{image:imageInput,category:'上衣',name:'演示衣物'}}:await segment.segmentOne({image:imageInput,target:t,strict:true,flatImage:t.flat?media.inflate(owner,t.flat):null,onFlat:async data=>{control.assertCurrent();const flat=media.upload(owner,data);transaction(()=>{control.assertCurrent();const current=owned(owner,id);current.targets[index].flat=flat;save(id,current);const input=db.prepare('SELECT data FROM operation_inputs WHERE id=?').get(id);if(input){const saved=JSON.parse(input.data);saved.stages=current.targets.map(x=>x.flat).filter(Boolean);db.prepare('UPDATE operation_inputs SET data=? WHERE id=?').run(JSON.stringify(saved),id);}});}});control.assertCurrent();
  const image=media.upload(owner,result.item.image),item={...result.item,image,id:'c_'+id+'_'+index,sourceJob:id};
  const garment={id:item.id,name:String(item.name||'我的衣物').slice(0,80),cat:item.category||'上衣',scene:item.labels?.['适用场景']||'日常',dataUrl:image,ph:'tee',labels:item.labels||null,source:'ai',sourceJob:id,createdAt:Date.now(),updatedAt:Date.now()};
  transaction(()=>{control.assertCurrent();sync.generated(owner,{kind:'customItems',id:garment.id,data:garment});store.set(key(id)+':item:'+index,item);m=owned(owner,id);m.targets[index].state='done';save(id,m);});
 }catch(e){control.assertCurrent();m=owned(owner,id);m.targets[index].state='fail';m.targets[index].error=e.control||e.status?e.message:'处理结果未确认，重试可能再次消耗额度';save(id,m);throw e;}
}
async function processJob(owner,id){let m=owned(owner,id);
 try{
  if(!m.targets.length){const ref=store.get(key(id)+':img');if(!ref)throw fail('原照片已过期，请重新选择',410);const {items}=require('./auth').demo?{items:[{category:'上衣',description:'演示衣物'}]}:await segment.detect({image:media.inflate(owner,ref)});control.assertCurrent();m.targets=items.slice(0,3).map(t=>({...t,state:'pending'}));m.status='running';save(id,m);}
  let last;for(let i=0;i<m.targets.length;i++){try{await one(owner,id,i);}catch(e){last=e;if(e.control)break;}}
  control.assertCurrent();m=owned(owner,id);m.status='done';save(id,m);if(last)throw last;return {jobId:id};
 }catch(e){control.assertCurrent();m=owned(owner,id);m.status=m.targets.length?'done':'error';m.error=e.control?e.message:'处理未完成，请主动重试';save(id,m);throw e;}
}
for(const [k,m]of store.entries('segjob:'))if(m.owner){if(['detecting','running'].includes(m.status)){m.status=m.targets.length?'done':'error';m.error='任务中断，重试可能再次消耗额度';for(const t of m.targets)if(!['done','fail'].includes(t.state)){t.state='fail';t.error=m.error;}}store.set(k,m);}
function start(owner,image,requestId,unused,retry=false){
 if(typeof requestId!=='string'||!/^[\w-]{8,100}$/.test(requestId))throw fail('缺少 requestId');
 const idem='segment-idem:'+owner+':'+requestId,digest=crypto.createHash('sha256').update(image).digest('hex'),old=store.get(idem);
 if(old){if(typeof old==='string')return {jobId:old};if(old.digest!==digest)throw fail('同一请求编号不能更换图片',409);return {jobId:old.id};}
 const ref=image.startsWith('media:')?image:'media:'+media.hash(require('./state').decodeImage(image).b);
 const cached=control.find(owner,'SPLIT',{image:ref});if(cached&&['done','queued','running'].includes(cached.status))return {jobId:cached.id,operationId:cached.id,status:cached.status};
 require('./ai-service').configured('SPLIT');control.requireConsent(owner);if(!image.startsWith('media:'))media.upload(owner,image);media.validateRefs(owner,ref);
 const op=control.start(owner,'SPLIT',{image:ref},id=>processJob(owner,id),{retry,renewExpired:retry});
 let meta=store.get(key(op.operationId));if(!meta)meta={owner,status:'detecting',ts:Date.now(),targets:[]};
 if(retry){for(const t of meta.targets){if(t.flat)try{media.validateRefs(owner,t.flat);}catch{delete t.flat;}if(t.state!=='done'){t.state='pending';delete t.error;}}meta.status=meta.targets.length?'running':'detecting';delete meta.error;}
 save(op.operationId,meta);store.set(key(op.operationId)+':img',ref,7*86400);
 const inputRow=db.prepare('SELECT data FROM operation_inputs WHERE id=?').get(op.operationId);if(inputRow){const input=JSON.parse(inputRow.data);input.stages=meta.targets.map(t=>t.flat).filter(Boolean);db.prepare('UPDATE operation_inputs SET data=? WHERE id=?').run(JSON.stringify(input),op.operationId);}
 store.set(idem,{id:op.operationId,digest},7*86400);return {jobId:op.operationId,operationId:op.operationId,status:op.status};
}
function result(owner,id,got=[]){const m=owned(owner,id),taken=new Set(Array.isArray(got)?got:[]);return {status:m.status,error:m.error,targets:m.targets.map((t,i)=>{const e=sync.get(owner,'customItems','c_'+id+'_'+i);return {...t,item:t.state==='done'&&!taken.has(i)&&!e?.deleted?store.get(key(id)+':item:'+i):undefined};})};}
function retry(owner,id,index){
 const m=owned(owner,id);if(index===-1&&m.status==='error'){
  const ref=store.get(key(id)+':img');if(!ref)throw fail('原照片已过期',410);control.start(owner,'SPLIT',{image:ref},op=>processJob(owner,op),{retry:true});m.status='detecting';save(id,m);return {...control.output(control.owned(owner,id)),ok:true};
 }
 const t=m.targets[index];if(!Number.isInteger(index)||(index!==-1&&!t))throw fail('目标不存在');if(index!==-1&&t.state!=='fail')return {ok:false};
 if(!store.get(key(id)+':img'))throw fail('原照片已过期，请重新上传',410);
 // Retry the original operation: successful targets are skipped and all attempts share its budget.
 const ref=store.get(key(id)+':img');const op=control.start(owner,'SPLIT',{image:ref},op=>processJob(owner,op),{retry:true});
 if(op.status!=='done'){for(const target of m.targets)if(target.state==='fail'){target.state='pending';delete target.error;}m.status='running';save(id,m);}return {...control.output(control.owned(owner,id)),ok:true};
}
function list(owner){return store.entries('segjob:').filter(([,v])=>v.owner===owner).map(([k,v])=>({jobId:k.slice(7),status:v.status,ts:v.ts}));}
module.exports={start,result,retry,list};
