const crypto=require('node:crypto'),store=require('./store'),control=require('./ai-control'),segment=require('./ai/segment');
const key=id=>'segjob:'+id,fail=control.fail;
function owned(owner,id){const m=store.get(key(id));if(!m||m.owner!==owner)throw fail('任务不存在',404);return m;}
function save(id,m){store.set(key(id),m);}
async function one(owner,id,index){
 let m=owned(owner,id),t=m.targets[index];if(t.state==='done')return;
 t.state='running';save(id,m);
 try{
  const image=store.get(key(id)+':img');if(!image)throw fail('原照片已过期，请重新选择',410);
  const result=await segment.segmentOne({image,target:t,strict:true});result.item.id='c_'+id+'_'+index;result.item.sourceJob=id;
  require('./state').decodeImage(result.item.image);
  store.set(key(id)+':item:'+index,result.item);m=owned(owner,id);m.targets[index].state='done';
 }catch(e){m=owned(owner,id);m.targets[index].state='fail';m.targets[index].error=e.control?e.message:'处理未完成，可重试';}
 save(id,m);
}
async function processJob(owner,id){
 let m=owned(owner,id);
 if(!m.targets.length){const {items}=await segment.detect({image:store.get(key(id)+':img')});m.targets=items.slice(0,3).map(t=>({...t,state:'pending'}));m.status='running';save(id,m);}
 for(let i=0;i<m.targets.length;i++)await one(owner,id,i);
 m=owned(owner,id);m.status='done';save(id,m);return {jobId:id};
}
for(const [k,m] of store.entries('segjob:'))if(m.owner){if(['detecting','running'].includes(m.status)){m.status='done';if(!m.targets.length){m.status='error';m.error='任务中断，请重新提交';}for(const t of m.targets)if(!['done','fail'].includes(t.state)){t.state='fail';t.error='任务中断';}}store.set(k,m);for(let i=0;i<m.targets.length;i++){const item=store.get(k+':item:'+i);if(item)store.set(k+':item:'+i,item);}}
function start(owner,image,requestId,unused,retry=false){
 if(typeof requestId!=='string'||!/^[\w-]{8,100}$/.test(requestId))throw fail('缺少 requestId');
 const idem='segment-idem:'+owner+':'+requestId,digest=crypto.createHash('sha256').update(image).digest('hex'),old=store.get(idem);
 if(old){if(typeof old==='string')return {jobId:old};if(old.digest!==digest)throw fail('同一请求编号不能更换图片',409);return {jobId:old.id};}
 const op=control.start(owner,'SPLIT',{image},id=>processJob(owner,id),{retry});
 if(!store.get(key(op.operationId))){save(op.operationId,{owner,status:'detecting',ts:Date.now(),targets:[]});store.set(key(op.operationId)+':img',image,7*86400);}
 store.set(idem,{id:op.operationId,digest},7*86400);return {jobId:op.operationId};
}
function result(owner,id,got=[]){const m=owned(owner,id),taken=new Set(Array.isArray(got)?got:[]);return {status:m.status,error:m.error,targets:m.targets.map((t,i)=>({...t,item:t.state==='done'&&!taken.has(i)?store.get(key(id)+':item:'+i):undefined}))};}
function retry(owner,id,index){
 const m=owned(owner,id),t=m.targets[index];if(!Number.isInteger(index)||!t)throw fail('目标不存在');if(t.state!=='fail')return {ok:false};
 if(!store.get(key(id)+':img'))throw fail('原照片已过期，请重新上传',410);
 const op=control.start(owner,'SPLIT',{jobId:id,index},async()=>{await one(owner,id,index);return {jobId:id};},{retry:true});
 if(op.status!=='done'){t.state='pending';delete t.error;save(id,m);}return {ok:true};
}
function list(owner){return store.entries('segjob:').filter(([,v])=>v.owner===owner).map(([k,v])=>({jobId:k.slice(7),status:v.status,ts:v.ts}));}
module.exports={start,result,retry,list};
