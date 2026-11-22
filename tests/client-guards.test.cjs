const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
for(const kind of ['operation','cutout','tryon','recommend'])test('account switch during capability lookup blocks old input: '+kind,async()=>{
 const local={key:'A',epoch:1,locked:false};let release,started,uploads=0,consents=0;const began=new Promise(r=>started=r),gate=new Promise(r=>release=r);
 const context={LocalState:local,AppAPI:{demo:false},Consent:{ensure:async()=>consents++},MediaCache:{upload:async()=>{uploads++;return {};}},WardrobeModel:require('../js/wardrobe-model'),confirm:()=>true,console:{warn(){}},crypto:require('node:crypto')};
 vm.runInNewContext(fs.readFileSync('js/ai.js','utf8')+';globalThis.TestAI=AI;',context);const ai=context.TestAI;ai.capabilities=async()=>{started();await gate;return {INSPECT:{available:true},CUTOUT:{available:true},TRYON:{available:true},RECOMMEND:{available:true}};};
 const pending=kind==='operation'?ai.operation('INSPECT',{image:'old-photo'}):kind==='cutout'?ai.cutout({id:'old',cat:'上衣',dataUrl:'old-photo'}):kind==='tryon'?ai.tryon('old-person',[{id:'old',category:'上衣',image:'old-photo'}]):ai.recommend([{id:'old',cat:'上衣'}]);
 await began;local.key='B';local.epoch++;release();await assert.rejects(pending,/账号已切换/);assert.equal(uploads,0);assert.equal(consents,0);
});
