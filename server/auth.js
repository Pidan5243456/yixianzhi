require('./ai/config');
const crypto=require('node:crypto');
const router=require('express').Router();
const store=require('./store');
const {ensureUser}=require('./database');
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
    if(!validEmail(email)) throw fail('邮箱格式不正确',400);
    if(!mail.enabled&&!demo) throw fail('邮件服务尚未配置，请联系服务部署者',503);
    store.transaction(()=>{
      if(store.get('send:'+email)) throw fail('请一分钟后再试',429);
      if(store.incr('send-ip:'+req.ip,3600)>30) throw fail('发送次数过多，请稍后再试',429);
      store.set('send:'+email,true,60);
    });
    const code=String(crypto.randomInt(100000,1000000));
    if(mail.enabled) await mail.sendMail(email,code);
    store.set('otp:'+email,{hash:digest(email,code)},300);
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
    res.json({email,token:signToken(email)});
  } catch(e) { res.status(e.status||500).json({error:e.status?e.message:'登录失败'}); }
});
function signToken(email) {
  const payload=Buffer.from(email).toString('base64url')+'.'+(Date.now()+30*86400000);
  return payload+'.'+crypto.createHmac('sha256',SECRET).update(payload).digest('hex');
}
function verifyToken(token) {
  const [b64,exp,sig,...extra]=String(token||'').split('.');
  if(extra.length || !b64 || !/^\d+$/.test(exp||'') || !/^[a-f0-9]{64}$/.test(sig||'') || Number(exp)<Date.now()) return null;
  const expected=crypto.createHmac('sha256',SECRET).update(b64+'.'+exp).digest('hex');
  if(!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(expected))) return null;
  const email=Buffer.from(b64,'base64url').toString(); return validEmail(email)?email:null;
}
module.exports={router,verifyToken,demo};
