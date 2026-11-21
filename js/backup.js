const Backup=window.Backup={
 async export(){
  const key=LocalState.key,epoch=LocalState.epoch,current=()=>key===LocalState.key&&epoch===LocalState.epoch;
  const snapshot=structuredClone(CloudSync.snapshot());
  // Open the picker in the click gesture, before processing images.
  let native,session,writer,parts=[];
  if(AppAPI.native){native=Capacitor.registerPlugin('Backup');session=(await native.begin()).session;}
  else if(window.showSaveFilePicker){const h=await showSaveFilePicker({suggestedName:'yixianzhi-backup.yxz',types:[{description:'衣先知备份',accept:{'application/x-ndjson':['.yxz']}}]});writer=await h.createWritable();}
  let seq=0;
  const write=async text=>{if(!current())throw Error('资料已切换，导出已取消');const bytes=new TextEncoder().encode(text);for(let i=0;i<bytes.length;i+=65536){const chunk=bytes.slice(i,i+65536);if(native)await native.write({session,seq:seq++,data:btoa(String.fromCharCode(...chunk))});else if(writer)await writer.write(chunk);else parts.push(new Blob([chunk]));}};
  try{
   const encoded=await MediaCache.encode(snapshot),refs=MediaCache.refs(encoded.value),manifest=[];
   // Blob handles remain readable even when the storage recovery path cannot write.
   for(const ref of refs){const id=ref.slice(6),b=encoded.blobs.get(id)||await MediaCache.bytes(ref,key);if(!current())throw Error('资料已切换');encoded.blobs.set(id,b);manifest.push({id,mime:b.type,size:b.size});}
   const size=manifest.reduce((n,m)=>n+m.size,0);if(size>200*1024*1024)throw Error('图片超过200MB备份上限');
   await write(JSON.stringify({format:'yixianzhi-backup',schemaVersion:2,exportedAt:new Date().toISOString(),state:encoded.value,media:manifest})+'\n');
   for(const m of manifest){const b=encoded.blobs.get(m.id);const data=await new Promise((ok,no)=>{const r=new FileReader();r.onload=()=>ok(r.result);r.onerror=()=>no(r.error);r.readAsDataURL(b);});await write(JSON.stringify({type:'media',id:m.id,data})+'\n');}
   await write(JSON.stringify({type:'end',count:manifest.length,size})+'\n');
   if(native)await native.finish({session,seq});else if(writer)await writer.close();else {const u=URL.createObjectURL(new Blob(parts,{type:'application/x-ndjson'})),a=document.createElement('a');a.href=u;a.download='yixianzhi-backup.yxz';a.click();setTimeout(()=>URL.revokeObjectURL(u),10000);}
  }catch(e){if(native)await native.cancel({session}).catch(()=>{});if(writer)await writer.abort().catch(()=>{});throw e;}
 },
 validate(state){if(!state||typeof state!=='object'||Array.isArray(state))throw Error('备份状态无效');const clean={};for(const k of CloudSync.keys)if(state[k]!==undefined)clean[k]=state[k];clean.dataVersion=2;
  for(const k of ['profile','account'])if(clean[k]!==undefined&&(!clean[k]||typeof clean[k]!=='object'||Array.isArray(clean[k])))throw Error('备份档案无效');
  clean.account={nick:clean.account?.nick||'',avatar:clean.account?.avatar||''};if(typeof clean.account.nick!=='string'||clean.account.nick.length>100)throw Error('昵称格式无效');
  for(const[k,v]of Object.entries(clean.profile||{})){if(['pref','styles','colorTypes'].includes(k)){if(!Array.isArray(v)||v.length>30||v.some(x=>typeof x!=='string'||x.length>100))throw Error('偏好格式无效');}else if(typeof v!=='string'||v.length>200)throw Error('档案格式无效');}
  const id=v=>typeof v==='string'&&/^[\w-]{1,120}$/.test(v);
  for(const k of [...Entities.lists,...Entities.members]){clean[k]||=[];if(!Array.isArray(clean[k])||clean[k].length>(k==='processedSegmentTargets'?10000:1000))throw Error('备份列表超限');const ids=clean[k].map(v=>Entities.lists.includes(k)?v?.id:v);if(ids.some(v=>!id(v))||new Set(ids).size!==ids.length)throw Error('备份记录编号无效');}
  for(const i of clean.customItems)if(typeof i.name!=='string'||i.name.length>80||!['上衣','下装','鞋子','连体裙'].includes(i.cat))throw Error('衣物格式无效');
  for(const o of clean.customOutfits)if(typeof o.name!=='string'||o.name.length>80||!Array.isArray(o.items)||!o.items.length||o.items.length>4||o.items.some(v=>!id(v))||new Set(o.items).size!==o.items.length)throw Error('搭配格式无效');
  for(const h of clean.history)if(h.items!==undefined&&(!Array.isArray(h.items)||h.items.length>4||h.items.some(v=>!id(v))))throw Error('试穿记录无效');
  for(const i of [...clean.customItems,...clean.customOutfits,...clean.models,...clean.history]){for(const k of ['name','cat','scene','ph','source','kind','modelId','outfitId','gender'])if(i[k]!==undefined&&i[k]!==null&&typeof i[k]!=='string')throw Error('记录字段类型无效');for(const k of ['createdAt','updatedAt','time'])if(i[k]!==undefined&&(!Number.isFinite(i[k])||i[k]<0))throw Error('记录时间无效');}
  for(const k of ['onboarded','privacyOk','historySeeded'])if(clean[k]!==undefined&&typeof clean[k]!=='boolean')throw Error('备份设置无效');
  if(clean.curModel!==undefined&&!id(clean.curModel))throw Error('模特编号无效');
  const imagePaths=new Set(['account.avatar',...clean.customItems.map((_,i)=>'customItems.'+i+'.dataUrl'),...clean.models.map((_,i)=>'models.'+i+'.dataUrl'),...clean.history.map((_,i)=>'history.'+i+'.image')]);
  for(const p of imagePaths){let v=clean;for(const k of p.split('.'))v=v?.[k];if(v!==undefined&&v!==null&&v!==''&&(typeof v!=='string'||!/^media:[a-f0-9]{64}$/.test(v)))throw Error('图片字段无效');}
  const walk=(v,p='',d=0)=>{if(d>9)throw Error('备份嵌套过深');if(typeof v==='string'){if(imagePaths.has(p)&&v!==''&&!/^media:[a-f0-9]{64}$/.test(v))throw Error('图片字段无效');if(v.startsWith('media:')){if(!imagePaths.has(p)||!/^media:[a-f0-9]{64}$/.test(v))throw Error('图片引用无效');}else if(v.startsWith('data:')||v.length>4000||/[<>]/.test(v))throw Error('备份文本无效');}else if(v&&typeof v==='object')for(const[k,x]of Object.entries(v)){if(['__proto__','constructor','prototype'].includes(k))throw Error('备份字段无效');walk(x,p?p+'.'+k:k,d+1);}};walk(clean);return clean;
 },
 async import(file){
  const requestedKey=LocalState.key,requestedEpoch=LocalState.epoch;
  if(file.name?.endsWith('.json')){
   if(file.size>30*1024*1024)throw Error('旧版JSON备份超过30MB');
   const old=JSON.parse(await file.text());if(old.format!=='yixianzhi-backup'||old.schemaVersion!==1)throw Error('旧版备份格式不支持');
   const encoded=await MediaCache.encode(old.state),state=this.validate(encoded.value),manifest=[];for(const ref of MediaCache.refs(state)){const b=encoded.blobs.get(ref.slice(6));if(!b)throw Error('旧版备份缺少图片');manifest.push({id:ref.slice(6),mime:b.type,size:b.size});}
   const parts=[JSON.stringify({format:'yixianzhi-backup',schemaVersion:2,state,media:manifest})+'\n'];
   for(const m of manifest){const data=await new Promise((ok,no)=>{const r=new FileReader();r.onload=()=>ok(r.result);r.onerror=()=>no(r.error);r.readAsDataURL(encoded.blobs.get(m.id));});parts.push(JSON.stringify({type:'media',id:m.id,data})+'\n');}
   parts.push(JSON.stringify({type:'end',count:manifest.length,size:manifest.reduce((n,m)=>n+m.size,0)})+'\n');file=new File(parts,'converted.yxz',{type:'application/x-ndjson'});
  }
  if(requestedKey!==LocalState.key||requestedEpoch!==LocalState.epoch)throw Error('资料已切换');
  if(file.size>300*1024*1024)throw Error('备份超过300MB');const key=requestedKey,epoch=requestedEpoch,prefix=key+'|import:'+crypto.randomUUID()+'|';
  const current=()=>key===LocalState.key&&epoch===LocalState.epoch&&!LocalState.locked;let header,ended=false,count=0,size=0,seen=new Set(),manifest=new Map();
  const cleanup=()=>new Promise((ok,no)=>{const tx=LocalState.db.transaction('media','readwrite'),r=tx.objectStore('media').openCursor(IDBKeyRange.bound(prefix,prefix+'\uffff'));r.onsuccess=()=>{const c=r.result;if(c){c.delete();c.continue();}};tx.oncomplete=ok;tx.onerror=()=>no(tx.error);});
  try{
   const line=async text=>{if(!text.trim())return;if(!current())throw Error('资料已切换');if(ended)throw Error('备份结束后仍有数据');const v=JSON.parse(text);
    if(!header){if(v.format!=='yixianzhi-backup'||v.schemaVersion!==2||!Array.isArray(v.media))throw Error('请选择新版 .yxz 备份');v.state=this.validate(v.state);if(v.media.length>4001)throw Error('图片数量超限');for(const m of v.media){if(!/^[a-f0-9]{64}$/.test(m.id)||manifest.has(m.id)||!Number.isSafeInteger(m.size)||m.size<1||m.size>3*1024*1024||!['image/png','image/jpeg','image/webp'].includes(m.mime))throw Error('图片清单无效');manifest.set(m.id,m);}const refs=MediaCache.refs(v.state).map(r=>r.slice(6));if(refs.length!==manifest.size||refs.some(id=>!manifest.has(id)))throw Error('图片清单与资料不一致');header=v;return;}
    if(v.type==='end'){if(v.count!==count||v.size!==size||count!==manifest.size)throw Error('备份不完整');ended=true;return;}
    if(v.type!=='media'||!manifest.has(v.id)||seen.has(v.id))throw Error('图片记录重复或不在清单中');const b=await MediaCache.blob(v.data),m=manifest.get(v.id);if(b.size!==m.size||b.type!==m.mime||await MediaCache.digest(await b.arrayBuffer())!==v.id)throw Error('图片校验失败');seen.add(v.id);size+=b.size;if(size>200*1024*1024)throw Error('图片容量超限');await new Promise((ok,no)=>{const tx=LocalState.db.transaction('media','readwrite');tx.objectStore('media').put(b,prefix+v.id);tx.oncomplete=ok;tx.onerror=()=>no(tx.error);});count++;
   };
   const reader=file.stream().getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let buffer='';try{while(true){const r=await reader.read();if(r.done)break;buffer+=decoder.decode(r.value,{stream:true});let at;while((at=buffer.indexOf('\n'))>=0){await line(buffer.slice(0,at));buffer=buffer.slice(at+1);}if(buffer.length>16*1024*1024)throw Error('备份行过大');}buffer+=decoder.decode();if(buffer.trim())await line(buffer);}finally{await reader.cancel().catch(()=>{});}
   if(!header||!ended)throw Error('备份缺少结束记录，资料未替换');if(!current())throw Error('资料已切换');
   if(!confirm('导入将替换当前本机资料，并同步到当前登录账号。继续吗？'))return;
   await LocalState.drain();if(!current())throw Error('资料已切换');
   LocalState.locked=true;LocalState.epoch++;CloudSync.reset();
   try{await LocalState.flush();await LocalState.backup('before-import');}catch(e){LocalState.locked=false;throw e;}
   const record=structuredClone(LocalState.record),account=Store.get().account;
   record.state={...Store.defaults(),...header.state,account:{...header.state.account,email:account.email,token:account.token}};record.dirty=true;record.seq++;record.uploaded={};if(record.v2){record.v2.pending=null;record.v2.conflicts={};}record.conflict=false;
   try{await new Promise((ok,no)=>{const tx=LocalState.db.transaction(['media','snapshots'],'readwrite');for(const id of manifest.keys()){const get=tx.objectStore('media').get(prefix+id);get.onsuccess=()=>{if(!get.result){tx.abort();return;}tx.objectStore('media').put(get.result,key+'|'+id);};}tx.objectStore('snapshots').put(record,key);tx.oncomplete=ok;tx.onerror=()=>no(tx.error);tx.onabort=()=>no(tx.error||Error('导入保存失败'));});LocalState.record=record;Store._cache=null;MediaCache.reset();}
   finally{LocalState.locked=false;}
   CloudSync.schedule();window.dispatchEvent(new Event('data-synced'));toast('资料已导入');
  }finally{await cleanup();}
 }
};
