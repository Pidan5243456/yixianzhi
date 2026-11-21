
  renderStatusbar();

  const DEFAULT_NICK = "我的账号";

  function acc() { return Store.get().account || {}; }
  function saveAcc(patch) {
    const ok = Store.set({ account: { ...acc(), ...patch } });
    render();
    return ok;
  }

  function render() {
    const a = acc();
    const nick = a.nick || DEFAULT_NICK;
    $("#nickVal").textContent = nick;
    $("#miniAvatar").innerHTML = a.avatar ? `<img src="${MediaCache.src(a.avatar)}" alt="">` : nick[0];
    if (a.email) {
      $("#emailVal").textContent = a.email;
      $("#emailVal").classList.remove("add");
    }
  }

  /* 头像：选图 → 压缩 → 存本地 */
  $("#avatarFile").addEventListener("change", e => {
    const file = e.target.files[0];
    if (!file) return;
    if(!file.type.startsWith('image/')||file.size>20*1024*1024){toast('请选择不超过20MB的图片');return;}
    const key=LocalState.key,epoch=LocalState.epoch;
    LocalState.prepare(async()=>{const raw=await new Promise((ok,no)=>{const reader=new FileReader();reader.onload=()=>ok(reader.result);reader.onerror=()=>no(reader.error);reader.readAsDataURL(file);});const small=await compressImage(raw,400);if(key!==LocalState.key||epoch!==LocalState.epoch||LocalState.locked)return;saveAcc({avatar:small});await LocalState.flush();toast('头像已更新');}).catch(e=>toast(e.message||'照片处理失败'));
    e.target.value = "";
  });

  function openNickSheet() {
    $("#nickIn").value = acc().nick || DEFAULT_NICK;
    openSheet("sheetNick");
  }
  function saveNick() {
    const v = $("#nickIn").value.trim();
    if (!v) { toast("昵称不能为空"); return; }
    saveAcc({ nick: v });
    closeSheet("sheetNick");
    savedToast("已保存");
  }

  /* 退出登录：清登录态（邮箱+token），昵称头像和衣橱数据保留在本机 */
  function doLogout() {
    LocalState.logout().catch(e => toast('退出失败：' + e.message));
  }

  render();

$('#deleteAccount').onclick=async()=>{if(AppAPI.demo){toast('本地演示请在设置中重置资料');return;}if(!confirm('注销将删除云端账号、衣物和照片，并清除本机该账号资料。此操作无法撤销，继续吗？'))return;const button=$('#deleteAccount');button.disabled=true;try{await LocalState.drain();await LocalState.flush();const sent=await AppAPI.request('/api/auth/send-code',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:Store.get().account.email,purpose:'delete'})});const verification=await sent.json();if(!sent.ok)throw Error(verification.error||'验证码发送失败');const code=prompt('输入发送到当前账号邮箱的注销验证码',verification.devCode||'');if(!code){button.disabled=false;return;}const r=await AppAPI.request('/api/account/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirm:'DELETE',code})});const data=await r.json();if(!r.ok)throw Error(data.error||'注销未完成，请稍后重试');await LocalState.erase();}catch(e){toast(e.message);button.disabled=false;}};
