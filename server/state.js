const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {db,dataDir,transaction,ensureUser}=require('./database');
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const keys=['dataVersion','customOutfits','account','profile','favorites','wardrobe','deletedItems','onboarded','privacyOk','curModel','customItems','models','history','historySeeded','processedSegmentTargets'];
function validate(input,{refs=false}={}) {
  if (!input || typeof input!=='object' || Array.isArray(input)) throw fail('状态格式错误');
  const s={}; for(const k of keys) if(input[k]!==undefined) s[k]=structuredClone(input[k]);
  for(const k of ['favorites','wardrobe','deletedItems','customItems','customOutfits','models','history']) {
    if(s[k]===undefined) s[k]=[];
    if(!Array.isArray(s[k])||s[k].length>1000) throw fail('列表超限：'+k);
  }
  for(const k of ['onboarded','privacyOk','historySeeded']) if(s[k]!==undefined&&typeof s[k]!=='boolean') throw fail('开关格式错误');
  for(const k of ['profile','account']) if(s[k]!==undefined && (!s[k]||typeof s[k]!=='object'||Array.isArray(s[k]))) throw fail('资料格式错误');
  s.account={nick:s.account?.nick||'',avatar:s.account?.avatar||''};
  if(typeof s.account.nick!=='string'||s.account.nick.length>100) throw fail('昵称格式错误');
  if(s.curModel!==undefined && (typeof s.curModel!=='string'||!/^[\w-]{1,120}$/.test(s.curModel))) throw fail('模特ID错误');
  for(const [k,v] of Object.entries(s.profile||{})) {
    if(['pref','styles','colorTypes'].includes(k)) {if(!Array.isArray(v)||v.length>30||v.some(x=>typeof x!=='string'||x.length>100))throw fail('偏好格式错误');}
    else if(typeof v!=='string'||v.length>200)throw fail('档案格式错误');
  }
  if(s.processedSegmentTargets!==undefined && (!Array.isArray(s.processedSegmentTargets)||s.processedSegmentTargets.length>10000||s.processedSegmentTargets.some(x=>typeof x!=='string'||!/^[\w-]{1,120}$/.test(x)))) throw fail('任务记录错误');
  for(const k of ['favorites','wardrobe','deletedItems']) for(const id of s[k]) if(typeof id!=='string'||!/^[\w-]{1,120}$/.test(id)) throw fail('单品ID错误');
  for(const k of ['customItems','customOutfits','models','history']) for(const i of s[k]) if(!i || typeof i!=='object'||typeof i.id!=='string'||!/^[\w-]{1,120}$/.test(i.id)) throw fail('记录格式错误');
  for(const i of s.customItems) if(!['上衣','下装','鞋子','连体裙'].includes(i.cat)||typeof i.name!=='string')throw fail('衣物格式错误');
  if(s.dataVersion!==undefined&&s.dataVersion!==2)throw fail('不支持的数据版本');
  for(const o of s.customOutfits)if(typeof o.name!=='string'||o.name.length>80||!Array.isArray(o.items)||o.items.length<1||o.items.length>4||new Set(o.items).size!==o.items.length||o.items.some(id=>typeof id!=='string'||!/^[\w-]{1,120}$/.test(id)))throw fail('搭配格式错误');
  const imagePaths=new Set(['account.avatar',...s.customItems.map((_,i)=>`customItems.${i}.dataUrl`),...s.models.map((_,i)=>`models.${i}.dataUrl`),...s.history.map((_,i)=>`history.${i}.image`)]);
  function walk(v,p='') {
    if(typeof v==='string') {
      if(v.startsWith('media:')&&(!refs||!imagePaths.has(p)||!/^media:[a-f0-9]{64}$/.test(v))) throw fail('媒体引用不合法');
      if(v.startsWith('data:') && !imagePaths.has(p)) throw fail('图片字段不允许');
      if(!imagePaths.has(p) && (v.length>4000 || /[<>]/.test(v))) throw fail('文本字段不合法');
    } else if(v && typeof v==='object') {
      if(p.split('.').length>8) throw fail('状态嵌套过深');
      for(const [k,c] of Object.entries(v)) { if(['__proto__','constructor','prototype'].includes(k)) throw fail('非法字段'); walk(c,p?p+'.'+k:k); }
    }
  } walk(s);
  for(const p of imagePaths) { const bits=p.split('.'); let v=s; for(const b of bits) v=v?.[b]; if(v!==undefined && v!==null && v!=='' && (typeof v!=='string'||!(v.startsWith('data:image/')||(refs&&/^media:[a-f0-9]{64}$/.test(v))))) throw fail('照片必须是图片数据'); }
  return {s,imagePaths};
}
function decodeImage(value) {
  const m=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if(!m || m[2].length%4!==0) throw fail('不支持的图片格式');
  const b=Buffer.from(m[2],'base64');
  if(b.length>3*1024*1024) throw fail('单张图片不能超过3MB',413);
  const valid=m[1]==='png'?b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):m[1]==='jpeg'?b[0]===255&&b[1]===216&&b[2]===255:b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP';
  if(!valid) throw fail('图片内容与格式不匹配');
  return {b,mime:'image/'+m[1]};
}
function pull(email) {
  const r=db.prepare('SELECT * FROM user_state WHERE email=?').get(email);
  if(!r) return {state:null,version:0,schemaVersion:1};
  function inflate(v) {
    if(typeof v==='string'&&v.startsWith('media:')) {
      const media=db.prepare('SELECT * FROM media WHERE owner=? AND id=?').get(email,v.slice(6));
      if(!media) throw fail('媒体记录缺失',500);
      return `data:${media.mime};base64,${fs.readFileSync(path.join(dataDir,media.path)).toString('base64')}`;
    }
    if(Array.isArray(v)) return v.map(inflate);
    if(v&&typeof v==='object') return Object.fromEntries(Object.entries(v).map(([k,c])=>[k,inflate(c)]));
    return v;
  }
  return {state:inflate(JSON.parse(r.state)),version:r.version,schemaVersion:1,dataVersion:2,updatedAt:r.updated_at};
}
function push(email,input,expectedVersion) {
  if(db.prepare('SELECT 1 FROM sync_migrations WHERE owner=?').get(email))throw fail('请更新 App 后使用增量同步',426);
  if(!Number.isSafeInteger(expectedVersion)||expectedVersion<0) throw fail('缺少有效 expectedVersion');
  if(Buffer.byteLength(JSON.stringify(input))>30*1024*1024) throw fail('资料超过30MB',413);
  const old=db.prepare('SELECT state FROM user_state WHERE email=?').get(email);
  if(old&&JSON.parse(old.state).dataVersion===2&&input?.dataVersion!==2)throw fail('请更新 App 后再同步',426);
  const {s,imagePaths}=validate(input), mediaRows=[];
  const before=db.prepare('SELECT version FROM user_state WHERE email=?').get(email)?.version||0;
  if(before!==expectedVersion) throw Object.assign(fail('云端资料已更新，请选择保留哪个版本',409),{version:before});
  ensureUser(email);
  let used=db.prepare('SELECT coalesce(sum(size),0) AS bytes FROM media WHERE owner=?').get(email).bytes;
  const seen=new Set();
  for(const p of imagePaths) {
    const parts=p.split('.'),key=parts.pop(); let obj=s; for(const part of parts) obj=obj?.[part];
    if(!obj?.[key]) continue;
    const {b,mime}=decodeImage(obj[key]),id=hash(b),relative=`media/${hash(email)}/${id}`;
    if(!seen.has(id) && !db.prepare('SELECT 1 FROM media WHERE owner=? AND id=?').get(email,id)) used+=b.length;
    seen.add(id);
    if(used>Number(process.env.MEDIA_QUOTA_MB||200)*1024*1024) throw fail('账号图片空间已满',413);
    const dest=path.join(dataDir,relative); fs.mkdirSync(path.dirname(dest),{recursive:true});
    if(!fs.existsSync(dest)) { const tmp=dest+'.'+crypto.randomUUID()+'.tmp'; fs.writeFileSync(tmp,b,{flag:'wx'}); fs.renameSync(tmp,dest); }
    // Count successfully written files even if the subsequent state commit conflicts.
    db.prepare('INSERT OR IGNORE INTO media VALUES(?,?,?,?,?)').run(email,id,mime,b.length,relative);
    mediaRows.push([email,id,mime,b.length,relative]); obj[key]='media:'+id;
  }
  return transaction(()=>{
    const current=db.prepare('SELECT version FROM user_state WHERE email=?').get(email)?.version||0;
    if(current!==expectedVersion) throw Object.assign(fail('云端资料已更新，请选择保留哪个版本',409),{version:current});
    const q=db.prepare('INSERT OR IGNORE INTO media VALUES(?,?,?,?,?)'); for(const r of mediaRows) q.run(...r);
    const version=current+1,updatedAt=new Date().toISOString();
    db.prepare('INSERT INTO user_state VALUES(?,?,?,?) ON CONFLICT(email) DO UPDATE SET version=excluded.version,state=excluded.state,updated_at=excluded.updated_at').run(email,version,JSON.stringify(s),updatedAt);
    return {ok:true,version,schemaVersion:1,dataVersion:2,updatedAt};
  });
}
module.exports={pull,push,validate,decodeImage};
