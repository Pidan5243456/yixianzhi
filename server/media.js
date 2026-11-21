const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {db,dataDir,transaction,ensureUser}=require('./database');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
function row(owner,id){if(!/^[a-f0-9]{64}$/.test(id))throw fail('图片编号无效');const r=db.prepare('SELECT * FROM media WHERE owner=? AND id=?').get(owner,id);if(!r)throw fail('图片不存在',404);return r;}
function upload(owner,data){const {b,mime}=require('./state').decodeImage(data),id=hash(b);return transaction(()=>{
 ensureUser(owner);const exists=db.prepare('SELECT * FROM media WHERE owner=? AND id=?').get(owner,id);
 if(exists&&fs.existsSync(path.join(dataDir,exists.path))){db.prepare('INSERT OR REPLACE INTO media_age VALUES(?,?,?)').run(owner,id,Date.now());return 'media:'+id;}
 const max=Number(process.env.MEDIA_QUOTA_MB||200)*1024*1024;if(!Number.isFinite(max)||max<=0)throw fail('图片容量配置无效',503);
 const used=db.prepare('SELECT coalesce(sum(size),0) bytes FROM media WHERE owner=?').get(owner).bytes;
 if(used+b.length>max)throw fail('账号图片空间已满',413);
 const relative='media/'+hash(owner)+'/'+id,dest=path.join(dataDir,relative);fs.mkdirSync(path.dirname(dest),{recursive:true});
 const tmp=dest+'.'+crypto.randomUUID()+'.tmp';let fd;
 try{fd=fs.openSync(tmp,'wx');fs.writeFileSync(fd,b);fs.fsyncSync(fd);fs.closeSync(fd);fd=null;fs.renameSync(tmp,dest);}finally{if(fd!==null&&fd!==undefined)fs.closeSync(fd);if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
 db.prepare('INSERT OR REPLACE INTO media VALUES(?,?,?,?,?)').run(owner,id,mime,b.length,relative);
 db.prepare('INSERT OR REPLACE INTO media_age VALUES(?,?,?)').run(owner,id,Date.now());return 'media:'+id;
 });}
function read(owner,id){const r=row(owner,id);return `data:${r.mime};base64,${fs.readFileSync(path.join(dataDir,r.path)).toString('base64')}`;}
function transform(v,fn){if(typeof v==='string')return fn(v);if(Array.isArray(v))return v.map(x=>transform(x,fn));if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,transform(x,fn)]));return v;}
function deflate(owner,value){return transform(value,v=>v.startsWith('data:image/')?upload(owner,v):v);}
function inflate(owner,value){return transform(value,v=>v.startsWith('media:')?read(owner,v.slice(6)):v);}
function validateRefs(owner,value){transform(value,v=>{if(v.startsWith('data:'))throw fail('图片请单独上传');if(v.startsWith('media:'))row(owner,v.slice(6));return v;});}
function collect(owner){return transaction(()=>{
 const live=new Set();const mark=txt=>{for(const m of (txt||'').matchAll(/media:([a-f0-9]{64})/g))live.add(m[1]);};
 for(const r of db.prepare('SELECT data FROM entities WHERE owner=? AND deleted=0').all(owner))mark(r.data);
 for(const r of db.prepare("SELECT result FROM ai_operations WHERE owner=? AND updated_at>?").all(owner,Date.now()-7*86400000))mark(r.result);
 for(const r of db.prepare('SELECT data FROM operation_inputs WHERE expires_at>? AND id IN (SELECT id FROM ai_operations WHERE owner=?)').all(Date.now(),owner))mark(r.data);
 // Legacy state is read only until its one-time migration. Afterwards it no longer pins photos.
 if(!db.prepare('SELECT 1 FROM sync_migrations WHERE owner=?').get(owner))mark(db.prepare('SELECT state FROM user_state WHERE email=?').get(owner)?.state);
 let deleted=0;for(const r of db.prepare('SELECT m.*,a.created_at FROM media m LEFT JOIN media_age a ON m.owner=a.owner AND m.id=a.id WHERE m.owner=?').all(owner)){
  if(live.has(r.id))continue;if(!r.created_at){db.prepare('INSERT OR IGNORE INTO media_age VALUES(?,?,?)').run(owner,r.id,Date.now());continue;}if(r.created_at>Date.now()-86400000)continue;
  // File deletion and reference admission are serialized by the same SQLite write transaction.
  const file=path.resolve(dataDir,r.path);if(!file.startsWith(path.resolve(dataDir,'media')+path.sep))throw fail('媒体路径无效',500);
  if(fs.existsSync(file))fs.unlinkSync(file);db.prepare('DELETE FROM media WHERE owner=? AND id=?').run(owner,r.id);db.prepare('DELETE FROM media_age WHERE owner=? AND id=?').run(owner,r.id);deleted++;
 }return deleted;
 });}
module.exports={upload,read,row,deflate,inflate,validateRefs,collect,hash};
