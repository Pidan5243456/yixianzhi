
  document.getElementById('endpoint').value = AppAPI.base;
  async function choose(config) {
    if (window.LocalState) await LocalState.drain(); await LocalState.flush();
    LocalState.epoch++; CloudSync.stop(); localStorage.removeItem('yxz-active-account');
    localStorage.setItem('yxz-connection', JSON.stringify(config));
    AppNav.replace('login.html');
  }
  document.getElementById('save').onclick = async () => {
    const status = document.getElementById('status'), button = document.getElementById('save');
    button.disabled = true; status.textContent = '正在检测…';
    try {
      const base = AppAPI.validateBase(document.getElementById('endpoint').value.trim());
      const r = await fetch(base + '/api/health', { signal: AbortSignal.timeout(10000), credentials:'omit' });
      const info = await r.json();
      if (!r.ok || info.service !== 'yixianzhi' || info.syncVersion !== 2) throw new Error('服务不兼容，请使用随 APK 提供的衣先知后端');
      await choose({base,mode:'remote'});
    } catch(e) { status.textContent = '连接失败：' + e.message; } finally { button.disabled = false; }
  };
  document.getElementById('demo').onclick = () => choose({mode:'demo',base:''});
function renderSyncStatus() {
  document.getElementById('syncStatus').textContent=AppAPI.demo?'本地演示：资料已保存到本机':CloudSync.message;
  const box=document.getElementById('conflictActions');box.hidden=!LocalState.record.conflict;
  box.innerHTML=Object.entries(LocalState.record.v2?.conflicts||{}).map(([key,e])=>'<div style="padding:14px 0;border-bottom:1px solid var(--line)"><p>'+escapeHTML(e.data?.name||e.id)+' · '+(e.deleted?'云端已删除':'本机和云端都有修改')+'</p><button class="btn btn-ghost" data-conflict="'+escapeHTML(key)+'" data-choice="cloud">使用云端版本</button><button class="btn btn-ghost" data-conflict="'+escapeHTML(key)+'" data-choice="local">保留本机版本</button></div>').join('');
  box.querySelectorAll('[data-conflict]').forEach(b=>b.onclick=async()=>{try{await CloudSync.resolve(b.dataset.conflict,b.dataset.choice);renderSyncStatus();}catch(e){toast(e.message);}});
}
window.addEventListener('sync-status',renderSyncStatus);renderSyncStatus();
document.getElementById('syncNow').onclick=async()=>{try{await LocalState.persist();await CloudSync.run({pull:true});renderSyncStatus();}catch(e){toast('保存失败：'+e.message);}};

document.getElementById('export').onclick=async()=>{
  try {
    await exportBackup();
    toast('备份已导出');
  }catch(e){toast(e.message||'导出失败');}
};
document.getElementById('import').onclick=()=>document.getElementById('backupFile').click();
document.getElementById('backupFile').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{await Backup.import(file);}catch(err){toast('导入失败：'+err.message);}finally{e.target.value='';}};
