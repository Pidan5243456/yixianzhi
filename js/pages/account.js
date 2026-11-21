
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
    $("#miniAvatar").innerHTML = a.avatar ? `<img src="${a.avatar}" alt="">` : nick[0];
    if (a.email) {
      $("#emailVal").textContent = a.email;
      $("#emailVal").classList.remove("add");
    }
  }

  /* 头像：选图 → 压缩 → 存本地 */
  $("#avatarFile").addEventListener("change", e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const small = await compressImage(reader.result, 400);
      const ok = saveAcc({ avatar: small });
      if (ok !== false) savedToast("头像已更新");
    };
    reader.readAsDataURL(file);
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
