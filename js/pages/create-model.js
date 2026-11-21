
  renderStatusbar();

  /* tab 切换 */
  $$(".seg button").forEach(b => b.addEventListener("click", () => {
    $$(".seg button").forEach(x => x.classList.remove("on"));
    b.classList.add("on");
    $("#panePreset").classList.toggle("hidden", b.dataset.t !== "preset");
    $("#paneMine").classList.toggle("hidden", b.dataset.t !== "mine");
  }));

  /* 选完模特自动返回的防重入锁：连点只预约一次返回（手机上双击会连退两级、跳过试穿页）；
     直开本页没有上一页可退时，兜底跳试穿页，保证「确认」点了必有下文 */
  let leaving = false;
  function backToTryon(delay) {
    leaving = true;
    setTimeout(() => history.length > 1 ? AppNav.back() : AppNav.go("tryon.html"), delay);
  }

  /* 预设模特（PRESET_MODELS 在 js/data.js，默认全部在模特列表里）
     两条路径统一为"停留确认"（产品负责人定）：点卡片只选中高亮，点「确认」才生效并返回 */
  let pickedPreset = null;
  function renderPresets() {
    const s = Store.get();
    const sel = pickedPreset || s.curModel;
    $("#presetGrid").innerHTML = PRESET_MODELS.map(p => `
      <div class="preset ${sel === p.id ? "on" : ""}" data-p="${p.id}" data-nm="${p.name}">
        <span class="nm">${p.name}</span>
        <img src="${MediaCache.src(defaultModelSrc())}" onerror="this.onerror=null;this.src='assets/ph/model.svg'">
      </div>`).join("");
    $$("[data-p]").forEach(c => c.addEventListener("click", () => {
      pickedPreset = c.dataset.p;
      renderPresets();
    }));
  }
  $("#btnPresetOk").addEventListener("click", () => {
    if (leaving) return;               /* 已在返回途中，忽略连点 */
    const p = PRESET_MODELS.find(x => x.id === (pickedPreset || Store.get().curModel)) || PRESET_MODELS[0];
    Store.set({ curModel: p.id });
    savedToast(`已选用「${p.name}」`);
    $("#btnPresetOk").disabled = true;
    $("#btnPresetOk").textContent = "正在返回…";
    backToTryon(600);
  });

  /* 「我的照片」确认：上锁防连点（按钮变灰），预约返回 */
  function confirmMine(id, btn) {
    if (leaving) return;
    Store.set({ curModel: id });
    savedToast("已设为当前模特");
    btn.disabled = true;
    btn.textContent = "正在返回…";
    backToTryon(600);
  }

  /* 我的照片 */
  let mineShow = null;   /* 刚上传、还没点「确认」生效的候选照片 id（优先展示） */
  function renderMine() {
    const mine = Store.get().models.filter(m => m.dataUrl);
    if (!mine.length) {
      $("#paneMine").innerHTML = `
        <div class="my-empty">
          <div class="figure rise"><img src="assets/ph/create-model-hero.jpg" alt="创建我的模特"></div>
          <h2 class="rise d1">用自己的照片试衣</h2>
          <p class="rise d2">上传清晰的正面半身照或全身照</p>
          <button class="btn btn-primary rise d3" style="padding:14px 34px" onclick="openSheet('sheetTip')">创建我的模特</button>
        </div>`;
    } else {
      const s = Store.get();
      const cur = mine.find(m => m.id === mineShow) || mine.find(m => m.id === s.curModel) || mine[0];
      $("#paneMine").innerHTML = `
        <div class="my-list">
          <div class="big-photo rise">
            <img src="${MediaCache.src(cur.dataUrl)}">
            <button class="del" data-del="${cur.id}" aria-label="删除照片">${uiIcon("trash")}</button>
          </div>
          <button class="add-model rise d1" onclick="openSheet('sheetTip')"><span class="plus">＋</span>添加模特</button>
          <div style="height:14px"></div>
          <button class="btn btn-primary btn-block rise d2" onclick="confirmMine('${cur.id}', this)">确认</button>
        </div>`;
      $("[data-del]")?.addEventListener("click", () => {
        const s2 = Store.get();
        const rest = s2.models.filter(m => m.id !== cur.id);
        if (cur.id === mineShow) mineShow = null;   /* 删的是候选照片，候选作废 */
        Store.set({
          models: rest,
          /* 删的是当前生效模特 → 顺位切到剩余第一张照片、没有照片才回默认模特，
             保证页面显示的照片始终=实际生效模特；删的不是当前模特 → 当前模特不动 */
          curModel: s2.curModel === cur.id ? (rest.find(m => m.dataUrl)?.id || "m1") : s2.curModel,
        });
        renderMine();
        savedToast("已删除该照片");
      });
    }
  }

  /* 上传只做本机处理，用户确认使用。 */
  $("#btnCam").addEventListener("click", () => {
    $("#fileInput").setAttribute("capture", "environment");   // 手机上直接调起相机
    $("#fileInput").click();
  });
  $("#btnAlbum").addEventListener("click", () => {
    $("#fileInput").removeAttribute("capture");
    $("#fileInput").click();
  });
  $("#fileInput").addEventListener("change", e => {
    const f = e.target.files[0];
    if (!f) return;
    closeSheet("sheetTip");
    const epoch=LocalState.epoch,key=LocalState.key;
    LocalState.prepare(async()=>{try{
      const raw=await new Promise((ok,no)=>{const reader=new FileReader();reader.onload=()=>ok(reader.result);reader.onerror=()=>no(reader.error);reader.readAsDataURL(f);});
      const small=await compressImage(raw,900,.8);
      if(epoch!==LocalState.epoch||key!==LocalState.key||LocalState.locked)return;
      const id='u_'+crypto.randomUUID();if(Store.get().models.length>=1000)throw Error('模特照片数量已达上限');
      Store.set({models:[...Store.get().models,{id,name:'我的模特',dataUrl:small}]});await LocalState.flush();mineShow=id;renderMine();toast('照片已保存，点「确认」使用');
    }catch(e){toast(e.message||'照片无法处理');throw e;}}).catch(()=>{});
    e.target.value = "";
  });

  renderPresets(); renderMine();
