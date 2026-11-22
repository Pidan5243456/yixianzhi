const CloudSync={
 timer:null,busy:false,runCounter:0,activeRun:0,message:'尚未同步',
 keys:['dataVersion','customOutfits','account','profile','favorites','wardrobe','deletedItems','onboarded','privacyOk','curModel','customItems','models','history','historySeeded','processedSegmentTargets'],
 snapshot(){const s=Store.get(),out={};for(const k of this.keys)if(s[k]!==undefined)out[k]=structuredClone(s[k]);out.dataVersion=3;out.account={nick:s.account?.nick||'',avatar:s.account?.avatar||''};return out;},
 stop(){clearTimeout(this.timer);},reset(){this.stop();this.activeRun=++this.runCounter;this.busy=false;},
 schedule(){this.stop();if(!AppAPI.demo&&!LocalState.locked)this.timer=setTimeout(()=>this.run(),1500);},
 status(message){this.message=message;window.dispatchEvent(new Event('sync-status'));},
 meta(){return LocalState.record.v2||=( {base:{},cursor:0,watermark:null,conflicts:{},pending:null,initialized:false} );},
 same(a,b){return !!a?.deleted===!!b?.deleted&&Entities.json(a?.deleted?null:a?.data)===Entities.json(b?.deleted?null:b?.data);},
 async local(){return Entities.flatten((await MediaCache.encode(this.snapshot())).value);},
 async request(path,body){const r=await AppAPI.request(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,clientDataVersion:3})}),data=await r.json();if(!r.ok)throw Object.assign(Error(data.error||'同步失败'),{status:r.status});if(data.syncVersion!==2)throw Error('后端版本不兼容，请更新服务');return data;},
 async receive(remote,current){if(!current())return;const r=LocalState.record,m=this.meta(),local=await this.local();if(!current())return;
  const state=structuredClone(Store.get());
  for(const e of remote.entities){const k=e.kind+'/'+e.id,base=m.base[k],here=local[k]||{deleted:true};if(base&&e.version<=base.version)continue;
   for(const ref of MediaCache.refs(e.data))(r.uploaded||={})[ref]=Date.now();
   if(this.same(here,e)||this.same(here,base||{deleted:true})||(!m.initialized&&!r.dirty)){Entities.apply(state,e);delete m.conflicts[k];}
   else m.conflicts[k]=e;
   m.base[k]=e;
  }
  r.state=state;Store._cache=null;m.cursor=remote.cursor;m.watermark=remote.hasMore?remote.watermark:null;m.initialized=true;r.conflict=Object.keys(m.conflicts).length>0;
  await LocalState.persist();if(current())window.dispatchEvent(new Event('data-synced'));
 },
 async pull(current){let more=true;while(more&&current()){const m=this.meta(),data=await this.request('/api/sync/pull',{cursor:m.cursor,...(m.watermark===null?{}:{watermark:m.watermark}),limit:100});if(!current())return;await this.receive(data,current);more=data.hasMore;}},
 async pending(current){const m=this.meta(),pending=m.pending;if(!pending)return;const reply=await this.request('/api/sync/push',pending);if(!current())return;
  for(const r of reply.results){if(r.status==='ok'){m.base[r.key]=r.current;delete m.conflicts[r.key];}else {m.base[r.key]=r.current;m.conflicts[r.key]=r.current;}}
  m.pending=null;LocalState.record.conflict=Object.keys(m.conflicts).length>0;await LocalState.persist();
 },
 async run({choice=null}={}){
  const r=LocalState.record;if(this.busy||AppAPI.demo||!r.state.account?.token||LocalState.locked)return;
  this.busy=true;const run=++this.runCounter;this.activeRun=run;const epoch=LocalState.epoch,key=LocalState.key;
  const current=()=>this.activeRun===run&&epoch===LocalState.epoch&&key===LocalState.key&&r===LocalState.record&&!LocalState.locked;
  try{
   await LocalState.flush();if(!current())return;
   const m=this.meta();if(!m.migrationBackup){await LocalState.backup('before-v2');if(!current())return;m.migrationBackup=true;await LocalState.persist();}
   // Lost acknowledgements are replayed before pulling, using the exact persisted mutation.
   await this.pending(current);if(!current())return;await this.pull(current);if(!current())return;
   if(choice)for(const k of Object.keys(m.conflicts))await this.resolve(k,choice,false);
   let local=await this.local();if(!current())return;
   const keys=new Set([...Object.keys(local),...Object.keys(m.base)]),changes=[];
   for(const k of keys){if(m.conflicts[k])continue;const here=local[k]||{deleted:true},base=m.base[k]||{deleted:true,version:0};if(this.same(here,base))continue;const [kind,id]=k.split('/');changes.push({kind,id,data:here.deleted?null:here.data,deleted:!!here.deleted,expectedVersion:base.version||0});}
   for(let i=0;i<changes.length&&current();i+=100){const batch=changes.slice(i,i+100);for(const e of batch)if(!e.deleted)e.data=await MediaCache.upload(e.data,current);if(!current())return;
    m.pending={mutationId:crypto.randomUUID(),changes:batch};await LocalState.persist();if(!current())return;await this.pending(current);
   }
   if(!current())return;await this.pull(current);if(!current())return;
   local=await this.local();if(!current())return;r.dirty=[...new Set([...Object.keys(local),...Object.keys(m.base)])].some(k=>!this.same(local[k]||{deleted:true},m.base[k]||{deleted:true}));
   r.lastSync=Date.now();r.conflict=Object.keys(m.conflicts).length>0;await LocalState.persist();
   this.status(r.conflict?'部分记录有冲突，请逐条选择':r.dirty?'本机有新修改，等待同步':'已同步到服务');if(r.dirty&&!r.conflict)this.schedule();
  }catch(e){if(current())this.status('未同步：'+e.message+'。本机资料已保留');}
  finally{if(this.activeRun===run)this.busy=false;}
 },
 async resolve(key,choice,run=true){const m=this.meta(),remote=m.conflicts[key];if(!remote)return;const epoch=LocalState.epoch,seq=LocalState.record.seq;await LocalState.backup('conflict');if(epoch!==LocalState.epoch||seq!==LocalState.record.seq)throw Error('本机资料刚有修改，请重新选择');
  if(choice==='cloud'){const s=structuredClone(Store.get());Entities.apply(s,remote);LocalState.record.state=s;Store._cache=null;}
  delete m.conflicts[key];LocalState.record.conflict=Object.keys(m.conflicts).length>0;LocalState.record.dirty=true;await LocalState.persist();if(run)await this.run();
 },
 apply(state){const local=Store.get();LocalState.record.state={...Store.defaults(),...state,account:{...state.account,email:local.account?.email,token:local.account?.token}};Store._cache=null;}
};
async function pullLightState(){await CloudSync.run({pull:true});}function pushLightState(){CloudSync.schedule();}
window.addEventListener('online',()=>CloudSync.run({pull:true}));
