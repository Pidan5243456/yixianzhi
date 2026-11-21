
  renderStatusbar();

  /* 带 id 时必须在可用搭配里找到（含已删单品/性别偏好外的视为失效）；
     不带 id（桌面总览页直开）→ 回退第一套可用搭配 */
  const oid = new URLSearchParams(location.search).get("id");
  const avail = allOutfits();
  const o = oid ? avail.find(x => x.id === oid) : avail[0];

  if (!o) {
    /* 失效搭配：提示后回首页，跳过全部渲染逻辑 */
    savedToast("该搭配已不可用");
    setTimeout(() => AppNav.replace("home.html"), 800);
  } else {
    if(Store.get().customOutfits.some(v=>v.id===o.id)){
      const b=document.createElement('button');b.className='btn btn-ghost';b.textContent='删除搭配';b.onclick=async()=>{if(!confirm('删除这套搭配？试穿记录会保留。'))return;Store.set({customOutfits:Store.get().customOutfits.filter(v=>v.id!==o.id),favorites:Store.get().favorites.filter(v=>v!==o.id)});await AppNav.go('home.html');};$('.detail-foot').append(b);
      $('#btnTry').textContent='编辑搭配';
    }
    let items = [...o.items];   // 当前展示的单品（可被替换）

    function render() {
      const its = items.map(itemById).filter(Boolean);
      const changed = items.join(",") !== o.items.join(",");
      const missing=items.length-its.length;$("#missingItems").hidden=!missing;$("#missingItems").textContent=missing ? `有 ${missing} 件衣物已移除，可在编辑搭配中重新选择。` : "";
      if(!its.length){$("#hero").innerHTML="<p>这套搭配的衣物已移除</p>";$("#pieces").innerHTML="";return;}
      $("#hero").innerHTML = `
        <div class="main" data-p="${its[0].id}">${itemImg(its[0])}</div>
        <div class="side">${its.slice(1, 4).map(i =>
          `<span data-p="${i.id}">${itemImg(i)}</span>`).join("")}</div>
        ${changed || missing ? "" : outfitCover(o.id)}`;
      $("#pieces").innerHTML = its.map(i => `
        <div class="piece" data-p="${i.id}">${itemImg(i)}</div>`).join("");
      $$("[data-p]").forEach(el => el.addEventListener("click", () => openSwap(el.dataset.p)));
    }

    /* 点击单品 → 弹替换弹窗（同分类：默认单品 + 用户上传的） */
    let swapFrom = null, swapTo = null, swapOptions = "";
    function openSwap(id) {
      swapFrom = id; swapTo = null;
      const it = itemById(id);
      if(!it){closeSheet('sheetSwap');render();return;}
      $("#swapTitle").childNodes[0].textContent = `替换${it.cat}`;
      const options = selectableItems().filter(x => x.cat === it.cat && x.id !== id);
      swapOptions=options.map(x=>x.id).join("|");
      $("#swapGrid").innerHTML = options.length ? options.map(x => `
        <div class="swap-cell" data-s="${x.id}">${itemImg(x)}</div>`).join("")
        : `<div style="grid-column:1/-1;text-align:center;color:var(--muted);padding:30px 0;font-size:15px;line-height:2">衣橱里没有其他${it.cat}<br>去底部 + 号上传吧</div>`;
      $$("[data-s]").forEach(c => c.addEventListener("click", () => {
        $$(".swap-cell").forEach(x => x.classList.remove("on"));
        c.classList.add("on");
        swapTo = c.dataset.s;
      }));
      openSheet("sheetSwap");
    }
    $("#btnSwapOk").addEventListener("click", () => {
      if (!swapTo || !itemById(swapTo)) { toast("请先选择可用的单品"); return; }
      items = items.map(i => (i === swapFrom ? swapTo : i));
      closeSheet("sheetSwap");
      render();
      savedToast("替换成功");
    });

    /* 收藏 / 试穿 */
    function syncFav() {
      const on = Store.get().favorites.includes(o.id);
      $("#btnFav2").innerHTML = uiIcon("star") + (on ? " 已收藏" : " 收藏");
    }
    $("#btnFav2").addEventListener("click", async () => {
      if(items.join(",")!==o.items.join(",")){await saveOutfitDialog(items,null,true);return;}
      const favs = Store.get().favorites;
      const on = favs.includes(o.id);
      Store.set({ favorites: on ? favs.filter(f => f !== o.id) : [...favs, o.id] });
      if (!on) Track.send("favorite_add", { outfit: o.id });
      syncFav();
      /* 替换过单品后收藏存的仍是原搭配，文案说清楚 */
      const changed = items.join(",") !== o.items.join(",");
      savedToast(on ? "已取消收藏" : (changed ? "已收藏原搭配" : "已加入收藏"));
    });
    $("#btnTry").addEventListener("click", () => {
      const changed = items.join(",") !== o.items.join(",");
      AppNav.go(changed ? `tryon.html?items=${items.join(",")}` : `tryon.html?outfit=${o.id}`);
    });

    window.addEventListener('data-synced',()=>{render();syncFav();if($('#sheetSwap').classList.contains('show')&&swapFrom){const from=itemById(swapFrom);if(!from){closeSheet('sheetSwap');return;}const ids=selectableItems().filter(x=>x.cat===from.cat&&x.id!==swapFrom).map(x=>x.id).join('|');if(ids!==swapOptions){const selected=swapTo;openSwap(swapFrom);const cell=$$('[data-s]').find(c=>c.dataset.s===selected);if(cell){swapTo=selected;cell.classList.add('on');}}}});
    render(); syncFav();
  }
