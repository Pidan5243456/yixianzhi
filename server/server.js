require('./ai/config');
const express=require('express'),path=require('node:path');
const {db}=require('./database'),state=require('./state'),jobs=require('./jobs'),auth=require('./auth'),config=require('./ai/config');
const control=require('./ai-control'),ai=require('./ai-service'),media=require('./media'),sync=require('./sync-v2'),actions=require('./actions');
const app=express(),publicDir=path.resolve(__dirname,'../www');
const allow=new Set(['https://localhost','http://localhost',...(process.env.ALLOWED_ORIGINS||'').split(',').map(s=>s.trim()).filter(Boolean)]);
app.disable('x-powered-by');
// Only explicit proxy CIDRs are accepted; never trust arbitrary forwarded headers.
if(process.env.TRUST_PROXY)app.set('trust proxy',process.env.TRUST_PROXY.split(',').map(x=>x.trim()));
app.use((req,res,next)=>{const origin=req.headers.origin;
 if(origin&&allow.has(origin)){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization,X-Sid,X-Page');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');}
 if(req.method==='OPTIONS')return res.sendStatus(origin&&allow.has(origin)?204:403);
 res.setHeader('X-Content-Type-Options','nosniff');if(req.path.startsWith('/api/'))res.setHeader('Cache-Control','no-store');next();});
