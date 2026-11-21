
  renderStatusbar();
  renderTabbar("history");

  const TINTS = [
    "linear-gradient(150deg,#f6e3d7,#eed7cf)", "linear-gradient(150deg,#e5ddf0,#d8d0ea)",
    "linear-gradient(150deg,#efe9dc,#e7dfd0)", "linear-gradient(150deg,#f2ded2,#ecd4c6)",
    "linear-gradient(150deg,#dcead9,#cfe3cd)", "linear-gradient(150deg,#eae4da,#e0d9cd)",
  ];
  let editing = false;
  const sel = new Set();
  const tintOf = i => TINTS[i % TINTS.length];

  function list() { return Store.get().history; }

  function renderGrid() {
    const l = list();
    $("#countNote").textContent = `共 ${l.length} 张 · 仅自己可见`;
    $("#grid").innerHTML = l.length ? l.map((h, i) => `
      <div class="hcard" data-id="${h.id}" data-i="${i}">
        ${h.image
          ? `<img src="${h.image}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover" alt="${h.kind==='tryon'?'AI试穿效果':h.kind==='collage'?'演示拼贴':'旧版记录'}">`
          : `<div class="bg" style="background:${tintOf(i)}"></div>
             <div class="fit"><img src="assets/ph/model.svg" alt="试衣照"></div>`}
        <span class="ck"></span>
      </div>`).join("")
      : `<div class="empty" style="grid-column:1/-1"><span class="empty-visual">${uiIcon("photo")}</span><h3>还没有试穿记录</h3>你的试穿记录会保存在这里<br><a href="home.html" class="btn btn-primary">去试穿</a></div>`;

    $$(".hcard").forEach(c => c.addEventListener("click", () => {
      const id = c.dataset.id;
      if (editing) {
        sel.has(id) ? sel.delete(id) : sel.add(id);
        c.classList.toggle("sel", sel.has(id));
        $("#btnDel").textContent = `删除所选（${sel.size}）`;
      } else {
        openViewer(+c.dataset.i);
      }
    }));
  }

  /* ---- 查看器 ---- */
  let vIndex = 0;
  function openViewer(i) {
    vIndex = i;
    renderViewer();
    $("#viewer").classList.add("show");
  }
  function closeViewer() { $("#viewer").classList.remove("show"); }
  /* 打开时整建一次缩略图条；之后切换只换主图+挪选中框，不全量重建（真机不卡） */
  function renderViewer() {
    const l = list();
    $("#vStrip").innerHTML = l.map((h, i) => `
      <div class="vthumb" data-v="${i}">
        ${h.image
          ? `<img src="${h.image}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">`
          : `<div class="bg" style="background:${tintOf(i)}"></div><img src="assets/ph/model.svg">`}
      </div>`).join("");
    $$("[data-v]").forEach(t => t.addEventListener("click", () => {
      vIndex = +t.dataset.v;
      updateViewer();
    }));
    updateViewer();
  }
  function updateViewer() {
    const cur = list()[vIndex];
    if (cur && cur.image) {
      $("#vPhoto").style.background = "#1a1a1c";
      $("#vPhoto").innerHTML = `<img src="${cur.image}" style="max-width:100%;max-height:100%;border-radius:20px;object-fit:contain">`;
    } else {
      $("#vPhoto").style.background = tintOf(vIndex);
      $("#vPhoto").innerHTML = `<img src="assets/ph/model.svg">`;
    }
    $$("#vStrip .vthumb").forEach((t, i) => t.classList.toggle("on", i === vIndex));
    $$("#vStrip .vthumb")[vIndex]?.scrollIntoView({ inline: "center", behavior: "smooth" });
  }

  /* ---- 编辑/删除 ---- */
  $("#btnEdit").addEventListener("click", () => {
    editing = !editing;
    sel.clear();
    $("#btnEdit").textContent = editing ? "完成" : "编辑";
    $("#appRoot").classList.toggle("editing", editing);
    $("#appRoot").classList.toggle("editing-bar", editing);
    $("#btnDel").textContent = "删除所选（0）";
    renderGrid();
  });
  $("#btnDel").addEventListener("click", () => {
    if (!sel.size) { toast("先选择要删除的记录"); return; }
    // 删除时顺带置 historySeeded，兼容老数据没有该标记的情况，保证删空后不再自动播种
    Store.set({ history: list().filter(h => !sel.has(h.id)), historySeeded: true });
    savedToast(`已删除 ${sel.size} 条记录`);
    sel.clear();
    $("#btnDel").textContent = "删除所选（0）";
    renderGrid();
  });

  renderGrid();
