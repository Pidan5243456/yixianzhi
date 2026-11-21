  renderStatusbar();
  renderTabbar("wardrobe");

  let cat = "全部", query = "", source = "mine", order = "default";
  let localScan = false;
  let previewId = null, delTarget = null, deleteFocusId = null;
  const preview = $("#previewMask"), deleteDialog = $("#modalDel");

  function restoreItemFocus(id, attribute) {
    const button = $$('[' + attribute + ']').find(el => el.getAttribute(attribute) === id);
    (button || $("#closetSearch")).focus({preventScroll:true});
  }
  function openPreview(item, src) {
    previewId = item.id;
    $("#previewImg").src = src;
    $("#previewImg").alt = item.name || "衣物预览";
    $("#previewName").textContent = item.name || "我的单品";
    $("#previewCategory").textContent = [item.cat, item.scene].filter(Boolean).join(" · ");
    $("#editGarment").hidden=!item.dataUrl;$("#splitGarment").hidden=!item.dataUrl;
    preview.showModal();
  }
  $('#editGarment').onclick=()=>{const id=previewId;preview.close();AppNav.go('add-clothes.html?id='+encodeURIComponent(id));};
  $('#splitGarment').onclick=()=>{const it=itemById(previewId);if(!it?.dataUrl)return;if(!confirm('AI 拆图会消耗一次整理额度，生成新单品并保留原照片。继续？'))return;preview.close();startSplitJob(it.dataUrl,crypto.randomUUID());};
  $(".preview-close").addEventListener("click", () => preview.close());
  preview.addEventListener("close", () => { restoreItemFocus(previewId, "data-view"); previewId = null; });
  $("#previewMatch").addEventListener("click", () => {
    const id = previewId;
    if (id && wardrobeItems().some(i => i.id === id)) {
      // Leave the top layer before persistence can present a retry/export prompt.
      preview.close();
      AppNav.go('tryon.html?item=' + encodeURIComponent(id));
    }
  });
  for (const dialog of [preview, deleteDialog]) {
    dialog.addEventListener("click", event => {
      if (event.target !== dialog) return;
      const r = dialog.getBoundingClientRect();
      if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();
    });
  }
  deleteDialog.addEventListener("close", () => { restoreItemFocus(deleteFocusId, "data-del"); delTarget = null; });

  function searchableItems() {
    const mine = new Set(Store.get().customItems.map(i => i.id));
    const needle = query.trim().toLocaleLowerCase();
    return wardrobeItems().filter(it => {
      if (source === "mine" && !mine.has(it.id)) return false;
      if (source === "built-in" && mine.has(it.id)) return false;
      const text = [it.name, it.cat, it.scene, ...Object.values(it.labels || {})].join(" ").toLocaleLowerCase();
      return !needle || text.includes(needle);
    });
  }
  function resetFilters() {
    cat = "全部"; query = ""; source = "all";
    $("#closetSearch").value = ""; $("#sourceFilter").value = "all";
    $("#clearSearch").hidden = true;
    renderCats(); renderItems(); $("#closetSearch").focus();
  }
  $("#closetSearch").addEventListener("input", event => {
    query = event.target.value; $("#clearSearch").hidden = !query;
    renderCats(); renderItems();
  });
  $("#clearSearch").addEventListener("click", () => {
    query = ""; $("#closetSearch").value = ""; $("#clearSearch").hidden = true;
    renderCats(); renderItems(); $("#closetSearch").focus();
  });
  $("#sourceFilter").addEventListener("change", event => {source = event.target.value; renderCats(); renderItems();});
  $("#sortOrder").addEventListener("change", event => {order = event.target.value; renderItems();});

  function renderCats() {
    const focused = document.activeElement?.dataset.c;
    $("#catbar").innerHTML = CATS.map(c => {
      return '<button type="button" class="catdot ' + (c === cat ? 'on' : '') + '" data-c="' + escapeHTML(c) + '" aria-pressed="' + (c === cat) + '">' + c + '</button>';
    }).join("");
    $$(".catdot").forEach(button => button.addEventListener("click", () => {
      cat = button.dataset.c; renderCats(); renderItems();
    }));
    if (focused) $$(".catdot").find(b => b.dataset.c === focused)?.focus({preventScroll:true});
  }

  function renderItems() {
    const list = searchableItems().filter(i => cat === "全部" || i.cat === cat);
    if (order === "name") list.sort((a,b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN'));
    if (order === "category") list.sort((a,b) => CATS.indexOf(a.cat) - CATS.indexOf(b.cat));
    $("#collectionTitle").firstChild.textContent = (cat === "全部" ? "全部单品" : cat) + " ";
    $("#resultCount").textContent = list.length + " 件";
    const localCard = localScan ? '<div class="icard scan"><div class="scan-ring"></div><span class="ai-pill">AI 识别整理中…</span></div>' : '';
    // Jobs remain visible even when filters match no garments.
    const segCards = segCardList();
    const progress = segCards.map(c => '<div class="icard scan">' + segCardInner(c) + '</div>').join('');
    const empty = wardrobeItems().length === 0
      ? '<div class="closet-empty">' + uiIcon('hanger') + '<h3>衣橱还没有衣服</h3><p>拍照或从相册上传衣服照片。</p><a href="add-clothes.html">' + uiIcon('plus') + ' 添加第一件衣物</a></div>'
      : '<div class="closet-empty">' + uiIcon('hanger') + '<h3>没有找到衣物</h3><p>换个关键词，或清除筛选。</p><button type="button" id="resetFilters">清除搜索与筛选</button></div>';
    $("#itemGrid").innerHTML = localCard + progress + list.map(it => {
      const id = escapeHTML(it.id), name = escapeHTML(it.name || '我的单品');
      return '<article class="icard" data-item="' + id + '"' + (it.dataUrl ? ' data-photo' : '') + '>' +
        '<button type="button" class="del" data-del="' + id + '" aria-label="删除' + name + '">' + uiIcon('trash') + '</button>' +
        '<button type="button" class="imgwrap" data-view="' + id + '" aria-label="预览' + name + '">' + itemImg(it) + '</button>' +
        '<div class="garment-info"><h3 class="garment-name">' + name + '</h3><button type="button" class="match-pill" data-go="' + id + '"><span>去搭配</span>' + uiIcon('arrow-up-right') + '</button></div></article>';
    }).join('') + (!list.length && !localScan && !segCards.length ? empty : '');
    $("#resetFilters")?.addEventListener("click", resetFilters);
    $$("[data-go]").forEach(button => button.addEventListener("click", () => AppNav.go('tryon.html?item=' + encodeURIComponent(button.dataset.go))));
    $$("[data-view]").forEach(button => button.addEventListener("click", () => {
      const item = wardrobeItems().find(i => i.id === button.dataset.view), src = button.querySelector("img")?.src;
      if (item && src) openPreview(item, src);
    }));
    bindSegRetry();
    $$("[data-del]").forEach(button => button.addEventListener("click", () => {
      delTarget = button.dataset.del; deleteFocusId = delTarget;
      $("#delMsg").textContent = ITEMS.some(i => i.id === delTarget)
        ? "删除后，含这件衣服的搭配也将同步隐藏。"
        : "移除衣物后，已保存的搭配会标记缺失，试穿记录仍保留。";
      deleteDialog.showModal();
    }));
    if (preview.open && !wardrobeItems().some(i => i.id === previewId)) preview.close();
  }

  $("#btnDelOk").addEventListener("click", () => {
    const id = delTarget;
    if (!id || !wardrobeItems().some(i => i.id === id)) {deleteDialog.close(); return;}
    const s = Store.get(), isSystem = ITEMS.some(i => i.id === id);
    Store.set({wardrobe:s.wardrobe.filter(value => value !== id),customItems:s.customItems.filter(i => i.id !== id),deletedItems:isSystem ? [...new Set([...s.deletedItems,id])] : s.deletedItems});
    delTarget = null;
    deleteDialog.close(); renderCats(); renderItems();
    savedToast(isSystem ? "已删除，相关搭配已同步移除" : "已删除");
  });

  $("#sourceFilter").value="mine";renderCats(); renderItems();

  /* ---------- 拆图上传（后台任务 + 逐件进度卡） ----------
     提交即返回 jobId（识别与逐件生成都在服务器跑，用户可离开本页）；
     进度卡由 app.js 全局轮询的快照驱动，哪件先生成好哪件先入橱点亮，
     失败卡可单件重试。离线时走本地模拟即时入橱。 */
  async function startSplitJob(photo, requestId) {
    Track.send("split_submit", { from: "wardrobe" });
    try {
      const r = await AI.segmentStart(photo, requestId);
      if (r.jobId) {
        Store.set({ pendingUpload: null, pendingSegments: [...(Store.get().pendingSegments || []), { jobId: r.jobId, ts: Date.now(), landed: [] }] });
        renderItems();
        savedToast("上传成功，AI 正在整理，可离开本页");
        pollSegmentJobs();   /* 立即拉一次，尽快出识别结果的进度卡 */
      } else if (r.local) {
        /* 离线回退：本地模拟即时入橱 */
        localScan = true;
        renderItems();
        await new Promise(rr => setTimeout(rr, 1200));
        const items = await buildSegmentItems(r.local);
        const saved = Store.set({ pendingUpload:null, customItems: [...items, ...Store.get().customItems] });
        localScan = false;
        renderCats(); renderItems();
        if (saved !== false) savedToast(items.length > 1 ? `AI 拆分出 ${items.length} 件，已入橱` : "已添加到衣橱");
      }
    } catch (e) {
      console.warn("发起拆分失败", e);
      localScan = false;
      renderItems();
      /* 401/429 已由 ai.js 统一提示过（e.handled），别再用通用文案覆盖 */
      if (!e || !e.handled) toast("上传失败，请重新试一次");
    }
  }

  /* 后台任务状态推进/完成入橱后：本页在则实时刷新 */
  window.addEventListener("segments-updated", () => { renderCats(); renderItems(); });

  // Older interrupted uploads remain drafts and never start a billable job on page entry.
  if(Store.get().pendingUpload){const link=document.createElement('a');link.className='btn btn-ghost';link.href='add-clothes.html';link.textContent='继续编辑未保存的照片';$('.closet-intro').append(link);}
