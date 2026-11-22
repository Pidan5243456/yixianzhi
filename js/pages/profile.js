
  renderStatusbar();
  renderTabbar("me");

  const p = Store.get().profile;
  $("#usub").textContent = [p.gender, p.job].filter(Boolean).join(" · ") || "";

  /* 昵称/头像来自设置页的账号资料，没设置过用默认 */
  const acc = Store.get().account || {};
  const nick = acc.nick || "我的账号";
  $("#uname").textContent = nick;
  $("#avatar").innerHTML = acc.avatar ? `<img src="${MediaCache.src(acc.avatar)}" alt="">` : nick[0];

  $$(".seg button").forEach(b => b.addEventListener("click", () => {
    $$(".seg button").forEach(x => x.classList.remove("on"));
    b.classList.add("on");
    $("#tabFav").classList.toggle("hidden", b.dataset.tab !== "fav");
    $("#tabModel").classList.toggle("hidden", b.dataset.tab !== "model");
  }));

  /* 我的收藏：与首页卡片一致，收藏为已选中态 */
  function renderFavs() {
    const list=allOutfits().filter(o=>Store.get().favorites.includes(o.id));
    if(list.length) renderOutfitCards($('#favGrid'),list);
    else $('#favGrid').innerHTML='<div class="empty"><h3>还没有收藏搭配</h3><a href="home.html" class="btn btn-primary">查看穿搭</a></div>';
  }

  /* 我的模特 */
  function renderModels() {
    const s = Store.get();
    const cur = s.models.find(m => m.id === s.curModel) || s.models[0];
    const mine = s.models.filter(m => m.dataUrl);

    /* 没上传过自己的照片：大卡片 = 引导上传的添加框 */
    if (!mine.length) {
      $("#modelCard").innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;
                    width:100%;height:100%;cursor:pointer;border:2px dashed #cfcfcc;border-radius:var(--r-xl)"
             onclick="AppNav.go('create-model.html')">
          <span style="width:56px;height:56px;border-radius:50%;background:var(--ink);color:#fff;
                       display:flex;align-items:center;justify-content:center;font-size:26px;margin-bottom:14px">＋</span>
          <span style="font-size:16px;font-weight:700">添加试衣照片</span>
          <span style="font-size:13px;color:var(--muted)"></span>
        </div>`;
      $("#modelName").textContent = "";
      $("#modelStrip").innerHTML = "";
      return;
    }

    $("#modelCard").innerHTML = `
      ${cur.dataUrl
        ? `<img src="${MediaCache.src(cur.dataUrl)}">`
        : `<img src="${MediaCache.src(defaultModelSrc())}" onerror="this.onerror=null;this.src='assets/ph/model.svg'" style="opacity:.95">`}
      ${cur.dataUrl ? `<button class="del" id="btnDelModel" aria-label="删除照片">${uiIcon("trash")}</button>` : ""}`;
    $("#modelName").textContent = cur.name;
    $("#modelStrip").innerHTML = `
      <div class="mthumb add" onclick="AppNav.go('create-model.html')">＋<span style="font-size:11px">添加</span></div>
      ${s.models.map(m => `
        <div class="mthumb ${m.id === cur.id ? "on" : ""}" data-m="${m.id}" title="${escapeHTML(m.name)}">
          ${m.dataUrl
            ? `<img src="${MediaCache.src(m.dataUrl)}">`
            : `<img src="${MediaCache.src(defaultModelSrc())}" onerror="this.onerror=null;this.src='assets/ph/model.svg'" style="object-fit:cover">`}
        </div>`).join("")}`;
    $$("[data-m]").forEach(t => t.addEventListener("click", () => {
      Store.set({ curModel: t.dataset.m });
      renderModels();
    }));
    $("#btnDelModel")?.addEventListener("click", () => {
      const left = s.models.filter(m => m.id !== cur.id);
      Store.set({ models: left, curModel: left[0].id });
      savedToast("已删除这张照片");
      renderModels();
    });
  }

  renderFavs(); renderModels();

window.addEventListener('data-synced',()=>renderFavs());
