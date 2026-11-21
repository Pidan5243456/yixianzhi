(async()=>{
  try {
    await LocalState.open();
    const scripts=JSON.parse(document.getElementById('page-scripts').textContent);
    scripts.splice(scripts.indexOf('js/app.js')+1,0,'js/product.js');
    for(const src of scripts) await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=()=>reject(new Error('资源加载失败：'+src));document.body.append(s);});
    window.APP_READY = true;
    window.dispatchEvent(new Event('app-ready'));
    CloudSync.schedule();
    if(!AppAPI.demo && Store.get().account?.token) {
      const epoch=LocalState.epoch,key=LocalState.key;
      AppAPI.request('/api/segment/jobs').then(r=>r.ok?r.json():null).then(data=>{
        if(!data||LocalState.locked||epoch!==LocalState.epoch||key!==LocalState.key)return;
        const existing=Store.get().pendingSegments||[],known=new Set(existing.map(j=>j.jobId));
        const add=data.jobs.filter(j=>!known.has(j.jobId)&&j.status!=='error').map(j=>({...j,landed:[]}));
        if(add.length) {Store.set({pendingSegments:[...existing,...add]});pollSegmentJobs();}
      }).catch(()=>{});
    }
  } catch(e) {
    const box=document.createElement('div');box.style.cssText='position:fixed;inset:0;background:white;z-index:10000;padding:40px 20px';
    const text=document.createElement('p');text.textContent='无法打开本机资料：'+e.message+'。资料未被覆盖。';box.append(text);
    const button=document.createElement('button');button.textContent='重新打开';button.className='btn btn-primary';button.onclick=()=>location.reload();box.append(button);document.body.append(box);
  }
})();
