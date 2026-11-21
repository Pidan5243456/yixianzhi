const CloudSync = {
  timer:null,busy:false,runCounter:0,activeRun:0,message:'尚未同步',
  keys:['dataVersion','customOutfits','account','profile','favorites','wardrobe','deletedItems','onboarded','privacyOk','curModel','customItems','models','history','historySeeded','processedSegmentTargets'],
  snapshot() {const s=Store.get(),out={};for(const k of this.keys) if(s[k]!==undefined) out[k]=structuredClone(s[k]);out.dataVersion=2;out.account={nick:s.account?.nick||'',avatar:s.account?.avatar||''};return out;},
  stop() {clearTimeout(this.timer);},
  reset() {this.stop();this.activeRun=++this.runCounter;this.busy=false;},
  schedule() {this.stop();if(!AppAPI.demo && !LocalState.locked) this.timer=setTimeout(()=>this.run(),1500);},
  status(text) {this.message=text;window.dispatchEvent(new Event('sync-status'));},
  async run({pull=false,choice=null}={}) {
    const r=LocalState.record;
    if(this.busy||AppAPI.demo||!r.state.account?.token||LocalState.locked) return;
    this.busy=true;const run=++this.runCounter;this.activeRun=run;const epoch=LocalState.epoch,seq=r.seq,key=LocalState.key;
    const current=()=>this.activeRun===run&&epoch===LocalState.epoch&&key===LocalState.key&&r===LocalState.record&&!LocalState.locked;
    try {
      await LocalState.flush();
      if(!current())return;
      if(pull||choice||r.conflict) {
        const resp=await AppAPI.request('/api/state/pull',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
        const remote=await resp.json();if(!resp.ok) throw new Error(remote.error||'同步失败');if(!current()) return;
        if(remote.schemaVersion!==1) throw new Error('不兼容的同步服务');
        if(choice) {
          if(r.seq!==seq) throw new Error('本机资料刚有修改，请重新选择版本');
          await LocalState.backup('conflict');if(!current())return;
          if(r.seq!==seq) throw new Error('备份期间本机资料有修改，请重新选择版本');
          if(choice==='cloud') this.apply(remote.state || {});
          r.revision=remote.version;r.conflict=false;r.dirty=choice==='local';
        } else if((r.dirty||r.seq!==seq) && remote.version!==r.revision) {
          r.conflict=true;await LocalState.persist();this.status('同步冲突：请在服务连接页选择版本');return;
        } else if(!r.dirty && r.seq===seq && remote.state) {this.apply(remote.state);r.revision=remote.version;r.conflict=false;}
        else if(!r.dirty && r.seq===seq) r.revision=remote.version;
        await LocalState.persist();
      }
      if(!current())return;
      if(r.conflict) {this.status('同步冲突：请选择保留版本');return;}
      if(r.dirty) {
        const sentSeq=r.seq,payload=this.snapshot();
        const resp=await AppAPI.request('/api/state/push',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({schemaVersion:1,expectedVersion:r.revision,state:payload})});
        const reply=await resp.json();if(!current())return;
        if(resp.status===409) {r.conflict=true;await LocalState.persist();this.status('同步冲突：本机资料已保留，请选择版本');return;}
        if(!resp.ok)throw new Error(reply.error||'同步失败');
        if(reply.dataVersion!==2)throw new Error("后端版本过旧，请更新衣先知服务");
        r.revision=reply.version;r.dirty=r.seq!==sentSeq;
      }
      r.lastSync=Date.now();await LocalState.persist();this.status(r.dirty?'本机有新修改，等待同步':'已同步到服务');
      if(r.dirty)this.schedule();
    } catch(e) {if(current())this.status('未同步：'+e.message+'。本机资料已保留');}
    finally {if(this.activeRun===run)this.busy=false;}
  },
  apply(state) {
    const local=Store.get(),account={...state.account,email:local.account?.email,token:local.account?.token};
    LocalState.record.state={...Store.defaults(),...state,account,pendingUpload:local.pendingUpload,pendingSegments:local.pendingSegments||[]};
    Store._cache=null;
  }
};
async function pullLightState() { await CloudSync.run({pull:true}); }
function pushLightState() { CloudSync.schedule(); }
window.addEventListener('online',()=>CloudSync.run({pull:true}));