app.use(express.json({limit:'30mb'}));
const route=fn=>(req,res,next)=>Promise.resolve().then(()=>fn(req,res)).catch(next);
const token=req=>(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
function requireLogin(req,res,next){const email=auth.verifyToken(token(req));if(!email)return res.status(401).json({error:'请重新登录'});req.userEmail=email;next();}
app.get('/api/health',(req,res)=>res.json({ok:true,service:'yixianzhi',syncVersion:2,dataVersion:3,demo:auth.demo,aiReady:require('./ai/local-gateway').capabilities().TRYON.available}));
app.get('/api/ai/capabilities',(req,res)=>{const capabilities=require('./ai/local-gateway').capabilities();for(const kind of ['RECOMMEND','VALIDATE']){try{ai.configured(kind);capabilities[kind]={available:true,connectionVerified:false};}catch(e){capabilities[kind]={available:false,reason:e.message,connectionVerified:false};}}res.json({protocol:1,capabilities});});
app.use(auth.router);
app.post('/api/auth/logout',requireLogin,route((req,res)=>{auth.revoke(token(req));res.json({ok:true});}));
app.post('/api/account/delete',requireLogin,route((req,res)=>{if(req.body.confirm!=='DELETE')throw control.fail('请确认注销账号');auth.confirmDeletion(req.userEmail,req.body.code);res.json(auth.remove(req.userEmail));}));
app.get('/api/consents',requireLogin,route((req,res)=>res.json({ai_processing:control.consent(req.userEmail),analytics:control.consent(req.userEmail,'analytics')})));
app.post('/api/consents',requireLogin,route((req,res)=>res.json(control.setConsent(req.userEmail,req.body.purpose,req.body.granted))));
app.post('/api/media/upload',requireLogin,route((req,res)=>{media.collect(req.userEmail);res.json({ref:media.upload(req.userEmail,req.body.image)});}));
app.get('/api/media/:id',requireLogin,route((req,res)=>res.json({dataUrl:media.read(req.userEmail,req.params.id)})));
app.post('/api/media/collect',requireLogin,route((req,res)=>res.json({deleted:media.collect(req.userEmail)})));
const requireDataVersion=(req,res,next)=>req.body.clientDataVersion===3?next():res.status(426).json({error:'请更新衣先知后再同步，旧版无法保留衣物归属和原图',code:'CLIENT_UPDATE_REQUIRED'});
app.post('/api/sync/pull',requireLogin,requireDataVersion,route((req,res)=>res.json(sync.pull(req.userEmail,req.body))));
app.post('/api/sync/push',requireLogin,requireDataVersion,route((req,res)=>res.json(sync.push(req.userEmail,req.body))));
app.post('/api/state/pull',requireLogin,route((req,res)=>{if(db.prepare('SELECT 1 FROM sync_migrations WHERE owner=?').get(req.userEmail))throw control.fail('请更新 App 后使用增量同步',426);res.json(state.pull(req.userEmail));}));
app.post('/api/state/push',requireLogin,route((req,res)=>{if(req.body.schemaVersion!==1)throw control.fail('不支持的数据版本');res.json(state.push(req.userEmail,req.body.state,req.body.expectedVersion));}));
app.post('/api/ai/operations',requireLogin,route((req,res)=>res.status(202).json(actions.run(req.userEmail,req.body.actionId,{...req.body,path:req.path},()=>ai.start(req.userEmail,req.body.kind,req.body.input||{},!!req.body.retry)))));
app.get('/api/ai/operations',requireLogin,route((req,res)=>res.json({operations:db.prepare('SELECT id FROM ai_operations WHERE owner=? ORDER BY created_at DESC LIMIT 100').all(req.userEmail).map(r=>ai.result(req.userEmail,r.id))})));
app.get('/api/ai/operations/:id',requireLogin,route((req,res)=>res.json(ai.result(req.userEmail,req.params.id))));
app.post('/api/ai/operations/:id/retry',requireLogin,route((req,res)=>res.status(202).json(actions.run(req.userEmail,req.body.actionId,{...req.body,path:req.path},()=>ai.retry(req.userEmail,req.params.id)))));
function readySplit(req,res,next){try{if(typeof req.body.image==='string'&&req.body.image.startsWith('media:'))media.validateRefs(req.userEmail,req.body.image);else state.decodeImage(req.body.image);next();}catch(e){next(e);}}
app.post('/api/segment/start',requireLogin,route((req,res)=>res.json(actions.run(req.userEmail,req.body.actionId,{...req.body,path:req.path},()=>{if(typeof req.body.image!=='string')throw control.fail('缺少图片');return jobs.start(req.userEmail,req.body.image,req.body.requestId,null,!!req.body.retry);}))));
app.post('/api/segment/result',requireLogin,route((req,res)=>res.json(jobs.result(req.userEmail,req.body.jobId,req.body.got))));
app.post('/api/segment/retry',requireLogin,route((req,res)=>{res.json(actions.run(req.userEmail,req.body.actionId,{...req.body,path:req.path},()=>{ai.configured('SPLIT');control.requireConsent(req.userEmail);return jobs.retry(req.userEmail,req.body.jobId,req.body.index);}));}));
app.get('/api/segment/jobs',requireLogin,route((req,res)=>res.json({jobs:jobs.list(req.userEmail)})));
// Old direct endpoints have no supplier path: old clients must upgrade, never bypass consent/budgets.
for(const [url,kind]of [['segment','SPLIT'],['detect','SPLIT'],['segment-one','SPLIT'],['validate-photo','VALIDATE'],['recommend','RECOMMEND'],['tryon','TRYON']])app.post('/api/'+url,requireLogin,route(()=>{ai.configured(kind);throw control.fail('请更新 App 后使用任务接口',426);}));
app.post('/api/track',route((req,res)=>{const email=auth.verifyToken(token(req));if(!email||!control.consent(email,'analytics'))return res.json({ok:true});const b=req.body||{};if(typeof b.event==='string'&&b.event.length<=64)db.prepare('INSERT INTO events(ts,event,email,props) VALUES(?,?,?,?)').run(new Date().toISOString(),b.event,email,JSON.stringify({session_id:b.session_id,page:b.page,props:b.props}).slice(0,6000));res.json({ok:true});}));
app.get('/api/admin/stats',route((req,res)=>{if(!process.env.ADMIN_TOKEN||token(req)!==process.env.ADMIN_TOKEN)return res.sendStatus(403);const days=Math.min(30,Math.max(1,Number(req.query.days)||7));const rows=db.prepare('SELECT * FROM events WHERE ts>=? ORDER BY ts DESC LIMIT 50000').all(new Date(Date.now()-days*86400000).toISOString()).map(r=>{try{return {...r,...JSON.parse(r.props)}}catch{return r}});res.json(require('./stats')(rows,days));}));
app.use(express.static(publicDir,{dotfiles:'deny',index:'login.html'}));app.use((req,res)=>res.status(404).json({error:'路径不存在'}));
app.use((e,req,res,next)=>{const status=e.status||500;if(status>=500)console.warn(e.message);res.status(status).json({error:status===500?'服务暂不可用':e.message,...(e.version!==undefined?{version:e.version}:{}),...(e.code?{code:e.code}:{})});});
if(require.main===module){const cleanup=()=>{for(const a of db.prepare('SELECT email FROM accounts WHERE active=0').all())try{auth.remove(a.email);}catch(e){console.warn('账号清理待重试');}};cleanup();setInterval(cleanup,60000).unref();}
if(require.main===module)app.listen(process.env.PORT||8394,'0.0.0.0',()=>console.log('衣先知已启动，端口 '+(process.env.PORT||8394)+'（SQLite）'));
module.exports=app;
