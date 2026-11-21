require('./ai/config');
const crypto=require('node:crypto');
const router=require('express').Router();
const store=require('./store');
const {ensureUser,db,transaction}=require('./database');
const mail=require('./mail');
const demo=process.env.NODE_ENV!=='production'&&process.env.DEMO_MODE==='true';
const SECRET=process.env.AUTH_SECRET || (process.env.NODE_ENV!=='production'?'yixianzhi-local-development-only':'');
if(SECRET.length<24) throw new Error('请配置至少24字符 AUTH_SECRET');
const validEmail=e=>typeof e==='string'&&e.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const digest=(email,code)=>crypto.createHmac('sha256',SECRET).update(email+':'+code).digest('hex');
const fail=(message,status)=>Object.assign(new Error(message),{status});
router.post('/api/auth/send-code',async(req,res)=>{
  try {
    const email=String(req.body.email||'').trim().toLowerCase();
    const purpose=req.body.purpose||'login';
    if(!['login','delete'].includes(purpose))throw fail('验证码用途无效',400);
    if(purpose==='delete'&&verifyToken((req.headers.authorization||'').replace(/^Bearer\s+/i,''))!==email)throw fail('请先登录要注销的账号',401);
    if(!validEmail(email)) throw fail('邮箱格式不正确',400);
    if(!mail.enabled&&!demo) throw fail('邮件服务尚未配置，请联系服务部署者',503);
    store.transaction(()=>{
      if(store.get('send:'+purpose+':'+email)) throw fail('请一分钟后再试',429);
      if(store.incr('send-ip:'+req.ip,3600)>30) throw fail('发送次数过多，请稍后再试',429);
      store.set('send:'+purpose+':'+email,true,60);
    });
    const code=String(crypto.randomInt(100000,1000000));
    if(mail.enabled) await mail.sendMail(email,code,purpose);
    store.set((purpose==='delete'?'otp-delete:':'otp:')+email,{hash:digest(email,code)},300);
    res.json(demo&&!mail.enabled?{ok:true,devCode:code}:{ok:true});
  } catch(e) { res.status(e.status||503).json({error:e.status?e.message:'验证码发送失败，请稍后重试'}); }
});
router.post('/api/auth/login',(req,res)=>{
  try {
    const email=String(req.body.email||'').trim().toLowerCase(),code=String(req.body.code||'');
    if(!validEmail(email)||!/^\d{6}$/.test(code)) throw fail('邮箱或验证码格式错误',400);
    if(store.incr('login:tries:'+email,600)>8) throw fail('尝试过多，请10分钟后重试',429);
    store.transaction(()=>{
      const otp=store.get('otp:'+email);
      if(!otp || otp.hash!==digest(email,code)) throw fail('验证码不正确或已过期',400);
      ensureUser(email); store.del('otp:'+email,'login:tries:'+email);
    });
    res.json({email,token:signToken(email),generation:generation(email)});
  } catch(e) { res.status(e.status||500).json({error:e.status?e.message:'登录失败'}); }
});
function signToken(email) {
  ensureUser(email);const token=crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(tokenHash(token),email,generation(email),Date.now()+30*86400000);return token;
}
function verifyToken(token) {
  if(typeof token!=='string'||token.length!==43)return null;
  const s=db.prepare('SELECT s.email FROM sessions s JOIN accounts a ON a.email=s.email WHERE s.hash=? AND s.expires_at>? AND a.active=1 AND a.generation=s.generation').get(tokenHash(token),Date.now());return s?.email||null;
}
const tokenHash=token=>crypto.createHash('sha256').update(token).digest('hex');
function generation(email){const a=db.prepare('SELECT * FROM accounts WHERE email=?').get(email);if(!a?.active)throw fail('账号已退出或注销',401);return a.generation;}
function requireGeneration(email,value){if(generation(email)!==value)throw fail('账号会话已变更',401);}
function revoke(token){db.prepare('DELETE FROM sessions WHERE hash=?').run(tokenHash(token));}
function confirmDeletion(email,code){if(store.incr('delete:tries:'+email,600)>8)throw fail('尝试过多，请稍后再试',429);store.transaction(()=>{const otp=store.get('otp-delete:'+email);if(!/^\d{6}$/.test(String(code))||!otp||otp.hash!==digest(email,String(code)))throw fail('注销验证码不正确或已过期',400);store.del('otp-delete:'+email,'delete:tries:'+email);});}
function remove(email){db.prepare('UPDATE accounts SET active=0 WHERE email=?').run(email);return transaction(()=>{
 db.prepare('DELETE FROM sessions WHERE email=?').run(email);
 // Keep aggregate spend under an unlinkable random owner, so deletion cannot refund the global budget.
 db.prepare('UPDATE ai_usage SET owner=? WHERE owner=?').run('deleted:'+crypto.randomUUID(),email);
 db.prepare('DELETE FROM operation_inputs WHERE id IN (SELECT id FROM ai_operations WHERE owner=?)').run(email);
 for(const table of ['consents','ai_operations','entities','changes','sync_migrations','mutations','media_age'])db.prepare('DELETE FROM '+table+' WHERE owner=?').run(email);
 const exact=new Set(['otp:','otp-delete:','login:tries:','delete:tries:','send:login:','send:delete:','send:'].map(p=>p+email));
 for(const [k,v]of store.entries(''))if(exact.has(k)||/^quota:[A-Z]+:(.*):\d{4}-\d{2}-\d{2}$/.exec(k)?.[1]===email||k.startsWith('segment-idem:'+email+':')||v?.owner===email){if(k.startsWith('segjob:'))for(const [child]of store.entries(k+':'))store.del(child);store.del(k);}
 db.prepare('DELETE FROM events WHERE email=?').run(email);db.prepare('DELETE FROM user_state WHERE email=?').run(email);
 require('./media').removeAll(email);db.prepare('DELETE FROM users WHERE email=?').run(email);db.prepare('DELETE FROM accounts WHERE email=?').run(email);return {ok:true};
});}
module.exports={router,verifyToken,demo,generation,requireGeneration,revoke,remove,confirmDeletion};
