  if (AppAPI.demo) document.querySelector('.login-tip').textContent = '本地演示：资料保存在本机，未开启真实 AI';

  renderStatusbar();

  const isEmail = s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

  function agreeOk() {
    if (!$("#agreeChk").checked) { toast("请先勾选并同意底部协议"); return false; }
    return true;
  }

  /* 调后端；后端不在线（本地双击 HTML 打开）→ 抛 offline，走演示模式 */
  async function api(path, body) {
    let r;
    try {
      if (AppAPI.demo) { if (path.endsWith("send-code")) return {devCode:"123456"}; return {token:""}; }
      r = await AppAPI.request(path, {
        method: "POST",
        /* X-Sid：把匿名会话号带给后端，login_success 埋点能绑定 会话↔邮箱（看板归因用） */
        headers: { "Content-Type": "application/json", "X-Sid": Track.sid() },
        body: JSON.stringify(body),
      });
    } catch {
      const e = new Error("offline"); e.offline = true; throw e;
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || "请求失败，请稍后再试");
    return data;
  }

  let demoMode = AppAPI.demo;   // 后端不在线时任意 6 位验证码可登录

  function refreshLoginBtn() {
    $("#btnLogin").disabled = !(isEmail($("#email").value.trim()) && /^\d{6}$/.test($("#code").value.trim()));
  }
  $("#email").addEventListener("input", refreshLoginBtn);
  $("#code").addEventListener("input", refreshLoginBtn);

  /* 获取验证码：60s 倒计时防连点 */
  let cd = 0, cdTimer;
  function startCd() {
    cd = 60;
    $("#btnSend").disabled = true;
    cdTimer = setInterval(() => {
      cd--;
      $("#btnSend").textContent = cd > 0 ? `${cd}s 后重发` : "获取验证码";
      if (cd <= 0) { clearInterval(cdTimer); $("#btnSend").disabled = false; }
    }, 1000);
  }

  $("#btnSend").addEventListener("click", async () => {
    if (cd > 0) return;
    if (!agreeOk()) return;
    const email = $("#email").value.trim();
    if (!isEmail(email)) { toast("请先输入正确的邮箱地址"); return; }
    try {
      const data = await api("/api/auth/send-code", { email });
      startCd();
      if (data.devCode) {
        /* 邮件服务未接入：验证码直发，自动填入方便演示 */
        $("#code").value = data.devCode;
        refreshLoginBtn();
        savedToast(`演示验证码 ${data.devCode} 已自动填入`);
      } else {
        savedToast("验证码已发送到邮箱");
      }
    } catch (e) {
      if (e.offline && AppAPI.demo) {
        demoMode = true;
        startCd();
        toast("后端未启动，演示模式：任意 6 位验证码可登录");
      } else {
        toast(e.message);
      }
    }
  });

  /* 登录（未注册自动创建账号） */
  $("#btnLogin").addEventListener("click", async () => {
    if (!agreeOk()) return;
    const email = $("#email").value.trim().toLowerCase();
    const code = $("#code").value.trim();
    const btn = $("#btnLogin");
    btn.disabled = true; btn.textContent = "登录中…";
    try {
      let token = "";
      if (!demoMode) {
        const data = await api("/api/auth/login", { email, code });
        token = data.token;
      }
      /* 登录态写进账号资料：账号页展示邮箱，重置演示数据时一并登出 */
      await LocalState.activate(email, token);
      /* 拉回该账号云端的轻量资料（换设备/清缓存后找回档案/收藏/衣橱选择） */
      await pullLightState();
      savedToast("登录成功");
      setTimeout(() => {
        AppNav.go(Store.get().onboarded ? "home.html" : "onboarding.html");
      }, 500);
    } catch (e) {
      btn.textContent = "登录";
      refreshLoginBtn();
      toast(e.offline ? "网络异常，请稍后再试" : e.message);
    }
  });
