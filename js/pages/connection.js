
  document.getElementById('endpoint').value = AppAPI.base;
  async function choose(config) {
    if (window.LocalState) await LocalState.flush();
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
      if (!r.ok || info.service !== 'yixianzhi' || info.syncVersion !== 1) throw new Error('服务不兼容，请使用随 APK 提供的衣先知后端');
      await choose({base,mode:'remote'});
    } catch(e) { status.textContent = '连接失败：' + e.message; } finally { button.disabled = false; }
  };
  document.getElementById('demo').onclick = () => choose({mode:'demo',base:''});
function renderSyncStatus() {
  document.getElementById('syncStatus').textContent=AppAPI.demo?'本地演示：资料已保存到本机':CloudSync.message;
  document.getElementById('conflictActions').hidden=!LocalState.record.conflict;
}
window.addEventListener('sync-status',renderSyncStatus);renderSyncStatus();
document.getElementById('syncNow').onclick=async()=>{try{await LocalState.persist();await CloudSync.run({pull:true});renderSyncStatus();}catch(e){toast('保存失败：'+e.message);}};
for(const [id,choice] of [['useCloud','cloud'],['useLocal','local']])document.getElementById(id).onclick=async()=>{if(!confirm('确认使用'+(choice==='cloud'?'云端':'本机')+'版本？'))return;await CloudSync.run({pull:true,choice});renderSyncStatus();};
document.getElementById('export').onclick=async()=>{
  try {
    await exportBackup();
    toast('备份已导出');
  }catch(e){toast(e.message||'导出失败');}
};
document.getElementById('import').onclick=()=>document.getElementById('backupFile').click();
document.getElementById('backupFile').onchange=async e=>{
  const file=e.target.files[0];if(!file)return;
  try{
    if(file.size>30*1024*1024)throw new Error('备份超过30MB');
    const data=JSON.parse(await file.text());
    if(data.format!=='yixianzhi-backup'||data.schemaVersion!==1||!data.state||typeof data.state!=='object')throw new Error('备份格式不支持');
    const clean={};for(const k of CloudSync.keys)if(data.state[k]!==undefined)clean[k]=data.state[k];
    clean.account={nick:clean.account?.nick||'',avatar:clean.account?.avatar||''};
    if(typeof clean.account.nick!=='string'||clean.account.nick.length>100)throw new Error('昵称格式错误');
    if(clean.profile!==undefined && (!clean.profile||typeof clean.profile!=='object'||Array.isArray(clean.profile)))throw new Error('档案格式错误');
    for(const [k,v]of Object.entries(clean.profile||{})) {
      if(['pref','styles','colorTypes'].includes(k)){if(!Array.isArray(v)||v.some(x=>typeof x!=='string'))throw new Error('偏好格式错误');}
      else if(typeof v!=='string')throw new Error('档案格式错误');
    }
    for(const k of ['favorites','wardrobe','deletedItems','customItems','customOutfits','models','history','processedSegmentTargets'])if(clean[k]!==undefined&&(!Array.isArray(clean[k])||clean[k].length>10000))throw new Error('备份列表格式错误');
    for(const k of ['customItems','models','history'])for(const i of clean[k]||[])if(!i||typeof i!=='object'||typeof i.id!=='string'||!/^[\w-]{1,120}$/.test(i.id))throw new Error('备份记录格式错误');
    for(const i of clean.customItems||[])if(!['上衣','下装','鞋子','连体裙'].includes(i.cat)||typeof i.name!=='string')throw new Error('衣物格式错误');
    for(const k of ['onboarded','privacyOk','historySeeded'])if(clean[k]!==undefined&&typeof clean[k]!=='boolean')throw new Error('开关格式错误');
    function check(v,depth=0){if(depth>9)throw new Error('备份结构错误');if(typeof v==='string'){if(v.startsWith('data:')){if(!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(v)||v.length>4.1*1024*1024)throw new Error('备份图片不合法');}else if(/[<>"'`]/.test(v)||v.length>4000)throw new Error('备份文本不合法');}else if(v&&typeof v==='object'){for(const[k,c]of Object.entries(v)){if(['__proto__','constructor','prototype'].includes(k))throw new Error('备份字段错误');check(c,depth+1);}}}check(clean);
    if(!confirm('导入将替换当前本机资料。已登录时会同步到当前账号，是否继续？'))return;
    await LocalState.backup('before-import');
    Store.set({...Store.defaults(),...clean,account:{...clean.account,email:Store.get().account.email,token:Store.get().account.token}});
    await LocalState.flush();toast('已导入资料');
  }catch(err){toast('导入失败：'+err.message);}finally{e.target.value='';}
};
