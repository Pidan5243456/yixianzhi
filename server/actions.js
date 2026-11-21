// A user action is bound once, even when its result is later deleted or retried.
const crypto=require('node:crypto'),{transaction}=require('./database'),store=require('./store'),control=require('./ai-control'),E=require('../js/entities');
function run(owner,actionId,request,fn){
 if(typeof actionId!=='string'||!/^[\w-]{8,100}$/.test(actionId)||actionId.length>100)throw control.fail('缺少有效 actionId');
 const key='ai-action:'+owner+':'+actionId,digest=crypto.createHash('sha256').update(E.json(request)).digest('hex');
 return transaction(()=>{const old=store.get(key);if(old){if(old.hash!==digest)throw control.fail('同一操作编号不能更换内容',409);const op=require('./ai-service').result(owner,old.operationId);return {...op,...(op.kind==='SPLIT'?{jobId:op.operationId}:{}),actionId,actionCycle:old.cycle};}
  const value=fn(),id=value.operationId||value.jobId;if(!id)throw control.fail('没有可重试的任务',409);const op=control.owned(owner,id);store.set(key,{owner,hash:digest,operationId:id,cycle:op.cycle});return {...value,actionId,actionCycle:op.cycle};
 });
}
module.exports={run};
