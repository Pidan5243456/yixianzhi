const crypto=require('node:crypto');
const {db,transaction,ensureUser}=require('./database'),media=require('./media'),E=require('../js/entities');
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const validId=id=>typeof id==='string'&&/^[\w-]{1,120}$/.test(id);
function unpack(r){return r?{kind:r.kind,id:r.id,data:r.data===null?null:JSON.parse(r.data),version:r.version,deleted:!!r.deleted}:null;}
function get(owner,kind,id){return unpack(db.prepare('SELECT * FROM entities WHERE owner=? AND kind=? AND id=?').get(owner,kind,id));}
function write(owner,e){const old=get(owner,e.kind,e.id),version=(old?.version||0)+1,data=e.deleted?null:JSON.stringify(e.data);
 db.prepare('INSERT INTO entities VALUES(?,?,?,?,?,?) ON CONFLICT(owner,kind,id) DO UPDATE SET data=excluded.data,version=excluded.version,deleted=excluded.deleted').run(owner,e.kind,e.id,data,version,Number(!!e.deleted));
 // Changes are identifiers, not historical images. Pull resolves the latest entity at page-read time.
 db.prepare('INSERT INTO changes(owner,kind,id,version,data,deleted) VALUES(?,?,?,?,NULL,?)').run(owner,e.kind,e.id,version,Number(!!e.deleted));return get(owner,e.kind,e.id);}
function migrate(owner){return transaction(()=>{ensureUser(owner);if(db.prepare('SELECT 1 FROM sync_migrations WHERE owner=?').get(owner))return;
 const old=db.prepare('SELECT * FROM user_state WHERE email=?').get(owner);
 if(old)for(const e of Object.values(E.flatten(JSON.parse(old.state))))if(!get(owner,e.kind,e.id))write(owner,e);
 db.prepare('INSERT INTO sync_migrations VALUES(?,?,?)').run(owner,old?.version||0,Date.now());
 // The transaction copied every retained field. The old base64/reference snapshot must not pin media forever.
 db.prepare('DELETE FROM user_state WHERE email=?').run(owner);
});}
function validate(owner,e){if(!e||!validId(e.id)||![...E.lists,...E.members,'setting'].includes(e.kind))throw fail('记录类型或编号无效');
 if(e.kind==='setting'&&!E.settings.includes(e.id))throw fail('设置字段无效');
 if(typeof e.deleted!=='boolean'||!Number.isSafeInteger(e.expectedVersion)||e.expectedVersion<0)throw fail('缺少记录版本');
 if(e.deleted)return;
 if(e.data===undefined)throw fail('缺少记录内容');
 if(Buffer.byteLength(JSON.stringify(e.data)??'')>64000)throw fail('记录过大',413);
 let sample={dataVersion:2};if(E.lists.includes(e.kind)){if(e.data?.id!==e.id)throw fail('记录编号不一致');sample[e.kind]=[e.data];}
 else if(E.members.includes(e.kind)){if(e.data!==true)throw fail('成员值无效');sample[e.kind]=[e.id];}
 else sample[e.id]=e.data;
 const sanitized=require('./state').validate(sample,{refs:true}).s;
 e.data=E.lists.includes(e.kind)?sanitized[e.kind][0]:E.members.includes(e.kind)?true:sanitized[e.id];media.validateRefs(owner,e.data);
}
function push(owner,body){migrate(owner);const {mutationId,changes}=body;
 if(!validId(mutationId)||!Array.isArray(changes)||!changes.length||changes.length>100)throw fail('同步批次无效');
 const digest=crypto.createHash('sha256').update(E.json(changes)).digest('hex');
 return transaction(()=>{const receipt=db.prepare('SELECT * FROM mutations WHERE owner=? AND id=?').get(owner,mutationId);
  if(receipt){if(receipt.request_hash!==digest)throw fail('同一提交编号不能更换内容',409);return JSON.parse(receipt.result);}
  const keys=new Set();for(const e of changes){validate(owner,e);const k=e.kind+'/'+e.id;if(keys.has(k))throw fail('批次含重复记录');keys.add(k);}
  const results=changes.map(e=>{const old=get(owner,e.kind,e.id);if((old?.version||0)!==e.expectedVersion)return {key:e.kind+'/'+e.id,status:'conflict',current:old};
   if(!old?.deleted&&!e.deleted&&E.lists.includes(e.kind)&&!old&&db.prepare('SELECT count(*) n FROM entities WHERE owner=? AND kind=? AND deleted=0').get(owner,e.kind).n>=1000)throw fail('记录数量已达上限',413);
   return {key:e.kind+'/'+e.id,status:'ok',current:write(owner,e)};});
  const result={syncVersion:2,mutationId,results};db.prepare('INSERT INTO mutations VALUES(?,?,?,?)').run(owner,mutationId,digest,JSON.stringify(result));return result;
 });}
function pull(owner,{cursor=0,watermark,limit=100}={}){migrate(owner);return transaction(()=>{
 if(!Number.isSafeInteger(cursor)||cursor<0||!Number.isInteger(limit)||limit<1||limit>100)throw fail('同步游标无效');
 const head=db.prepare('SELECT coalesce(max(cursor),0) n FROM changes WHERE owner=?').get(owner).n;
 const end=watermark===undefined?head:watermark;if(!Number.isSafeInteger(end)||end<cursor||end>head)throw fail('同步边界无效');
 const rows=db.prepare('SELECT cursor,kind,id FROM changes WHERE owner=? AND cursor>? AND cursor<=? ORDER BY cursor LIMIT ?').all(owner,cursor,end,limit);
 const next=rows.length?rows.at(-1).cursor:end,seen=new Set(),entities=[];
 for(const r of rows){const k=r.kind+'/'+r.id;if(!seen.has(k)){seen.add(k);const e=get(owner,r.kind,r.id);if(!e.deleted)media.touch(owner,e.data);entities.push(e);}}
 return {syncVersion:2,entities,cursor:next,watermark:end,hasMore:next<end};
 });}
function generated(owner,e){migrate(owner);return transaction(()=>{const old=get(owner,e.kind,e.id);if(old)return old;validate(owner,{...e,deleted:false,expectedVersion:0});return write(owner,e);});}
function applyCutout(owner,itemId,source,image,operationId,version){return transaction(()=>{const old=get(owner,'customItems',itemId);if(!old||old.deleted)return {applied:false,reason:'衣物已移除'};
 const normalized=require('../js/wardrobe-model').normalize(old.data);if(normalized.originalImage!==source)return {applied:false,reason:'原照片已更换'};
 if(normalized.processing?.operationId===operationId)return {applied:true};
 const e={kind:'customItems',id:itemId,deleted:false,expectedVersion:old.version,data:{...normalized,cutoutImage:image,dataUrl:image,processing:{source,operationId,version},updatedAt:Date.now()}};validate(owner,e);write(owner,e);return {applied:true};
});}
module.exports={push,pull,get,generated,migrate,applyCutout};
