/* 衣先知：Node 24 单机服务，私有 SQLite/图片目录，客户端使用同一组 API。 */
require('./ai/config');
const express=require('express'),path=require('node:path');
const {db}=require('./database');
const store=require('./store'),state=require('./state'),jobs=require('./jobs');
const auth=require('./auth');
const config=require('./ai/config');
const app=express();
const publicDir=path.resolve(__dirname,'../www');
const allow=new Set(['https://localhost','http://localhost',...(process.env.ALLOWED_ORIGINS||'').split(',').map(s=>s.trim()).filter(Boolean)]);
app.disable('x-powered-by');
app.use((req,res,next)=>{
  const origin=req.headers.origin;
  if(origin && allow.has(origin)) {res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization,X-Sid,X-Page');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');}
  if(req.method==='OPTIONS') return res.sendStatus(origin&&allow.has(origin)?204:403);
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.path.startsWith('/api/')) res.setHeader('Cache-Control','no-store');
  next();
});
app.use(express.json({limit:'30mb'}));
const route=fn=>(req,res,next)=>Promise.resolve().then(()=>fn(req,res)).catch(next);
function requireLogin(req,res,next) {
  const email=auth.verifyToken((req.headers.authorization||'').replace(/^Bearer\s+/i,''));
  if(!email) return res.status(401).json({error:'请先登录'});req.userEmail=email;next();
}
function charge(email,kind,defaultLimit) {
  const configured=process.env['QUOTA_'+kind+'_PER_DAY'];
  const limit=configured===undefined?defaultLimit:Number(configured);
  if(!Number.isSafeInteger(limit)||limit<0) throw Object.assign(new Error('配额配置错误'),{status:503});
  if(!limit) return;
  const count=store.incr('quota:'+kind+':'+email+':'+new Date().toISOString().slice(0,10),26*3600);
  if(count>limit) throw Object.assign(new Error('今日AI额度已用完，请明天再试'),{status:429});
}
function paid(kind,n,needImage=false) {
  return (req,res,next)=>{
    try {
      if(!auth.demo && (!config.OPENROUTER_API_KEY || (needImage&&!config.DASHSCOPE_API_KEY))) throw Object.assign(new Error('AI服务尚未配置，请联系服务部署者'),{status:503});
      charge(req.userEmail,kind,n); next();
    } catch(e) { next(e); }
  };
}
function readySplit(req,res,next) {
  if(!auth.demo&&(!config.OPENROUTER_API_KEY||!config.DASHSCOPE_API_KEY)) return res.status(503).json({error:'AI服务尚未配置'});
  try {state.decodeImage(req.body.image);next();} catch(e){next(e);}
}
function splitConfigured(req,res,next) {
  if(!auth.demo&&(!config.OPENROUTER_API_KEY||!config.DASHSCOPE_API_KEY)) return res.status(503).json({error:'AI服务尚未配置'});
  next();
}
app.get('/api/health',(req,res)=>res.json({ok:true,service:'yixianzhi',syncVersion:1,demo:auth.demo,aiReady:!!(config.OPENROUTER_API_KEY&&config.DASHSCOPE_API_KEY)}));
app.use(auth.router);
app.post('/api/state/pull',requireLogin,route((req,res)=>res.json(state.pull(req.userEmail))));
app.post('/api/state/push',requireLogin,route((req,res)=>{
  if(req.body.schemaVersion!==1) throw Object.assign(new Error('不支持的数据版本'),{status:400});
  res.json(state.push(req.userEmail,req.body.state,req.body.expectedVersion));
}));
app.post('/api/segment/start',requireLogin,readySplit,route((req,res)=>res.json(jobs.start(req.userEmail,req.body.image,req.body.requestId,charge))));
app.post('/api/segment/result',requireLogin,route((req,res)=>res.json(jobs.result(req.userEmail,req.body.jobId,req.body.got))));
app.post('/api/segment/retry',requireLogin,splitConfigured,route((req,res)=>res.json(jobs.retry(req.userEmail,req.body.jobId,req.body.index,charge))));
app.get('/api/segment/jobs',requireLogin,route((req,res)=>res.json({jobs:jobs.list(req.userEmail)})));
for(const [url,method] of [['segment','segment'],['detect','detect'],['segment-one','segmentOne']]) {
  app.post('/api/'+url,requireLogin,readySplit,paid('SPLIT',5,true),route(async(req,res)=>{
    const module=require('./ai/segment');const fn=method==='segment'?module:module[method];res.json(await fn({...req.body,strict:true}));
  }));
}
app.post('/api/validate-photo',requireLogin,paid('VALIDATE',30),route(async(req,res)=>{
  state.decodeImage(req.body.image);const r=await require('./ai/validate')(req.body);
  if(!auth.demo&&(r.mock||r.fallback)) throw Object.assign(new Error('照片质检失败，请稍后重试'),{status:502});res.json(r);
}));
app.post('/api/recommend',requireLogin,paid('RECOMMEND',50),route(async(req,res)=>{
  if(!Array.isArray(req.body.wardrobe)||req.body.wardrobe.length>1000) throw Object.assign(new Error('衣橱格式错误'),{status:400});
  res.json(await require('./ai/recommend')(req.body));
}));
app.post('/api/tryon',requireLogin,paid('TRYON',20),route(async(req,res)=>{
  state.decodeImage(req.body.modelImage);
  if(!Array.isArray(req.body.items)||req.body.items.length<1||req.body.items.length>4) throw Object.assign(new Error('试穿单品数量错误'),{status:400});
  for(const i of req.body.items) state.decodeImage(i.image);
  const r=await require('./ai/tryon')(req.body);
  if(!r.image&&!auth.demo) throw Object.assign(new Error('生成失败，请重试'),{status:502});
  res.json(r);
}));
app.post('/api/track',(req,res)=>{
  const b=req.body||{},email=auth.verifyToken((req.headers.authorization||'').replace(/^Bearer\s+/i,''));
  if(typeof b.event==='string'&&b.event.length<=64) db.prepare('INSERT INTO events(ts,event,email,props) VALUES(?,?,?,?)').run(new Date().toISOString(),b.event,email,JSON.stringify({session_id:b.session_id,page:b.page,props:b.props}).slice(0,6000));
  res.json({ok:true});
});
app.get('/api/admin/stats',route((req,res)=>{
  if(!process.env.ADMIN_TOKEN||req.query.token!==process.env.ADMIN_TOKEN) return res.sendStatus(403);
  const days=Math.min(30,Math.max(1,Number(req.query.days)||7));
  const rows=db.prepare('SELECT * FROM events WHERE ts>=? ORDER BY ts DESC LIMIT 50000').all(new Date(Date.now()-days*86400000).toISOString()).map(r=>{try{return {...r,...JSON.parse(r.props)}}catch{return r}});
  res.json(require('./stats')(rows,days));
}));
// Only a generated allowlisted product directory is public. Never expose server/data.
app.use(express.static(publicDir,{dotfiles:'deny',index:'login.html'}));
app.use((req,res)=>res.status(404).json({error:'路径不存在'}));
app.use((e,req,res,next)=>{const status=e.status||500;if(status>=500) console.warn(e.message);res.status(status).json({error:status===500?'服务暂不可用':e.message,...(e.version!==undefined?{version:e.version}:{})});});
if(require.main===module) app.listen(process.env.PORT||8394,'0.0.0.0',()=>console.log('衣先知已启动，端口 '+(process.env.PORT||8394)+'（SQLite）'));
module.exports=app;
