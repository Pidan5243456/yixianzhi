const {chromium}=require('@playwright/test'),assert=require('node:assert/strict'),path=require('node:path');
process.env.NODE_ENV='test';process.env.DEMO_MODE='true';process.env.AUTH_SECRET='sync-tests-secret-with-over-32-characters';
for(const k of ['OPENROUTER_API_KEY','DASHSCOPE_API_KEY','DM_ACCESS_KEY_ID','DM_ACCESS_KEY_SECRET'])process.env[k]='';
process.env.DATA_DIR=path.resolve('.tooling/tests/sync-'+Date.now());
const nativeFetch=global.fetch;global.fetch=(url,options)=>{if(!String(url).startsWith('http://127.0.0.1:'))throw Error('External calls prohibited');return nativeFetch(url,options);};
const app=require('../server/server');
(async()=>{
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const ca=await browser.newContext(),cb=await browser.newContext(),a=await ca.newPage(),b=await cb.newPage(),errors=[];for(const p of [a,b])p.on('pageerror',e=>errors.push(e.message));
 const post=async(p,body,token)=>{const r=await fetch(base+p,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});const result=await r.json();assert.ok(r.ok,JSON.stringify(result));return result;};
 const email='sync@example.com',sent=await post('/api/auth/send-code',{email}),login=await post('/api/auth/login',{email,code:sent.devCode});
 const open=async(p,file='connection.html')=>{await p.goto(base+'/'+file);await p.waitForFunction(()=>window.APP_READY);await p.evaluate(()=>{CloudSync.stop();CloudSync.schedule=()=>{};});};
 const sync=async p=>{const status=await p.evaluate(async()=>{while(CloudSync.busy)await new Promise(r=>setTimeout(r,10));await CloudSync.run();return CloudSync.message;});assert.ok(!status.startsWith('未同步'),status);};
 try{
  for(const p of [a,b]){await open(p);await p.evaluate(async login=>{await LocalState.activate(login.email,login.token,login.generation);},login);}
  const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aFhUAAAAASUVORK5CYII=';
  await a.evaluate(async image=>{Store.set({customItems:[{id:'c_one',cat:'上衣',name:'一',dataUrl:image},{id:'c_two',cat:'下装',name:'二',dataUrl:image}],onboarded:true});await LocalState.flush();},png);await sync(a);
  assert.equal(await a.evaluate(()=>LocalState.record.v2.base['customItems/c_one'].version),1);
  const stored=await a.evaluate(async()=>{const record=await LocalState.read(LocalState.key),ref=record.state.customItems[0].dataUrl;return {ref,blob:(await MediaCache.read(ref.slice(6))).size};});assert.match(stored.ref,/^media:/);assert.ok(stored.blob>0);
  let imageDownloads=0;b.on('request',r=>{if(/\/api\/media\/[a-f0-9]/.test(r.url()))imageDownloads++;});await sync(b);assert.equal(imageDownloads,0,'sync must not eagerly download the gallery');assert.equal(await b.evaluate(()=>MediaCache.data(Store.get().customItems[0].dataUrl)),png);
  await a.evaluate(()=>Store.set({customItems:Store.get().customItems.map(i=>i.id==='c_one'?{...i,name:'A一'}:i)}));
  await b.evaluate(()=>Store.set({customItems:Store.get().customItems.map(i=>i.id==='c_two'?{...i,name:'B二'}:i)}));await sync(b);await sync(a);await sync(b);
  assert.deepEqual(await a.evaluate(()=>Store.get().customItems.map(i=>i.name).sort()),['A一','B二']);assert.equal(await a.evaluate(()=>LocalState.record.conflict),false);
  await a.evaluate(()=>Store.set({profile:{...Store.get().profile,job:'本机修改'}}));await b.evaluate(()=>Store.set({profile:{...Store.get().profile,job:'云端修改'}}));await sync(b);await sync(a);
  assert.equal(await a.evaluate(()=>LocalState.record.conflict),true);assert.equal(await a.evaluate(()=>Store.get().profile.job),'本机修改');
  await a.evaluate(async()=>{const old=LocalState.backup;LocalState.backup=async function(label){await old.call(this,label);Store.set({profile:{...Store.get().profile,job:'备份期间修改'}});};try{await CloudSync.resolve('setting/profile','cloud');}catch{}finally{LocalState.backup=old;}});
  assert.equal(await a.evaluate(()=>Store.get().profile.job),'备份期间修改');assert.equal(await a.evaluate(()=>LocalState.record.conflict),true);
  await a.evaluate(()=>CloudSync.resolve('setting/profile','cloud'));assert.equal(await a.evaluate(()=>Store.get().profile.job),'云端修改');
  // Server commits a mutation but the response is lost. Retry must reuse its exact ID/body.
  await a.evaluate(async()=>{const original=AppAPI.request;let lost=false;AppAPI.request=async function(p,opts){const r=await original.call(this,p,opts);if(p==='/api/sync/push'&&!lost){lost=true;throw Error('lost acknowledgement');}return r;};Store.set({profile:{...Store.get().profile,height:'175'}});await CloudSync.run();AppAPI.request=original;});
  assert.ok(await a.evaluate(()=>LocalState.record.v2.pending));const savedPending=await a.evaluate(()=>LocalState.record.v2.pending.mutationId);await sync(a);assert.equal(await a.evaluate(()=>LocalState.record.v2.pending),null);assert.ok(savedPending);
  // A local edit made while upload is in flight stays dirty and is sent next.
  await a.evaluate(async()=>{const original=AppAPI.request;let once=false;AppAPI.request=async function(p,o){const r=await original.call(this,p,o);if(p==='/api/sync/push'&&!once){once=true;Store.set({profile:{...Store.get().profile,height:'180'}});}return r;};Store.set({profile:{...Store.get().profile,height:'178'}});await CloudSync.run();AppAPI.request=original;});assert.equal(await a.evaluate(()=>Store.get().profile.height),'180');await sync(a);await sync(b);assert.equal(await b.evaluate(()=>Store.get().profile.height),'180');
  await a.evaluate(async()=>{window.originalWrite=LocalState.write;LocalState.write=()=>Promise.reject(Error('disk full'));Store.set({profile:{...Store.get().profile,size:'M'}});await AppNav.go('home.html');});assert.ok(a.url().endsWith('connection.html'));await a.evaluate(async()=>{LocalState.write=window.originalWrite;await LocalState.persist();});
  // A received job is recovered from server entities without a local submission receipt.
  const job=await post('/api/segment/start',{image:png,requestId:'lost-response-test',actionId:crypto.randomUUID()},login.token);await a.waitForTimeout(100);await sync(a);const generated='c_'+job.jobId+'_0';assert.ok(await a.evaluate(id=>Store.get().customItems.some(i=>i.id===id),generated));
  await a.evaluate(id=>Store.set({customItems:Store.get().customItems.filter(i=>i.id!==id)}),generated);await sync(a);await sync(b);await open(a);await sync(a);assert.equal(await a.evaluate(id=>Store.get().customItems.some(i=>i.id===id),generated),false);
  // A delayed pull cannot enter a newly selected local partition.
  const isolation=await b.evaluate(async()=>{const request=AppAPI.request;let release,started;const gate=new Promise(r=>release=r),begin=new Promise(r=>started=r);const next=AppAPI.scope+'|another@example.com';await LocalState.write(next,{...LocalState.fresh(),state:{...Store.defaults(),account:{email:'another@example.com'},customItems:[{id:'c_b',name:'B',cat:'上衣'}]}});AppAPI.request=async()=>{started();await gate;return {ok:true,json:async()=>({syncVersion:2,entities:[{kind:'customItems',id:'c_wrong',data:{id:'c_wrong',cat:'上衣',name:'A'},deleted:false,version:1}],cursor:999,watermark:999,hasMore:false})};};const running=CloudSync.run();await begin;localStorage.setItem('yxz-active-account','another@example.com');await LocalState.load();release();await running;AppAPI.request=request;return {email:Store.get().account.email,items:Store.get().customItems.map(i=>i.id)};});
  assert.equal(isolation.email,'another@example.com');assert.deepEqual(isolation.items,['c_b']);assert.deepEqual(errors,[]);
  console.log('PASS: Blob storage, lazy media, independent edits, entity conflicts, lost acknowledgements, in-flight edits, failed writes, recovered/deleted AI results, account isolation');
 }finally{await browser.close();await new Promise(r=>server.close(r));require('../server/database').db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
