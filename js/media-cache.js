/* Image bytes are stored once per account; snapshots carry content hashes. */
const MediaCache=window.MediaCache={
 urls:new Map(),pending:new Map(),
 async digest(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');},
 async blob(data){const m=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(data);if(!m)throw Error('图片格式无效');const raw=atob(m[2]),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));if(bytes.length>3*1024*1024)throw Error('单张图片超过3MB');return new Blob([bytes],{type:'image/'+m[1]});},
 async encode(value){const blobs=new Map();const walk=async v=>{if(typeof v==='string'&&v.startsWith('data:image/')){const b=await this.blob(v),id=await this.digest(await b.arrayBuffer());blobs.set(id,b);return 'media:'+id;}if(Array.isArray(v))return Promise.all(v.map(walk));if(v&&typeof v==='object')return Object.fromEntries(await Promise.all(Object.entries(v).map(async([k,x])=>[k,await walk(x)])));return v;};return {value:await walk(value),blobs};},
 async read(id,key=LocalState.key){return new Promise((ok,no)=>{const r=LocalState.db.transaction('media').objectStore('media').get(key+'|'+id);r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});},
 async put(id,blob,key=LocalState.key){return new Promise((ok,no)=>{const t=LocalState.db.transaction('media','readwrite');t.objectStore('media').put(blob,key+'|'+id);t.oncomplete=ok;t.onerror=()=>no(t.error);t.onabort=()=>no(t.error);});},
 async bytes(ref,key=LocalState.key){if(!/^media:[a-f0-9]{64}$/.test(ref))return this.blob(ref);const id=ref.slice(6),found=await this.read(id,key);if(found)return found;
  if(key!==LocalState.key||AppAPI.demo)throw Error('本机缺少这张图片');
  const r=await AppAPI.request('/api/media/'+id);const data=await r.json();if(!r.ok)throw Error(data.error||'图片无法下载');
  if(key!==LocalState.key)throw Error('账号已切换');const b=await this.blob(data.dataUrl);if(await this.digest(await b.arrayBuffer())!==id)throw Error('图片校验失败');await this.put(id,b,key);return b;
 },
 async data(ref,key=LocalState.key){if(!ref?.startsWith('media:'))return ref;const b=await this.bytes(ref,key);return new Promise((ok,no)=>{const r=new FileReader();r.onload=()=>ok(r.result);r.onerror=()=>no(r.error);r.readAsDataURL(b);});},
 async url(ref){if(!ref?.startsWith('media:'))return ref;const key=LocalState.key+'|'+ref;if(this.urls.has(key))return this.urls.get(key);if(this.pending.has(key))return this.pending.get(key);
  const partition=LocalState.key,p=this.bytes(ref,partition).then(b=>{if(partition!==LocalState.key)throw Error('账号已切换');const u=URL.createObjectURL(b);this.urls.set(key,u);return u;}).finally(()=>this.pending.delete(key));this.pending.set(key,p);return p;
 },
 src(value){if(typeof value!=='string')return 'assets/ph/tee.svg';if(/^media:[a-f0-9]{64}$/.test(value))return 'assets/ph/tee.svg#media='+value.slice(6);return /^(?:assets\/[a-zA-Z0-9_./-]+|data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*|blob:[^\s"'<>]+)$/.test(value)?value:'assets/ph/tee.svg';},
 reset(){for(const u of this.urls.values())URL.revokeObjectURL(u);this.urls.clear();this.pending.clear();},
 refs(value){return [...new Set((JSON.stringify(value).match(/media:[a-f0-9]{64}/g)||[]))];},
 async upload(value,current=()=>true,{force=false}={}){const key=LocalState.key,epoch=LocalState.epoch,guard=current;current=()=>key===LocalState.key&&epoch===LocalState.epoch&&!LocalState.locked&&guard();const encoded=await this.encode(value);for(const [id,b]of encoded.blobs){if(!current())throw Error('资料已切换');await this.put(id,b,key);}
  for(const ref of this.refs(encoded.value)){if(!current())throw Error('资料已切换');if(!force&&Number(LocalState.record.uploaded?.[ref])>Date.now()-20*3600000)continue;const image=await this.data(ref,key);if(!current())throw Error('资料已切换');const r=await AppAPI.request('/api/media/upload',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image})});const result=await r.json();if(!r.ok)throw Error(result.error||'图片上传失败');if(result.ref!==ref)throw Error('图片校验不一致');if(!current())throw Error('资料已切换');(LocalState.record.uploaded||={})[ref]=Date.now();}
  return encoded.value;
 }
};
document.addEventListener('DOMContentLoaded',()=>{
 const io=new IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting){const img=e.target,ref=img.dataset.mediaRef,key=LocalState.key;io.unobserve(img);MediaCache.url(ref).then(src=>{if(img.isConnected&&key===LocalState.key&&img.dataset.mediaRef===ref)img.src=src;}).catch(()=>{img.alt='图片暂不可用';img.dataset.mediaMissing='true';});}},{rootMargin:'150px'});
 const scan=node=>{const images=node.nodeType===1?[...(node.tagName==='IMG'?[node]:[]),...node.querySelectorAll('img')]:[];for(const img of images){const src=img.getAttribute('src')||'',m=/#media=([a-f0-9]{64})$/.exec(src);if(m){img.dataset.mediaRef='media:'+m[1];io.observe(img);}}};
 new MutationObserver(records=>{for(const r of records){if(r.type==='attributes')scan(r.target);else for(const n of r.addedNodes)scan(n);}}).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['src']});scan(document.body);
});
