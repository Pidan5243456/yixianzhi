
  renderStatusbar();

  const CHEV = '<svg class="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 5 7 7-7 7"/></svg>';

  function saveProfile(patch) {
    Store.set({ profile: { ...Store.get().profile, ...patch } });
    renderRows();
  }

  /* 造型档案字段（顺序即展示顺序）：现阶段仅收集存储，暂不影响 AI 能力 */
  const FIELDS = [
    { key: "gender", label: "性别", type: "single", opts: ["女性", "男性", "不愿透露"],
      read: p => p.gender || "", save: v => saveProfile({ gender: v }) },
    { key: "job", label: "职业", type: "job",
      read: p => p.job || "", save: v => saveProfile({ job: v }) },
    { key: "pref", label: "服装类型", type: "multi", opts: ["女装", "男装"], min: 1,
      read: p => (p.pref || []).join("、"), cur: p => p.pref || [], save: v => saveProfile({ pref: v }) },
    { key: "height", label: "身高", type: "number", placeholder: "请输入身高", unit: "cm", lo: 100, hi: 250,
      read: p => p.height ? p.height + "cm" : "", cur: p => p.height || "", save: v => saveProfile({ height: v }) },
    { key: "size", label: "身材尺码", type: "single", opts: ["XS", "S", "M", "L", "XL", "XXL"],
      read: p => p.size || "", save: v => saveProfile({ size: v }) },
    { key: "bodyType", label: "身材体型", type: "single", opts: ["偏瘦", "匀称", "微胖", "丰满", "健硕"],
      read: p => p.bodyType || "", save: v => saveProfile({ bodyType: v }) },
    { key: "budget", label: "购买区间", type: "range",
      read: p => p.budgetMin && p.budgetMax ? `¥${p.budgetMin}–${p.budgetMax}` : "" },
    { key: "styles", label: "风格喜好", type: "multi", opts: ["通勤", "休闲", "运动", "约会", "街头", "复古", "极简", "甜美"],
      read: p => (p.styles || []).join("、"), cur: p => p.styles || [], save: v => saveProfile({ styles: v }) },
    { key: "colorTypes", label: "色彩类型", type: "multi", opts: ["黑白灰", "大地色系", "莫兰迪低饱和", "明亮色系", "粉嫩色系", "深色系"],
      read: p => (p.colorTypes || []).join("、"), cur: p => p.colorTypes || [], save: v => saveProfile({ colorTypes: v }) },
  ];

  function renderRows() {
    const p = Store.get().profile;
    $("#fieldRows").innerHTML = FIELDS.map(f => {
      const v = f.read(p);
      return `<button class="srow frow" data-f="${f.key}">
        <span class="sl" style="font-weight:500">${f.label}</span>
        <span class="sv ${v ? "" : "add"}">${escapeHTML(v || "添加")}</span>${CHEV}
      </button>`;
    }).join("");
    $$("#fieldRows .srow").forEach(b => b.addEventListener("click", () => openField(b.dataset.f)));
  }

  const pickBtn = (v, on) => `<button class="pick ${on ? "active" : ""}" data-v="${v}">${v}</button>`;
  const saveBtn = '<button class="btn btn-primary btn-block" style="margin-top:22px" id="btnSheetSave">保存</button>';

  function openField(key) {
    const f = FIELDS.find(x => x.key === key);
    const p = Store.get().profile;
    $("#sheetTitle").childNodes[0].textContent = f.label;
    const body = $("#sheetBody");

    if (f.type === "single" || f.type === "job") {
      const cur = f.read(p);
      body.innerHTML = f.type === "single"
        ? `<div class="picks-wrap">${f.opts.map(o => pickBtn(o, o === cur)).join("")}</div>`
        : Object.entries(JOBS).map(([g, list]) => `
            <div class="group-label">${g}</div>
            <div class="picks-wrap">${list.map(j => pickBtn(j, j === cur)).join("")}</div>`).join("");
      $$("#sheetBody .pick").forEach(b => b.addEventListener("click", () => {
        f.save(b.dataset.v);
        closeSheet("sheetEdit");
        savedToast("已保存");
      }));

    } else if (f.type === "multi") {
      const cur = new Set(f.cur(p));
      body.innerHTML = `<div class="picks-wrap">${f.opts.map(o => pickBtn(o, cur.has(o))).join("")}</div>${saveBtn}`;
      $$("#sheetBody .pick").forEach(b => b.addEventListener("click", () => b.classList.toggle("active")));
      $("#btnSheetSave").addEventListener("click", () => {
        const v = $$("#sheetBody .pick.active").map(b => b.dataset.v);
        if (f.min && v.length < f.min) { toast("至少选择一项"); return; }
        f.save(v);
        closeSheet("sheetEdit");
        savedToast("已保存");
      });

    } else if (f.type === "number") {
      body.innerHTML = `
        <div class="field"><input id="numIn" type="number" inputmode="numeric" placeholder="${f.placeholder}" value="${escapeHTML(f.cur(p))}">
          <span style="color:var(--muted);font-size:15px">${f.unit}</span></div>${saveBtn}`;
      $("#btnSheetSave").addEventListener("click", () => {
        const raw = $("#numIn").value.trim();
        if (!raw) { f.save(""); closeSheet("sheetEdit"); savedToast("已清除"); return; }
        const n = +raw;
        if (!Number.isInteger(n) || n < f.lo || n > f.hi) { toast(`请输入 ${f.lo}–${f.hi} 的整数`); return; }
        f.save(String(n));
        closeSheet("sheetEdit");
        savedToast("已保存");
      });

    } else if (f.type === "range") {
      body.innerHTML = `
        <div class="row">
          <div class="field grow"><input id="minIn" type="number" inputmode="numeric" placeholder="最低价" value="${escapeHTML(p.budgetMin || "")}"></div>
          <span style="color:var(--muted)">—</span>
          <div class="field grow"><input id="maxIn" type="number" inputmode="numeric" placeholder="最高价" value="${escapeHTML(p.budgetMax || "")}"></div>
        </div>
        <p style="font-size:12.5px;color:var(--muted);margin-top:10px">单次购买服饰的预算范围（元）</p>${saveBtn}`;
      $("#btnSheetSave").addEventListener("click", () => {
        const a = $("#minIn").value.trim(), b = $("#maxIn").value.trim();
        if (!a && !b) { saveProfile({ budgetMin: "", budgetMax: "" }); closeSheet("sheetEdit"); savedToast("已清除"); return; }
        const lo = +a, hi = +b;
        if (!a || !b || !(lo >= 0) || !(hi > 0) || lo >= hi) { toast("请填写完整，且最低价小于最高价"); return; }
        saveProfile({ budgetMin: String(lo), budgetMax: String(hi) });
        closeSheet("sheetEdit");
        savedToast("已保存");
      });
    }
    openSheet("sheetEdit");
  }

  const sw=$('#swPrivacy'),analytics=$('#swAnalytics');
  async function refreshConsent(){try{const data=await Consent.state();sw.checked=data.ai_processing;analytics.checked=data.analytics;}catch(e){sw.checked=false;analytics.checked=false;toast(e.message);}}
  sw.addEventListener('change',async()=>{const granted=sw.checked;sw.disabled=true;try{if(granted){await Consent.ensure();}else if(confirm('关闭后将停止新的 AI 调用，已完成的结果仍可查看。确定关闭？'))await Consent.set('ai_processing',false);}catch(e){if(!e.handled)toast(e.message);}finally{await refreshConsent();sw.disabled=false;}});
  analytics.addEventListener('change',async()=>{analytics.disabled=true;try{await Consent.set('analytics',analytics.checked);}catch(e){toast(e.message);}finally{await refreshConsent();analytics.disabled=false;}});
  refreshConsent();
  renderRows();
