
  renderStatusbar();

  const qs = new URLSearchParams(location.search);
  let wearing = [];           // 当前上身的单品 id
  let curOutfitId = null;
  let aiAround = null;
  let genImage = null;        // 真模型返回的整图结果（占位实现下为 null）
  let generating = false;     // 是否正在生成（生成中显示加载态，不显示临时叠图）
  let offlineOverlay = true; // 无密钥/后端不在线的演示模式：兜底允许平铺叠图（双击HTML也能用）；
                              // 线上真生成失败不叠图——保持台上原样并 toast 重试

  /* 初始状态：?outfit= / ?items= / ?item= */
  if (qs.get("outfit")) {
    const o = outfitById(qs.get("outfit"));
    if (o) { wearing = o.items.filter(id=>itemById(id)); curOutfitId = o.id; }
  } else if (qs.get("items")) {
    wearing = qs.get("items").split(",").filter(id => itemById(id));
  } else if (qs.get("item")) {
    wearing = itemById(qs.get("item")) ? [qs.get("item")] : [];
    aiAround = qs.get("item");
  } else {
    wearing = (Store.get().outfitDraft?.items || []).filter(id=>itemById(id));
    curOutfitId = Store.get().outfitDraft?.outfitId || null;
  }

  /* ---------- 模特与上身合成 ---------- */
  function curModel() {
    const s = Store.get();
    return s.models.find(x => x.id === s.curModel) || s.models[0];
  }
  function itemSrc(it) {
    return it.dataUrl || `assets/real/${it.id}.png`;
  }

  /* 舞台底色自动取当前展示图片的边缘颜色，让照片与背景无缝衔接（占满上半屏） */
  let stageCols = null;
  function syncStageBg(src) {
    const im = new Image();
    im.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = im.width; c.height = im.height;
        const x = c.getContext("2d");
        x.drawImage(im, 0, 0);
        const col = (X, Y) => { const d = x.getImageData(X, Y, 1, 1).data; return `rgb(${d[0]},${d[1]},${d[2]})`; };
        stageCols = [col(3, 3), col(3, im.height - 4)];
        $(".stage").style.background = `linear-gradient(180deg, ${stageCols[0]} 0%, ${stageCols[1]} 100%)`;
        /* 页面外围与手机状态栏也跟着照片同色，整页无缝 */
        $(".app").style.background = stageCols[0];
        document.body.style.background = stageCols[0];
        const tm = document.querySelector('meta[name="theme-color"]');
        if (tm) tm.content = stageCols[0];
      } catch {}
    };
    MediaCache.url(src).then(url=>im.src=url).catch(()=>{});
  }

  /* 舞台渲染：有 AI 生成图用生成图，否则模特图 + 衣服按分类叠放 */
  /* 加载态开关：显示/隐藏"生成中"整页遮罩。
     进度条为模拟值（生图无真实进度）：先快后慢逼近 96%，完成瞬间跳满停一拍再收 */
  function setLoading(on) {
    $('#genLoading').classList.toggle('show',on);
    $('#btnGenerate').disabled=on;
    $('#btnGenerate').textContent=on?'生成中…':'生成试穿';
    $('#previewKind').textContent=genImage?'AI 试穿效果':'搭配预览';
  }

  function renderStage() {
    const m = curModel();
    const wrap = $("#modelWrap");
    if (generating) {
      /* 生成等待中：整页遮罩盖住模特与抽屉；台上保留旧生成图（没有则模特底图），失败时旧图不丢 */
      if (genImage) {
        wrap.innerHTML = `<img class="gen" src="${MediaCache.src(genImage)}" alt="试穿效果">`;
        syncStageBg(genImage);
      } else {
        const modelSrc = m.dataUrl || defaultModelSrc();
        syncStageBg(modelSrc);
        wrap.innerHTML = `<img class="base" id="modelImg" src="${MediaCache.src(modelSrc)}"
            onerror="this.onerror=null;this.src='assets/ph/model.svg'"
            style="${m.dataUrl ? "border-radius:18px" : ""}" alt="试衣模特">`;
      }
      setLoading(true);
      return;
    }
    if (genImage) {
      /* 生图模型已把鞋子一起生成，直接展示整图，不再前端叠鞋 */
      wrap.innerHTML = `<img class="gen" src="${MediaCache.src(genImage)}" alt="试穿效果">`;
      syncStageBg(genImage);
      setLoading(false);
      return;
    }
    const modelSrc = m.dataUrl || defaultModelSrc();
    syncStageBg(modelSrc);
    setLoading(false);
    const base = `<img class="base" id="modelImg"
        src="${MediaCache.src(m.dataUrl || defaultModelSrc())}"
        onerror="this.onerror=null;this.src='assets/ph/model.svg'"
        style="${m.dataUrl ? "border-radius:18px" : ""}" alt="试衣模特">`;
    /* 线上真生成失败走不到叠图：doTryon 保留旧生成图并 toast，这里只剩"什么都没穿"的纯模特 */
    if (!offlineOverlay) { wrap.innerHTML = base; return; }
    /* 无密钥/后端不在线的演示模式：平铺叠图保底，双击 HTML 也能用 */
    wrap.innerHTML = base +
      wearing.map(id => {
        const it = itemById(id);
        if (!it) return "";
        return `<img class="worn cat-${it.cat} ${/^data:image\/jpeg;/.test(it.dataUrl || '') ? 'photo-layer' : ''}" src="${MediaCache.src(itemSrc(it))}"
          onerror="phFallback(this,'${safePh(it.ph)}')" alt="${escapeHTML(it.name)}">`;
      }).join("");
  }

  /* ---------- 真实试穿：仅用户主动生成 ----------
     系统衣服/默认模特是图片文件，先转成 dataURL 再发给模型；
     衣服平铺图铺白底转 JPEG（透明 PNG 直接转会发黑）。转换结果缓存。 */
  const srcCache = new Map();
  function srcToDataUrl(src, maxW = 1000) {
    if (!src) return Promise.resolve(null);
    if (src.startsWith("media:")) return MediaCache.data(src);
    if (src.startsWith("data:")) return Promise.resolve(src);
    if (srcCache.has(src)) return srcCache.get(src);
    const p = new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxW / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = () => resolve(null);
      img.src = src;
    });
    srcCache.set(src, p);
    return p;
  }
  async function itemDataUrl(it) {
    if (it.dataUrl) return it.dataUrl;
    return (await srcToDataUrl(`assets/real/${it.id}.png`))
        || (await srcToDataUrl(`assets/real/${it.id}.jpg`));
  }

  let tryonSeq=0;
  const genCache=new Map();
  function applyTryon() {
    tryonSeq++;
    generating=false;genImage=null;offlineOverlay=true;
    Store.set({outfitDraft:{items:[...wearing],outfitId:curOutfitId}});
    renderStage();
  }
  async function doTryon() {
    if(generating)return;
    if(!wearing.length){toast('请先选择衣物');return;}
    const seq=++tryonSeq,epoch=LocalState.epoch,partition=LocalState.key;
    const snapshot={items:structuredClone(wearing.map(itemById).filter(Boolean)),model:structuredClone(curModel()),outfitId:curOutfitId,time:Date.now(),base:defaultModelSrc()};
    const key=JSON.stringify([snapshot.model,snapshot.base,snapshot.items]);
    const current=()=>epoch===LocalState.epoch&&partition===LocalState.key&&!LocalState.locked;
    generating=true;renderStage();
    try {
      let image=null,mock=false,serverRecord=null;
      if(!image){
        const modelImage=snapshot.model.dataUrl||await srcToDataUrl(snapshot.base,1200);
        const items=await Promise.all(snapshot.items.map(async it=>({id:it.id,category:it.cat,image:await itemDataUrl(it)})));
        if(!current()||seq!==tryonSeq)return;
        const r=await AI.tryon(modelImage,items,{modelId:snapshot.model.id,outfitId:snapshot.outfitId||'',scene:outfitById(snapshot.outfitId)?.scene||'日常'});image=r.image;mock=!!r.mock;if(r.record)serverRecord=r.record;
        if(!image&&!mock)throw Error('未生成图片，请重试');
        if(image)genCache.set(key,image);
      }
      if(!current())return;
      await LocalState.prepare(async()=>{
        if(mock&&AppAPI.demo)image=await composeSnapshot(snapshot.model.dataUrl||snapshot.base,null,snapshot.items);
        if(!current())return;
        if(AppAPI.demo){const id='h_'+crypto.randomUUID();Store.set({history:[{id,outfitId:snapshot.outfitId,modelId:snapshot.model.id,items:snapshot.items.map(i=>i.id),time:snapshot.time,scene:'日常',image,kind:'collage'},...Store.get().history].slice(0,1000)});await LocalState.flush();}
        // Remote records arrive through sync; a deleted result must never be reinserted here.
      });
      if(!current())return;
      if(seq===tryonSeq){genImage=mock?null:image;offlineOverlay=mock;toast(mock?'演示拼贴已保存':'试穿效果已保存');}
    }catch(e){if(current()&&!e.handled)toast(e.message||'生成失败，请重试');}
    finally{if(current()&&seq===tryonSeq){generating=false;renderStage();}}
  }
  $('#btnGenerate').onclick=doTryon;
  $('#btnSaveOutfit').onclick=async()=>{const o=await saveOutfitDialog(wearing,curOutfitId);if(o){curOutfitId=o.id;syncFav();renderOutfitGrid();}};

  /* 本地合成快照：模特图 + 衣服叠放 画到 canvas */
  const CAT_POS = {
    "上衣":   { top: .16, h: .30, maxW: .72 },
    "连体裙": { top: .16, h: .52, maxW: .66 },
    "下装":   { top: .43, h: .38, maxW: .60 },
    "鞋子":   { top: .87, h: .13, maxW: .48 },
  };
  function loadImg(src) {
    return new Promise((ok, no) => {
      const im = new Image();
      im.onload = () => ok(im);
      im.onerror = no;
      MediaCache.url(src).then(url=>im.src=url).catch(no);
    });
  }
  /* baseSrc=底图（默认当前模特），cats=只画这些分类的衣服（默认全画） */
  async function composeSnapshot(baseSrc = null, cats = null, pieces = wearing.map(itemById).filter(Boolean)) {
    const W = 480, H = 720;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, stageCols ? stageCols[0] : "#f2f2ef");
    g.addColorStop(1, stageCols ? stageCols[1] : "#e6e6e2");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    const m = curModel();
    let base;
    try { base = await loadImg(baseSrc || m.dataUrl || defaultModelSrc()); }
    catch { base = await loadImg("assets/ph/model.svg"); }
    const bw = base.width || 240, bh = base.height || 480;
    const scale = Math.min((W * .94) / bw, (H * .96) / bh);
    const dw = bw * scale, dh = bh * scale;
    const bx=(W-dw)/2,by=H-dh;
    ctx.drawImage(base, bx, by, dw, dh);

    for (const it of pieces) {
      if (cats && !(it && cats.includes(it.cat))) continue;
      const pos = it && CAT_POS[it.cat];
      if (!pos) continue;
      let im;
      try { im = await loadImg(itemSrc(it)); }
      catch { try { im = await loadImg(`assets/ph/${safePh(it.ph)}.svg`); } catch { continue; } }
      const iw = im.width || 200, ih = im.height || 200;
      // Match the stage: all garment coordinates are relative to the model,
      // not the surrounding canvas (which can have substantial letterboxing).
      const s2 = Math.min((dh * pos.h) / ih, (dw * pos.maxW) / iw);
      const w2 = iw * s2, h2 = ih * s2;
      ctx.globalCompositeOperation=/^data:image\/jpeg;/.test(it.dataUrl||'')?'multiply':'source-over';
      ctx.drawImage(im, bx+(dw-w2)/2, by+dh*pos.top+(dh*pos.h-h2)/2, w2, h2);
      ctx.globalCompositeOperation='source-over';
    }
    return canvas.toDataURL("image/jpeg", 0.62);
  }

  /* ---------- 模特角标 ---------- */
  function renderModelBadge() {
    const m = curModel();
    $("#modelSwitch").innerHTML = `<span class="model-crop"><img src="${MediaCache.src(m.dataUrl || defaultModelSrc())}" alt="切换试衣模特"></span>`;
  }
  $("#modelSwitch").addEventListener("click", () => AppNav.go("create-model.html"));

  /* ---------- 穿搭 tab（场景筛选；被删衣服的搭配不再展示） ---------- */
  let dScene = "全部";
  function renderSceneChipsD() {
    const scenes = ["全部", "通勤", "约会", "旅行", "日常"];
    $("#sceneChipsD").innerHTML = scenes.map(c =>
      `<button class="dchip ${c === dScene ? "on" : ""}" data-c="${c}">${c}</button>`).join("");
    $$("#sceneChipsD .dchip").forEach(c => c.addEventListener("click", () => {
      dScene = c.dataset.c; renderSceneChipsD(); renderOutfitGrid();
    }));
  }
  function renderOutfitGrid() {
    $("#outfitGrid").innerHTML =
      `<div class="dcell add" data-add role="button" tabindex="0" aria-label="上传衣服">${uiIcon('plus')}</div>` +
      Store.get().customOutfits.filter(o => dScene === "全部" || o.scene === dScene).map(o => `
        <div class="dcell ${o.id === curOutfitId ? "on" : ""}" data-o="${o.id}">
          <div class="combo">${o.items.slice(0, 4).map(id => itemImg(itemById(id))).join("")}</div>
        </div>`).join("");
    $$("[data-o]").forEach(c => c.addEventListener("click", () => {
      const o = outfitById(c.dataset.o);
      wearing = o.items.filter(id=>itemById(id)); curOutfitId = o.id;   /* 旧生成图交给 doTryon 统一管理，失败时留旧图 */
      renderAll(); applyTryon();
      savedToast(`已试穿「${o.name}」`);
    }));
    bindAdd();
  }

  /* ---------- 我的衣服 tab ---------- */
  let cFilter = "全部";
  function renderCatChips() {
    $("#catChips").innerHTML = CATS.map(c =>
      `<button class="dchip ${c === cFilter ? "on" : ""}" data-c="${c}">${c}</button>`).join("");
    $$("#catChips .dchip").forEach(c => c.addEventListener("click", () => {
      cFilter = c.dataset.c; renderCatChips(); renderMineGrid();
    }));
  }
  function renderMineGrid() {
    const list = selectableItems().filter(i => cFilter === "全部" || i.cat === cFilter);
    /* 后台拆分任务进度卡：跨页面由轮询快照驱动（segCardList/segCardInner 在 app.js，衣橱页同款） */
    const localCard = localScan
      ? `<div class="dcell scan"><div class="split-prog"><span class="spname">AI 识别中…</span><div class="spbar"><i style="width:30%"></i></div></div></div>`
      : "";
    const splitCards = segCardList().map(c => `<div class="dcell scan">${segCardInner(c)}</div>`).join("");
    $("#mineGrid").innerHTML =
      `<div class="dcell add" data-add role="button" tabindex="0" aria-label="上传衣服">${uiIcon('plus')}</div>` + localCard + splitCards +
      list.map(it => `
        <div class="dcell ${wearing.includes(it.id) ? "on" : ""}" data-i="${it.id}">
          ${it.dataUrl ? `<img src="${MediaCache.src(it.dataUrl)}">` : itemImg(it)}${isPresetItem(it.id)?'<span class="preset-badge">预设</span>':''}
        </div>`).join("");
    $$("[data-i]").forEach(c => c.addEventListener("click", () => wearItem(c.dataset.i)));
    bindSegRetry();
    bindAdd();
  }

  /* + 号：打开系统相册选图 → 提交后台拆分任务 → 进度卡逐件点亮入橱（与衣橱页同一套机制） */
  let uploading = false;   /* 提交进行中锁住 + 号，连点不再重复起付费任务 */
  let localScan = false;   /* 离线回退的即时识别态 */

  function bindAdd() {
    $$("[data-add]").forEach(c => c.onclick = () => {
      if (uploading) { toast("正在提交上一张，稍等一下再传"); return; }
      AppNav.go("add-clothes.html");
    });
  }

  /* 后台任务状态推进/完成入橱后：本页在则实时刷新抽屉 */
  window.addEventListener("segments-updated", () => { renderMineGrid(); syncAIBtn(); });

  /* 穿上单品：同分类替换，连体裙与上/下装互斥 */
  function wearItem(id) {
    const it = itemById(id);
    if(!it){renderMineGrid();toast('这件衣物已移除');return;}
    const same = wearing.find(w => itemById(w)?.cat === it.cat);
    const takenOff = same === id;                       /* 点已穿的同一件 = 脱下 */
    if (takenOff) { wearing = wearing.filter(w => w !== id); }
    else if (same) { wearing = wearing.map(w => (w === same ? id : w)); }
    else {
      if (it.cat === "连体裙") wearing = wearing.filter(w => !["上衣", "下装"].includes(itemById(w)?.cat));
      if (["上衣", "下装"].includes(it.cat)) wearing = wearing.filter(w => itemById(w)?.cat !== "连体裙");
      wearing = [...wearing, id];
    }
    aiAround = takenOff ? null : id;
    curOutfitId = null;                                 /* 旧生成图交给 doTryon 统一管理，失败时留旧图 */
    renderAll(); applyTryon();
    savedToast(takenOff ? `已脱下「${it.name}」` : `已换上「${it.name}」`);
  }

  /* ---------- AI 搭配 ---------- */
  function hasUploads() { return selectableItems().length > 0; }
  function syncAIBtn() { $("#btnAI").classList.toggle("off", !hasUploads()); }

  async function aiMatch(around) {
    const btn = $("#btnAI");
    if (btn.disabled) return;            /* 搭配请求进行中，连点不再重复调用付费模型 */
    const seq=tryonSeq,epoch=LocalState.epoch,key=LocalState.key;
    const input=structuredClone(recommendationItems(around));
    btn.disabled = true;
    btn.innerHTML = uiIcon('sparkles') + ' AI 搭配中…';
    Track.send("recommend_click", { around: !!around });
    try {
      const r = await AI.recommend(input, around);
      if(seq!==tryonSeq||epoch!==LocalState.epoch||key!==LocalState.key||LocalState.locked)return;
      if (r.items && r.items.length) {
        wearing = r.items.filter(id=>input.some(i=>i.id===id)&&itemById(id));
        curOutfitId = null;   /* 旧生成图交给 doTryon 统一管理，失败时留旧图 */
        renderAll();
        await applyTryon();
        toast(r.reason
          ? `AI：${r.reason}`
          : (around ? "AI 已围绕这件衣服完成搭配" : "AI 已为你搭配一套新造型"));
      } else {
        toast("衣橱里的衣服不够搭一套，先多上传几件吧");
      }
    } catch(e) {if(!e.handled)toast(e.message||"推荐失败，请重试");
    } finally {
      btn.disabled = false;
      btn.innerHTML = uiIcon('sparkles') + ' AI 推荐';
    }
  }

  $("#btnAI").addEventListener("click", () => {
    if (!hasUploads()) {
      toast("没有可搭配的衣物，请先添加");
      return;
    }
    aiMatch(aiAround && itemById(aiAround) ? aiAround : null);
  });

  /* 从衣橱带单品进来：围绕它自动 AI 搭配（先进加载态，不闪临时叠图） */


  /* ---------- 收藏 ---------- */
  function syncFav() {
    $("#btnFav").style.color = curOutfitId && Store.get().favorites.includes(curOutfitId) ? "#101012" : "#c9c9c6";
  }
  $('#btnFav').onclick=async()=>{
    if(curOutfitId&&outfitById(curOutfitId)){toggleFavorite(curOutfitId);syncFav();}
    else{const o=await saveOutfitDialog(wearing,null,true);if(o){curOutfitId=o.id;syncFav();renderOutfitGrid();}}
  };

  /* ---------- tab 切换 ---------- */
  $$(".dtabs button").forEach(b => b.addEventListener("click", () => {
    $$(".dtabs button").forEach(x => x.classList.remove("on"));
    b.classList.add("on");
    const t = b.dataset.t;
    $("#paneMine").classList.toggle("hidden", t !== "mine");
    $("#paneMine").style.display = t === "mine" ? "flex" : "none";
    $("#paneOutfit").classList.toggle("hidden", t !== "outfit");
    $("#paneOutfit").style.display = t === "outfit" ? "flex" : "none";
  }));

  /* ---------- 抽屉把手拖拽：按住横线上拉看更多衣服，下拉回到默认高度为极限 ---------- */
  const stageEl = $(".stage");
  const grabEl = $(".drawer .grab");
  const stageMax = () => Math.round(window.innerHeight * (window.innerHeight<=700 ? 0.60 : 0.66));  /* 默认高度 = CSS 的 56dvh */
  const stageMin = () => Math.round(window.innerHeight * 0.24);  /* 拉满时模特区收到 24dvh */
  let gDrag = null;
  grabEl.addEventListener("pointerdown", e => {
    gDrag = { y: e.clientY, h: stageEl.getBoundingClientRect().height };
    stageEl.classList.remove("snap");
    grabEl.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  grabEl.addEventListener("pointermove", e => {
    if (!gDrag) return;
    const h = Math.min(stageMax(), Math.max(stageMin(), gDrag.h + (e.clientY - gDrag.y)));
    stageEl.style.height = h + "px";
  });
  const gEnd = () => {
    if (!gDrag) return;
    gDrag = null;
    /* 松手吸附到更近的一端 */
    const h = stageEl.getBoundingClientRect().height;
    const to = (h - stageMin() < stageMax() - h) ? stageMin() : stageMax();
    stageEl.classList.add("snap");
    stageEl.style.height = to + "px";
  };
  grabEl.addEventListener("pointerup", gEnd);
  grabEl.addEventListener("pointercancel", gEnd);

  let displayedModelId=Store.get().curModel;
  function renderAll() {
    displayedModelId=Store.get().curModel;
    renderStage(); renderOutfitGrid(); renderMineGrid(); renderModelBadge(); syncFav(); syncAIBtn();
  }
  window.addEventListener('data-synced',()=>{
    const available=wearing.filter(id=>itemById(id)),changed=available.length!==wearing.length||displayedModelId!==Store.get().curModel;
    wearing=available;if(aiAround&&!itemById(aiAround))aiAround=null;
    if(changed)applyTryon();renderAll();
  });
  renderCatChips(); renderSceneChipsD(); renderAll();
  applyTryon();

  /* Restore the current local partition without starting another AI operation. */
  window.KEEP_BFCACHE = true;
  window.addEventListener("pageshow", async e => {
    if (!e.persisted) return;
    const prev = Store.get().curModel, previousKey=LocalState.key;
    try { if(!await LocalState.load()) return; }
    catch { location.reload(); return; }
    if(previousKey!==LocalState.key) {genImage=null;location.reload();return;}
    if (Store.get().curModel !== prev) genImage = null;
    renderAll();
    applyTryon();
  });
