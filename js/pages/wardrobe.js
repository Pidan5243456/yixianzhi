  renderStatusbar();
  renderTabbar("wardrobe");

  let cat = "全部", query = "", source = "all", order = "default";
  let localScan = false;
  let pendingPurchase=null;
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
    $("#previewName").textContent = (item.name || "我的单品") + (isPresetItem(item.id) ? " · 预设" : item.ownership==="wishlist"?" · 想买":"");
    $("#previewCategory").textContent = [item.cat, item.scene].filter(Boolean).join(" · ");
    $("#editGarment").hidden=!item.dataUrl;$("#purchaseGarment").hidden=item.ownership!=="wishlist";$("#cutoutGarment").hidden=!item.dataUrl;
    $('#cutoutGarment').disabled=true;$('#cutoutGarment').textContent='去背景暂不可用';
    AI.capabilities().then(c=>{if(previewId!==item.id||!preview.open)return;$('#cutoutGarment').disabled=!c.CUTOUT?.available;$('#cutoutGarment').textContent=c.CUTOUT?.available?'去背景':'去背景暂不可用';$('#cutoutGarment').title=c.CUTOUT?.reason||'';});
    preview.showModal();
  }
  $('#cutoutGarment').onclick=async()=>{const it=Store.get().customItems.find(i=>i.id===previewId);if(!it)return;const snapshot=structuredClone(it);$('#cutoutGarment').disabled=true;try{const r=await AI.cutout(snapshot);toast(r.applied?'背景已去除，原图仍保留':r.reason||'结果已保存，衣物已改变');preview.close();renderItems();}catch(e){if(!e.handled)toast(e.message);}finally{if(preview.open)$('#cutoutGarment').disabled=false;}};
  $('#editGarment').onclick=()=>{const id=previewId;preview.close();AppNav.go('add-clothes.html?id='+encodeURIComponent(id));};
  $('#purchaseGarment').onclick=async()=>{const id=previewId,key=LocalState.key,epoch=LocalState.epoch,guard=AI.guard(),s=Store.get(),it=s.customItems.find(i=>i.id===id),retry=pendingPurchase?.id===id&&pendingPurchase.key===key&&pendingPurchase.epoch===epoch;if(!it||(it.ownership!=='wishlist'&&!retry))return;const button=$('#purchaseGarment');button.disabled=true;try{guard();if(it.ownership==='wishlist'){if(Store.set({customItems:s.customItems.map(i=>i.id===id?{...i,ownership:'owned',updatedAt:Date.now()}:i)})===false)throw Error('资料正在切换，请稍后重试');pendingPurchase={id,key,epoch};}else await LocalState.persist();await LocalState.flush();guard();pendingPurchase=null;button.textContent='已购买，移入衣橱';preview.close();renderItems();toast('已移入衣橱');}catch(e){button.textContent='重试保存';toast('购买状态尚未写入本机，请重试保存');}finally{button.disabled=false;}};
  $(".preview-close").addEventListener("click", () => preview.close());
  preview.addEventListener("close", () => { restoreItemFocus(previewId, "data-view"); previewId = null; });
  $("#previewMatch").addEventListener("click", () => {
    const id = previewId;
    if (id && selectableItems().some(i => i.id === id)) {
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
    const mine = new Set(wardrobeItems().map(i => i.id));
    const needle = query.trim().toLocaleLowerCase();
    return selectableItems().filter(it => {
      if (source === "mine" && !mine.has(it.id)) return false;
      if (source === "built-in" && !isPresetItem(it.id)) return false;
      if (source === "wishlist" && it.ownership!=="wishlist") return false;
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
    const empty = (source === "mine" ? wardrobeItems() : selectableItems()).length === 0
      ? '<div class="closet-empty">' + uiIcon('hanger') + '<h3>衣橱还没有衣服</h3><p>拍照或从相册上传衣服照片。</p><a href="add-clothes.html">' + uiIcon('plus') + ' 添加第一件衣物</a></div>'
      : '<div class="closet-empty">' + uiIcon('hanger') + '<h3>没有找到衣物</h3><p>换个关键词，或清除筛选。</p><button type="button" id="resetFilters">清除搜索与筛选</button></div>';
    $("#itemGrid").innerHTML = localCard + progress + list.map(it => {
      const id = escapeHTML(it.id), name = escapeHTML(it.name || '我的单品');
      return '<article class="icard" data-item="' + id + '"' + (it.dataUrl ? ' data-photo' : '') + '>' +
        '<button type="button" class="del" data-del="' + id + '" aria-label="' + (isPresetItem(it.id) ? '隐藏预设' : '删除') + name + '">' + uiIcon('trash') + '</button>' + (isPresetItem(it.id) ? '<span class="preset-badge">预设</span>' : it.ownership==='wishlist'?'<span class="preset-badge">想买</span>':'') +
        '<button type="button" class="imgwrap" data-view="' + id + '" aria-label="预览' + name + '">' + itemImg(it) + '</button>' +
        '<div class="garment-info"><h3 class="garment-name">' + name + '</h3><button type="button" class="match-pill" data-go="' + id + '"><span>去搭配</span>' + uiIcon('arrow-up-right') + '</button></div></article>';
    }).join('') + (!list.length && !localScan && !segCards.length ? empty : '');
    $("#resetFilters")?.addEventListener("click", resetFilters);
    $$("[data-go]").forEach(button => button.addEventListener("click", () => AppNav.go('tryon.html?item=' + encodeURIComponent(button.dataset.go))));
    $$("[data-view]").forEach(button => button.addEventListener("click", () => {
      const item = selectableItems().find(i => i.id === button.dataset.view), src = button.querySelector("img")?.src;
      if (item && src) openPreview(item, src);
    }));
    bindSegRetry();
    $$("[data-del]").forEach(button => button.addEventListener("click", () => {
      delTarget = button.dataset.del; deleteFocusId = delTarget;
      $("#btnDelOk").textContent = isPresetItem(delTarget) ? "隐藏" : "删除";
      $("#delMsg").textContent = isPresetItem(delTarget) ? "隐藏这件预设？已保存的搭配会显示衣物缺失。" : ITEMS.some(i => i.id === delTarget)
        ? "删除后，含这件衣服的搭配也将同步隐藏。"
        : "移除衣物后，已保存的搭配会标记缺失，试穿记录仍保留。";
      deleteDialog.showModal();
    }));
    if (preview.open && !selectableItems().some(i => i.id === previewId)) preview.close();
  }

  $("#btnDelOk").addEventListener("click", () => {
    const id = delTarget;
    if (!id || !selectableItems().some(i => i.id === id)) {deleteDialog.close(); return;}
    const s = Store.get(), wasPreset=isPresetItem(id), isSystem = ITEMS.some(i => i.id === id);
    Store.set({wardrobe:s.wardrobe.filter(value => value !== id),customItems:s.customItems.filter(i => i.id !== id),deletedItems:isSystem ? [...new Set([...s.deletedItems,id])] : s.deletedItems});
    delTarget = null;
    deleteDialog.close(); renderCats(); renderItems();
    savedToast(wasPreset ? "已隐藏预设" : isSystem ? "已删除，相关搭配已同步移除" : "已删除");
  });

  $("#sourceFilter").value="all";renderCats(); renderItems();

  // Earlier split tasks remain readable; new uploads never start them.
  /* 后台任务状态推进/完成入橱后：本页在则实时刷新 */
  window.addEventListener("segments-updated", () => { renderCats(); renderItems(); });

  // Older interrupted uploads remain drafts and never start a billable job on page entry.
  if(Store.get().pendingUpload){const link=document.createElement('a');link.className='btn btn-ghost';link.href='add-clothes.html';link.textContent='继续编辑未保存的照片';$('.closet-intro').append(link);}

window.addEventListener('data-synced',()=>renderItems());
