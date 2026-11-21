/* A snapshot is saved together with its revision/dirty flags in one IDB transaction. */
const LocalState = window.LocalState = {
  db:null, record:null, key:'', queue:Promise.resolve(), error:null, locked:false, epoch:0,
  fresh() { return {state:{},revision:0,dirty:false,seq:0,conflict:false,lastSync:null}; },
  async open() {
    this.db=await new Promise((resolve,reject)=>{const r=indexedDB.open('yixianzhi',1);r.onupgradeneeded=()=>r.result.createObjectStore('snapshots');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    await this.load();
    // Import only an unambiguously owned, same-origin legacy snapshot. Keep the source.
    const old=localStorage.getItem('aiwd-state');
    if(old && !Object.keys(this.record.state).length && !this.record.migrated) {
      try {const legacy=JSON.parse(old),email=legacy.account?.email||'';
        if(email && email===(localStorage.getItem('yxz-active-account')||'')) {this.record.state=legacy;this.record.dirty=true;this.record.migrated=true;await this.persist();}
      } catch(e) {console.warn('旧资料保留，等待手动导入');}
    }
  },
  async read(key) { return new Promise((resolve,reject)=>{const r=this.db.transaction('snapshots').objectStore('snapshots').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);}); },
  async load() {
    this.locked=true;
    const epoch=++this.epoch;
    if(typeof CloudSync!=='undefined') CloudSync.reset();
    const partition=()=>AppAPI.scope+'|'+(localStorage.getItem('yxz-active-account')||'guest');
    const key=partition();
    await this.flush();
    const record=await this.read(key)||this.fresh();
    if(epoch!==this.epoch) return false;
    if(key!==partition()) return this.load();
    // Publish the partition and its snapshot together, after invalidating old requests.
    this.key=key;this.record=record;
    if(typeof Store!=='undefined') Store._cache=null;
    this.locked=false;return true;
  },
  write(key,value) {
    return new Promise((resolve,reject)=>{const tx=this.db.transaction('snapshots','readwrite');tx.objectStore('snapshots').put(value,key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('存储事务中断'));});
  },
  persist() {
    const key=this.key,copy=structuredClone(this.record);
    this.queue=this.queue.catch(()=>{}).then(()=>this.write(key,copy)).then(()=>{this.error=null;},e=>{this.error=e;throw e;});
    this.queue.catch(()=>{}); return this.queue;
  },
  set(state) {
    if(this.locked) return false;
    this.record.state=state;this.record.dirty=true;this.record.seq++;this.persist();
    if(typeof CloudSync!=='undefined') CloudSync.schedule(); return true;
  },
  preparations:new Set(),
  prepare(fn) {const p=Promise.resolve().then(fn);this.preparations.add(p);p.finally(()=>this.preparations.delete(p)).catch(()=>{});return p;},
  async drain() {while(this.preparations.size)await Promise.all([...this.preparations]);},
  async flush() { await this.queue; if(this.error) throw this.error; },
  async backup(label='backup') { await this.write(this.key+'|'+label+'|'+Date.now(),structuredClone(this.record)); },
  async activate(email,token) {
    await this.flush();localStorage.setItem('yxz-active-account',email);
    if(!await this.load()) throw new Error('会话已切换，请重新登录');
    this.record.state.account={...(this.record.state.account||{}),email,token};await this.persist();
    Store._cache=null;
  },
  async logout() {
    await this.flush();this.epoch++;CloudSync.reset();
    if(this.record.state.account) this.record.state.account.token='';await this.persist();
    localStorage.removeItem('yxz-active-account');await AppNav.go('login.html',true);
  }
};
const AppNav = {
  navigating:false,
  async leave(action) {
    if(LocalState.locked||this.navigating) return;
    this.navigating=true;
    try{await LocalState.drain();}catch(e){this.navigating=false;toast("照片处理失败，请重试");return;}
    LocalState.locked=true;LocalState.epoch++;if(typeof CloudSync!=='undefined') CloudSync.stop();
    try {await LocalState.flush();action();}
    catch(e) {this.navigating=false;LocalState.locked=false;toast('保存失败，已留在当前页。请重试保存或导出资料');showStorageRecovery();}
  },
  go(url,replace=false) {return this.leave(()=>replace?location.replace(url):location.assign(url));},
  replace(url) {return this.go(url,true);},
  back() {return this.leave(()=>history.length>1?history.back():location.assign('home.html'));},
  reload() {return this.leave(()=>location.reload());},
  exit() {return this.leave(()=>window.Capacitor.registerPlugin('App').exitApp());}
};
document.addEventListener('click',e=>{
  const a=e.target.closest('a[href]'); if(!a||a.download||a.target==='_blank') return;
  const href=a.getAttribute('href'); if(!href||href.startsWith('#')||href.startsWith('javascript:')) return;
  const u=new URL(href,location.href);if(u.origin!==location.origin||!u.pathname.endsWith('.html')) return;
  e.preventDefault();AppNav.go(href);
});
function savedToast(msg) { const pending=LocalState.queue; pending.then(()=>toast(msg),()=>toast('保存失败，请重试保存或导出资料')); }
async function exportBackup() {
  // Export the newest in-memory snapshot even when the disk is full.
  const data=JSON.stringify({format:'yixianzhi-backup',schemaVersion:1,exportedAt:new Date().toISOString(),state:CloudSync.snapshot()});
  if(AppAPI.native) await window.Capacitor.registerPlugin('Backup').export({data});
  else {const u=URL.createObjectURL(new Blob([data],{type:'application/json'}));const a=document.createElement('a');a.href=u;a.download='yixianzhi-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),10000);}
}
function showStorageRecovery() {
  if(document.getElementById('storageRecovery'))return;
  const box=document.createElement('div');box.id='storageRecovery';box.className='modal-mask show';
  box.innerHTML='<div class="modal"><h3>本机保存失败</h3><p>最新资料仍在当前页面内存中。可以重试保存，或先导出备份。</p><button class="btn btn-primary btn-block" data-retry>重试保存</button><button class="btn btn-ghost btn-block" style="margin-top:12px" data-export>导出当前资料</button><button class="btn btn-ghost btn-block" style="margin-top:12px" data-close>留在当前页</button></div>';
  box.querySelector('[data-retry]').onclick=async()=>{try{await LocalState.persist();box.remove();toast('已保存');}catch{toast('仍无法保存，请导出备份');}};
  box.querySelector('[data-export]').onclick=()=>exportBackup().then(()=>toast('已导出当前资料'),e=>toast(e.message));
  box.querySelector('[data-close]').onclick=()=>box.remove();document.body.append(box);
}
