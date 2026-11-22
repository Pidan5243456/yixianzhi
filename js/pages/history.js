
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
          ? `<img src="${MediaCache.src(h.image)}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover" alt="${h.kind==='tryon'?'AI试穿效果':h.kind==='collage'?'演示拼贴':'旧版记录'}">`
          : `<div class="bg" style="background:${tintOf(i)}"></div>
             <div class="fit"><img src="assets/ph/model.svg" alt="试衣照"></div>`}
        <span style="position:absolute;bottom:6px;left:6px;background:#fff;padding:3px 6px;border-radius:6px;font-size:11px">${h.kind==='collage'?'演示拼贴':h.kind==='tryon'?'AI 试穿':'旧版记录'}</span><span class="ck"></span>
      </div>`).join("")
      : `<div class="empty" style="grid-column:1/-1"><span class="empty-visual">${uiIcon("photo")}</span><h3>还没有试穿记录</h3><br><a href="home.html" class="btn btn-primary">去试穿</a></div>`;

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
          ? `<img src="${MediaCache.src(h.image)}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">`
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
      $("#vPhoto").innerHTML = `<img src="${MediaCache.src(cur.image)}" style="max-width:100%;max-height:100%;border-radius:20px;object-fit:contain">`;
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

window.addEventListener('data-synced',()=>renderGrid());

let taskPolling=false;
async function refreshTasks(){if(taskPolling||AppAPI.demo||!Store.get().account?.token)return;taskPolling=true;const key=LocalState.key,epoch=LocalState.epoch;try{
 const response=await AppAPI.request('/api/ai/operations');const data=await response.json();if(!response.ok)throw Error(data.error||'任务读取失败');if(key!==LocalState.key||epoch!==LocalState.epoch)return;
 const tasks=data.operations.filter(o=>o.status!=='done'||o.kind==='INSPECT'&&o.inspection!=='passed'||o.kind==='CUTOUT'&&!o.applied);
 $('#taskList').innerHTML=tasks.map(o=>'<div style="padding:16px 0;border-bottom:1px solid var(--line)"><strong>'+({TRYON:'试穿',RECOMMEND:'搭配推荐',SPLIT:'衣物整理',VALIDATE:'照片检查',INSPECT:'照片检查',CUTOUT:'去背景'}[o.kind]||'AI 任务')+'</strong><p style="margin:8px 0">'+escapeHTML(['queued','running'].includes(o.status)?'正在处理，可稍后回来查看':o.error||o.reason||'任务未完成')+'</p>'+(['failed','unknown'].includes(o.status)?(o.kind==='SPLIT'?'<a href="wardrobe.html" class="btn btn-ghost">查看衣橱任务</a>':'<button class="btn btn-ghost" data-task-retry="'+o.operationId+'">重试</button>'):'')+'</div>').join('');
 $('#taskList').querySelectorAll('[data-task-retry]').forEach(button=>button.onclick=async()=>{if(!confirm('重试可能再次消耗额度，继续吗？'))return;button.disabled=true;try{await Consent.ensure();await AI.submit('/api/ai/operations/'+button.dataset.taskRetry+'/retry',{});toast('任务已提交');}catch(e){if(!e.handled)toast(e.message);}finally{button.disabled=false;refreshTasks();}});
 await CloudSync.run();
}catch(e){if(key===LocalState.key&&epoch===LocalState.epoch)$('#taskList').textContent='任务状态暂时无法读取，可稍后重试';}finally{taskPolling=false;}}
refreshTasks();setInterval(refreshTasks,5000);
