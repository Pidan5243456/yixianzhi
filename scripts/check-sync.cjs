const {chromium}=require('@playwright/test');
const assert=require('node:assert/strict'),path=require('node:path');
process.env.NODE_ENV='test';process.env.DEMO_MODE='true';process.env.AUTH_SECRET='sync-tests-secret-with-over-32-characters';
process.env.OPENROUTER_API_KEY='';process.env.DASHSCOPE_API_KEY='';process.env.DM_ACCESS_KEY_ID='';process.env.DM_ACCESS_KEY_SECRET='';
process.env.DATA_DIR=path.resolve('.tooling/tests/sync-'+Date.now());
const realFetch=global.fetch;global.fetch=(url,options)=>{if(!String(url).startsWith('http://127.0.0.1:'))throw new Error('External network prohibited in tests');return realFetch(url,options);};
const app=require('../server/server');
(async()=>{
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const ca=await browser.newContext({viewport:{width:375,height:812}}),cb=await browser.newContext({viewport:{width:375,height:812}});
 const a=await ca.newPage(),b=await cb.newPage(),errors=[];for(const p of [a,b])p.on('pageerror',e=>errors.push(e.message));
 async function post(url,body,token){const r=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});return r.json();}
 const email='sync@example.com',sent=await post('/api/auth/send-code',{email}),login=await post('/api/auth/login',{email,code:sent.devCode});
 async function open(p){await p.goto(base+'/connection.html');await p.waitForFunction(()=>window.APP_READY);}
 try {
  for(const p of [a,b]){await open(p);await p.evaluate(async({email,token})=>{await LocalState.activate(email,token);CloudSync.stop();},login);}
  const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aFhUAAAAASUVORK5CYII=';
  await a.evaluate(async image=>{Store.set({customItems:[{id:'c_test',cat:'上衣',name:'我的衣服',dataUrl:image}],onboarded:true});CloudSync.stop();await CloudSync.run();},png);
  assert.equal(await a.evaluate(()=>LocalState.record.revision),1);
  await b.evaluate(()=>CloudSync.run({pull:true}));assert.equal(await b.evaluate(()=>Store.get().customItems[0].dataUrl),png);
  await a.evaluate(()=>{Store.set({profile:{...Store.get().profile,job:'本机修改'}});CloudSync.stop();});
  await b.evaluate(async()=>{Store.set({profile:{...Store.get().profile,job:'云端修改'}});CloudSync.stop();await CloudSync.run();});
  await a.evaluate(()=>CloudSync.run());assert.equal(await a.evaluate(()=>LocalState.record.conflict),true);assert.equal(await a.evaluate(()=>Store.get().profile.job),'本机修改');
  await a.evaluate(async()=>{const original=LocalState.backup;LocalState.backup=async function(label){await original.call(this,label);Store.set({profile:{...Store.get().profile,job:'备份期间的新修改'}});CloudSync.stop();};await CloudSync.run({choice:'cloud'});LocalState.backup=original;});
  assert.equal(await a.evaluate(()=>Store.get().profile.job),'备份期间的新修改');assert.equal(await a.evaluate(()=>LocalState.record.conflict),true);
  await a.evaluate(()=>CloudSync.run({choice:'cloud'}));assert.equal(await a.evaluate(()=>Store.get().profile.job),'云端修改');
  // A write failure blocks navigation and remains recoverable.
  await a.evaluate(async()=>{window.originalWrite=LocalState.write;LocalState.write=()=>Promise.reject(new Error('simulated disk full'));Store.set({profile:{...Store.get().profile,height:'175'}});CloudSync.stop();await AppNav.go('home.html');});
  assert.ok(a.url().endsWith('connection.html'));
  await a.evaluate(async()=>{LocalState.write=window.originalWrite;await LocalState.persist();});
  // A job received by the server is discovered even without a local receipt.
  const job=await post('/api/segment/start',{image:png,requestId:'lost-response-test'},login.token);
  await open(a);await a.waitForFunction(()=>Store.get().customItems.some(i=>i.id.startsWith('c_')&&i.id!=='c_test'));
  const generated=await a.evaluate(()=>Store.get().customItems.find(i=>i.id!=='c_test').id);
  assert.equal(generated,'c_'+job.jobId+'_0');
  await a.evaluate(async id=>{Store.set({customItems:Store.get().customItems.filter(i=>i.id!==id)});CloudSync.stop();await LocalState.flush();},generated);
  await open(a);await a.waitForTimeout(600);assert.equal(await a.evaluate(id=>Store.get().customItems.some(i=>i.id===id),generated),false);
  // Polling must not discard a task appended while the request is pending.
  await a.evaluate(async()=>{
    CloudSync.stop();const original=AppAPI.request;let release;window.pollGate=new Promise(r=>release=r);window.releasePoll=release;
    Store.set({pendingSegments:[{jobId:'old',ts:Date.now()}]});CloudSync.stop();
    AppAPI.request=async path=>{if(path==='/api/segment/result'){await window.pollGate;return {ok:true,json:async()=>({status:'done',targets:[]})};}throw new Error('test-blocked');};
    const running=pollSegmentJobs();Store.set({pendingSegments:[...Store.get().pendingSegments,{jobId:'new',ts:Date.now()}]});CloudSync.stop();release();await running;AppAPI.request=original;
  });
  assert.ok(await a.evaluate(()=>Store.get().pendingSegments.some(j=>j.jobId==='new')));
  // A delayed A response must not populate B while a cached page reloads its partition.
  const isolation=await b.evaluate(async()=>{
    CloudSync.stop();await LocalState.flush();
    const originalRequest=AppAPI.request,originalRead=LocalState.read;
    let releaseResponse,responseStarted,releaseRead,readStarted;
    const responseGate=new Promise(r=>releaseResponse=r),started=new Promise(r=>responseStarted=r);
    const readGate=new Promise(r=>releaseRead=r),reading=new Promise(r=>readStarted=r);
    const oldKey=LocalState.key,oldRecord=LocalState.record;
    const nextKey=AppAPI.scope+'|another@example.com';
    await LocalState.write(nextKey,{...LocalState.fresh(),state:{...Store.defaults(),account:{email:'another@example.com',token:'test-only'},customItems:[{id:'c_b',name:'B的衣服',cat:'上衣'}]}});
    AppAPI.request=async()=>({ok:true,json:async()=>{responseStarted();await responseGate;return {schemaVersion:1,version:88,state:{customItems:[{id:'c_a',name:'A的衣服',cat:'上衣'}]}};}});
    const pending=CloudSync.run({pull:true});await started;
    localStorage.setItem('yxz-active-account','another@example.com');
    LocalState.read=async function(key){readStarted();await readGate;return originalRead.call(this,key);};
    const loading=LocalState.load();await reading;
    const locked=LocalState.locked,writeRejected=Store.set({customItems:[{id:'unexpected'}]})===false;
    const publishedTogether=LocalState.key===oldKey&&LocalState.record===oldRecord;
    releaseRead();await loading;releaseResponse();await pending;
    AppAPI.request=originalRequest;LocalState.read=originalRead;CloudSync.stop();
    return {locked,writeRejected,publishedTogether,key:LocalState.key,email:Store.get().account.email,item:Store.get().customItems[0].id,revision:LocalState.record.revision};
  });
  assert.equal(isolation.locked,true);assert.equal(isolation.writeRejected,true);assert.equal(isolation.publishedTogether,true);
  assert.ok(isolation.key.endsWith('|another@example.com'));assert.equal(isolation.email,'another@example.com');assert.equal(isolation.item,'c_b');assert.equal(isolation.revision,0);
  assert.deepEqual(errors,[]);
  console.log('PASS: full photo sync, CAS conflict, mutation during backup, durable failure, lost receipt recovery, deleted item dedupe, polling concurrency, delayed response across account reload');
 }finally{await browser.close();await new Promise(r=>server.close(r));require('../server/database').db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
