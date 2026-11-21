const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
process.env.NODE_ENV='test';process.env.DEMO_MODE='true';process.env.AUTH_SECRET='test-secret-only-at-least-32-characters';
process.env.OPENROUTER_API_KEY='';process.env.DASHSCOPE_API_KEY='';process.env.DM_ACCESS_KEY_ID='';process.env.DM_ACCESS_KEY_SECRET='';
process.env.DATA_DIR=path.resolve('.tooling/tests/api-'+Date.now());
const realFetch=global.fetch;global.fetch=(url,options)=>{if(!String(url).startsWith('http://127.0.0.1:'))throw new Error('External network prohibited in tests');return realFetch(url,options);};
const app=require('../server/server');
const {db}=require('../server/database'),store=require('../server/store');
let server,base,a,b;
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aFhUAAAAASUVORK5CYII=';
async function request(url,body={},token) {if(body&&(/\/api\/ai\/operations/.test(url)||/\/api\/segment\/(start|retry)$/.test(url)))body.actionId||=crypto.randomUUID();const r=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};}
async function login(email) {const code=await request('/api/auth/send-code',{email});assert.equal(code.status,200);const result=await request('/api/auth/login',{email,code:code.body.devCode});assert.equal(result.status,200);return result.body.token;}
before(async()=>{server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;a=await login('a@example.com');b=await login('b@example.com');});
after(async()=>{await new Promise(r=>server.close(r));db.close();});
test('OTP is consumed atomically: two submissions, only one succeeds',async()=>{
 const email='once@example.com',sent=await request('/api/auth/send-code',{email});
 const results=await Promise.all([request('/api/auth/login',{email,code:sent.body.devCode}),request('/api/auth/login',{email,code:sent.body.devCode})]);
 assert.deepEqual(results.map(x=>x.status).sort(),[200,400]);
});
test('private routes, CORS, and static publication boundary',async()=>{
 assert.equal((await request('/api/state/pull')).status,401);
 for(const p of ['/server/data/yixianzhi.sqlite','/server/auth.js','/.env','/package.json','/docs/app-plan.md'])assert.equal((await fetch(base+p)).status,404);
 const r=await fetch(base+'/api/state/pull',{method:'OPTIONS',headers:{Origin:'https://localhost','Access-Control-Request-Method':'POST'}});assert.equal(r.status,204);assert.equal(r.headers.get('access-control-allow-origin'),'https://localhost');
 assert.equal((await fetch(base+'/api/state/pull',{method:'OPTIONS',headers:{Origin:'https://evil.example'}})).status,403);
});
test('same image in two accounts is private, and token is never stored in state',async()=>{
 const state={account:{nick:'测试',token:'do-not-save',email:'spoof@example.com'},customItems:[{id:'c1',cat:'上衣',name:'白T恤',dataUrl:png}],models:[],history:[],favorites:[]};
 for(const token of [a,b]) {const r=await request('/api/state/push',{schemaVersion:1,expectedVersion:0,state},token);assert.equal(r.status,200);assert.equal(r.body.version,1);}
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM media').get().n,2);
 for(const token of [a,b]) {const r=await request('/api/state/pull',{},token);assert.equal(r.body.state.customItems[0].dataUrl,png);assert.equal(r.body.state.account.token,undefined);assert.equal(r.body.state.account.email,undefined);}
 const row=db.prepare('SELECT state FROM user_state WHERE email=?').get('a@example.com');assert.ok(!row.state.includes('base64'));assert.ok(row.state.includes('media:'));
});
test('optimistic locking rejects stale updates and accepts only one competing write',async()=>{
 const state={favorites:['o1']};
 const results=await Promise.all([request('/api/state/push',{schemaVersion:1,expectedVersion:1,state},a),request('/api/state/push',{schemaVersion:1,expectedVersion:1,state},a)]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal((await request('/api/state/pull',{},b)).body.version,1);
 assert.equal((await request('/api/state/push',{schemaVersion:1,state},a)).status,400);
});
test('rejects forged media references and image write failure leaves revision unchanged',async()=>{
 const state={customItems:[{id:'x',dataUrl:'media:fake'}]};assert.equal((await request('/api/state/push',{schemaVersion:1,expectedVersion:2,state},a)).status,400);
 const original=fs.renameSync;fs.renameSync=()=>{throw new Error('test disk failure');};
 try {const unique=png.replace('AAAAASUVORK5CYII=','AAAAASUVORK5CYIA=');const r=await request('/api/state/push',{schemaVersion:1,expectedVersion:2,state:{customItems:[{id:'x',cat:'上衣',name:'测试',dataUrl:unique}]}},a);assert.equal(r.status,500);}finally{fs.renameSync=original;}
 assert.equal((await request('/api/state/pull',{},a)).body.version,2);
});
test('durable jobs: idempotency, owner check and stable item ids',async()=>{
 const input={image:png,requestId:'test-idempotent-1'};
 const first=await request('/api/segment/start',input,a),again=await request('/api/segment/start',input,a);
 assert.equal(first.status,200);assert.equal(first.body.jobId,again.body.jobId);
 const jobId=first.body.jobId;
 assert.equal((await request('/api/segment/result',{jobId},b)).status,404);
 assert.equal((await request('/api/segment/retry',{jobId,index:0},b)).status,404);
 const result=await request('/api/segment/result',{jobId},a);assert.equal(result.body.status,'done');assert.equal(result.body.targets[0].item.id,'c_'+jobId+'_0');
 assert.equal(store.get('segjob:'+jobId).status,'done');
});
test('database survives a process restart and completed task results remain',()=>{
 store.set('segjob:restart',{owner:'a@example.com',status:'running',ts:Date.now(),targets:[{state:'done'},{state:'running'}]},1800);
 const output=execFileSync(process.execPath,['-e',"require('./server/jobs');const d=require('./server/database');const s=require('./server/store');console.log(JSON.stringify({v:d.db.prepare('SELECT source_version FROM sync_migrations WHERE owner=?').get('a@example.com').source_version,job:s.get('segjob:restart')}));d.db.close();"],{cwd:path.resolve('.'),env:process.env,encoding:'utf8'});
 const r=JSON.parse(output.trim());assert.equal(r.v,2);assert.equal(r.job.status,'done');assert.equal(r.job.targets[0].state,'done');assert.equal(r.job.targets[1].state,'fail');
});
test('production never falls back to mock, including retry, and does not charge missing configuration',async()=>{
 const {spawn}=require('node:child_process');
 const child=spawn(process.execPath,['-e',"require('./server/ai/config');process.env.NODE_ENV='production';const app=require('./server/server');const s=app.listen(0,'127.0.0.1',()=>console.log('PORT:'+s.address().port));"],{cwd:path.resolve('.'),env:process.env,stdio:['ignore','pipe','pipe']});
 try {
  const port=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(new Error('production startup timeout')),10000);child.stdout.on('data',b=>{text+=b;const m=/PORT:(\d+)/.exec(text);if(m){clearTimeout(timer);resolve(m[1]);}});child.on('error',reject);});
  const before=db.prepare("SELECT count(*) AS n FROM kv WHERE key LIKE 'quota:%'").get().n;
  for(const url of ['validate-photo','recommend','tryon','segment/start','segment/retry','segment-one']) {
   const r=await fetch('http://127.0.0.1:'+port+'/api/'+url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+a},body:JSON.stringify({image:png.replace('AAAAASUVORK5CYII=','AAAAASUVORK5CYIA='),requestId:'production-config-test',actionId:crypto.randomUUID(),jobId:'missing',index:0})});assert.equal(r.status,503,url);
  }
  assert.equal(db.prepare("SELECT count(*) AS n FROM kv WHERE key LIKE 'quota:%'").get().n,before);
  const mail=await fetch('http://127.0.0.1:'+port+'/api/auth/send-code',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'production@example.com'})});assert.equal(mail.status,503);
 } finally {child.kill();await new Promise(r=>child.once('exit',r));}
});
