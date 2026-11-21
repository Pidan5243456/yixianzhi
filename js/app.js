/* ============ 公共逻辑：状态存储 / 组件渲染 / 交互 ============ */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
function escapeHTML(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function safePh(value) { return /^[a-z]+$/.test(value || '') ? value : 'tee'; }

/* 任意页面 URL 带 ?reset=1 → 清空演示数据回到全新状态 */
if (new URLSearchParams(location.search).get("reset") === "1") {
  localStorage.removeItem("aiwd-state");
  AppNav.replace("login.html");
}

/* 重置演示数据（我的页设置入口调用） */
async function resetDemoData() {
  if(!AppAPI.demo) {toast('此操作仅适用于本地演示');return;}
  await LocalState.backup('reset');
  const account = Store.get().account;
  Store._cache = Store.defaults(); Store.set({account});
  await AppNav.go('home.html', true);
}

/* bfcache 恢复兜底（全站）：手机手势返回时页面连内存一起原样恢复，Store 的内存缓存
   还是离开前的旧快照，在它之上任何一次写回都会覆掉其他页面刚产生的数据（收藏/衣橱/历史）。
   默认整页刷新取最新状态；个别页面（试穿页）刷新会重复触发付费生成，
   可在自己脚本里设 window.KEEP_BFCACHE = true 并自行处理恢复逻辑 */
window.addEventListener("pageshow", (e) => {
  if (!e.persisted) return;
  AppNav.navigating=false;
  if (window.KEEP_BFCACHE) return;
  LocalState.locked=false;
  AppNav.reload();
});

/* ---------- 本地状态（localStorage） ---------- */
const Store = {
  KEY: "aiwd-state",
  _cache: null,
  defaults() {
    return {
      dataVersion: 2, customOutfits: [],
      wardrobe: [],   // 衣橱里的单品 id（新用户=基础款）
      customItems: [],                   // 用户上传的单品 {id,name,cat,dataUrl}
      pendingSegments: [],
      processedSegmentTargets: [],               // 后台拆分任务 {jobId,ts}：提交后可离开，全局轮询完成后写入衣橱
      deletedItems: [],                  // 被删除的系统单品 id（其所在搭配全站隐藏）
      favorites: [],                     // 收藏的搭配 id
      history: [],                       // 试衣历史 {id,outfitId,items,scene,time}
      models: PRESET_MODELS.map(p => ({ ...p, dataUrl: null })),
      curModel: "m1",
      profile: {
        gender: "", job: "", pref: [],            // 引导问卷：性别 / 职业 / 服装类型（女装男装）
        height: "", size: "", bodyType: "",       // 造型档案（设置页收集，现阶段仅存储展示）
        budgetMin: "", budgetMax: "", styles: [], colorTypes: [],
      },
      account: { nick: "", avatar: "", email: "" }, // 账号资料（本地演示，真鉴权接入前无服务端）
      privacyOk: false,                              // 设置页「隐私协议授权」开关
      onboarded: false,
    };
  },
  get() {
    if (!this._cache) {
      try { this._cache = { ...this.defaults(), ...LocalState.record.state }; }
      catch { this._cache = this.defaults(); }
      /* 迁移：虚拟模特只保留默认款（高个/微胖/小个子已下线），用户上传的照片模特保留 */
      this._cache.models = this._cache.models.filter(m => m.dataUrl || m.id === "m1");
      if (!this._cache.models.find(m => m.id === "m1")) {
        this._cache.models.unshift({ ...PRESET_MODELS[0], dataUrl: null });
      }
      if (!this._cache.models.find(m => m.id === this._cache.curModel)) {
        this._cache.curModel = "m1";
      }
      /* 迁移：旧演示数据的单品/搭配 id 已随素材库更换，清掉失效引用 */
      const validItem = new Set(ITEMS.map(i => i.id));
      this._cache.wardrobe = (this._cache.wardrobe || []).filter(id => validItem.has(id));
      if (!Array.isArray(this._cache.customOutfits)) this._cache.customOutfits = [];
      const validOutfit = new Set([...OUTFITS,...this._cache.customOutfits].map(o => o.id));
      this._cache.favorites = (this._cache.favorites || []).filter(id => validOutfit.has(id));
      if (!Array.isArray(this._cache.deletedItems)) this._cache.deletedItems = [];
    }
    return this._cache;
  },
  set(patch) {
    if(LocalState.locked) return false;
    this._cache = { ...this.get(), ...patch };
    return LocalState.set(this._cache);
  },
};

/* ---------- 埋点（前端采集）----------
   一行 Track.send(事件, 参数) 即上报。sendBeacon 优先（页面跳转/关闭也发得出去），
   失败兜底 fetch keepalive。session_id 存 localStorage 跨页面复用。
   隐私授权关掉（privacyOk===false）则完全不采集。埋点永不影响页面逻辑。
   视图类漏斗（进试穿页/引导页等）由 page_view 的 page 字段在看板侧推导，不重复埋。 */
const Track = {
  sid() {
    let s = null;
    try { s = localStorage.getItem("aiwd-sid"); } catch {}
    if (!s) {
      s = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      try { localStorage.setItem("aiwd-sid", s); } catch {}
    }
    return s;
  },
  send(event, props = {}) {
    try {
      /* iframe 内不采集：index.html 总览页用 iframe 嵌了所有页面（桌面演示用），
         不是真实访问，否则会给每页凭空造出一次 PV、污染漏斗 */
      if (window.top !== window.self) return;
      const s = Store.get();
      if (s.privacyOk !== true) return;              /* 用户关了隐私授权：不采集 */
      const body = JSON.stringify({
        event,
        props: props || {},
        session_id: this.sid(),
        page: location.pathname.split("/").pop() || "index.html",
        email: (s.account && s.account.email) || null,
      });
      AppAPI.request("/api/track", { method: "POST", body, keepalive: true,
        headers: { "Content-Type": "application/json" } }).catch(() => {});
    } catch { /* 埋点永不影响页面 */ }
  },
};
/* 全站自动 PV：每个页面真实加载记一次（bfcache 恢复不触发 load，不会重复） */
window.addEventListener("app-ready", () => Track.send("page_view"));

/* ---------- 单品工具 ---------- */
function allItems() {
  return [...ITEMS, ...Store.get().customItems];
}
function itemById(id) {
  return Store.get().deletedItems.includes(id) ? undefined : allItems().find(i => i.id === id);
}
const PRESET_GARMENT_IDS = Object.freeze(['f-daily-02-top','f-daily-02-bottom','f-date-08-shoes','m-daily-01-top','m-daily-01-bottom','m-daily-01-shoes']);
function presetItems() { const hidden=new Set(Store.get().deletedItems);return PRESET_GARMENT_IDS.map(id=>ITEMS.find(i=>i.id===id)).filter(i=>i&&!hidden.has(i.id)); }
function isPresetItem(id) { return PRESET_GARMENT_IDS.includes(id)&&!inWardrobe(id); }
function selectableItems() { return [...new Map([...wardrobeItems(),...presetItems()].map(i=>[i.id,i])).values()]; }
function recommendationItems(around=null) { const mine=wardrobeItems();return around&&isPresetItem(around)?presetItems():mine.length?mine:presetItems(); }
function wardrobeItems() {
  const s = Store.get();
  /* 用户自己上传的衣服排在最前面 */
  return [...s.customItems, ...ITEMS.filter(i => s.wardrobe.includes(i.id))].filter(i=>!s.deletedItems.includes(i.id));
}
function inWardrobe(id) {
  const s = Store.get();
  return s.wardrobe.includes(id) || s.customItems.some(c => c.id === id);
}
/* 引导问卷选的服饰性别偏好 → 展示哪些性别的搭配（没选=全部） */
function prefGenders() {
  const pref = Store.get().profile.pref || [];
  const g = new Set();
  if (pref.includes("女装")) g.add("f");
  if (pref.includes("男装")) g.add("m");
  return g.size ? g : new Set(["f", "m"]);
}
/* 可展示的搭配：性别符合偏好 + 不含被删除的衣服（删衣服→相关搭配全站隐藏） */
function availableOutfits() {
  const genders = prefGenders();
  const deleted = new Set(Store.get().deletedItems);
  return OUTFITS.filter(o =>
    genders.has(o.gender) && !o.items.some(id => deleted.has(id)));
}

/* 单品 <img>：优先找 assets/real/<id>.png → .jpg → 占位剪影 */
function itemImg(item, cls = "ph-img") {
  if (!item) return `<span class="missing-piece">衣物已移除</span>`;
  if (item.dataUrl) return `<img class="${cls}" src="${MediaCache.src(item.dataUrl)}" alt="${escapeHTML(item.name)}" loading="lazy">`;
  return `<img class="${cls}" src="assets/real/${item.id}.png" alt="${escapeHTML(item.name)}" loading="lazy"
    onerror="phFallback(this,'${safePh(item.ph)}')">`;
}
function phFallback(el, ph) {
  if (el.dataset.step === "2") { el.onerror = null; el.src = `assets/ph/${ph}.svg`; return; }
  el.dataset.step = "2";
  el.src = el.src.replace(/\.png$/, ".jpg");
}

/* 假 iOS 状态栏已移除（手机自带真状态栏）；保留空函数兼容各页面的调用 */
function renderStatusbar() {}

/* 手机浏览器状态栏/工具条颜色与页面顶部渐变统一
   （页面 head 里自带 theme-color 时以页面的为准） */
if (!document.querySelector('meta[name="theme-color"]')) {
  const themeMeta = document.createElement("meta");
  themeMeta.name = "theme-color";
  themeMeta.content = "#ffffff";
  document.head.appendChild(themeMeta);
}

/* ---------- 底部导航 ---------- */
const TABS = [
  {key:'home',label:'穿搭',href:'home.html',icon:'home'},
  {key:'wardrobe',label:'衣橱',href:'wardrobe.html',icon:'hanger'},
  {key:'upload',label:'上传',href:'add-clothes.html',fab:true},
  {key:'history',label:'试穿记录',href:'history.html',icon:'photo'},
  {key:'me',label:'我的',href:'profile.html',icon:'user'},
];
function renderTabbar(active) {
 const nav=document.createElement('nav');nav.className='tabbar';nav.setAttribute('aria-label','主导航');
 nav.innerHTML=TABS.map(t=>t.fab
  ? `<div class="fab-slot"><a class="fab" href="${t.href}" aria-label="上传衣服">${uiIcon('plus')}</a><span class="fab-label">上传</span></div>`
  : `<a href="${t.href}" class="${t.key===active?'active':''}" ${t.key===active?'aria-current="page"':''}>${uiIcon(t.icon)}<span>${t.label}</span></a>`).join('');
 document.querySelector('.app').append(nav);
}

/* ---------- Sheet / Modal / Toast ---------- */
function openSheet(id) {
  $("#mask-" + id)?.classList.add("show");
  $("#" + id)?.classList.add("show");
}
function closeSheet(id) {
  $("#mask-" + id)?.classList.remove("show");
  $("#" + id)?.classList.remove("show");
}
function openModal(id) { $("#" + id)?.classList.add("show"); }
function closeModal(id) { $("#" + id)?.classList.remove("show"); }

let toastTimer;
function toast(msg) {
  let el = $(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    document.body.append(el);
  }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 1800);
}

/* ---------- 通用：场景/分类 chips ---------- */
function renderChips(container, list, onPick, active = 0) {
  container.innerHTML = list.map((c, i) => {
    const sceneIcons={"全部":"sparkles","通勤":"briefcase","约会":"heart","旅行":"luggage","日常":"coffee"};
    const label = typeof c === "string" ? escapeHTML(c) : `${uiIcon(sceneIcons[c.key] || "hanger")} ${escapeHTML(c.key)}`;
    return `<button class="chip ${i === active ? "active" : ""}" data-i="${i}">${label}</button>`;
  }).join("");
  $$(".chip", container).forEach(chip => chip.addEventListener("click", () => {
    $$(".chip", container).forEach(c => c.classList.remove("active"));
    chip.classList.add("active");
    const c = list[+chip.dataset.i];
    onPick(typeof c === "string" ? c : c.key);
  }));
}

/* 默认虚拟模特图：按性别偏好选 assets/real/model-f.png 或 model-m.png，没图自动回退剪影 */
function defaultModelSrc() {
  /* 偏好唯一时按偏好；偏好含糊（双选/没答）时用引导问卷第1步的性别兜底，
     兑现"选择性别，以定制你的专属试衣模特"的文案承诺 */
  const g = prefGenders();
  let gender;
  if (g.size === 1) gender = g.has("m") ? "m" : "f";
  else gender = Store.get().profile.gender === "男性" ? "m" : "f";
  return `assets/real/model-${gender}.png`;
}

/* 搭配整图：找 assets/real/<搭配id>.png → .jpg → 都没有则移除自己（露出下面的拼贴） */
function outfitCover(id) {
  return `<img class="ocover" src="assets/real/${id}.png" alt="" loading="lazy"
    onload="this.style.visibility='visible'"
    onerror="coverFallback(this)" data-step="1">`;
}
function coverFallback(el) {
  if (el.dataset.step === "1") { el.dataset.step = "2"; el.src = el.src.replace(/\.png$/, ".jpg"); }
  else el.remove();
}

/* 预设模特剪影的体型差异（CSS transform） */
function modelShapeCss(m) {
  return {
    tall:   "transform:scaleY(1.08);transform-origin:bottom center;",
    wide:   "transform:scaleX(1.24);transform-origin:bottom center;",
    petite: "transform:scale(.85);transform-origin:bottom center;",
  }[m && m.shape] || "";
}

/* ---------- 拆分进度卡公共件（衣橱网格 / 试穿抽屉共用） ----------
   进度为模拟值（生图 API 无真实百分比）：排队中爬到 25%，生成中逼近 96%，
   真实完成由轮询落库、卡片消失。样式 .split-prog 在 base.css。 */
const _segPcts = {};   // "jobId:index" → 当前模拟百分比
function segTickPcts(cards) {
  const alive = new Set();
  for (const c of cards) {
    if (c.state !== "pending" && c.state !== "running") continue;
    const key = c.jobId + ":" + c.index;
    alive.add(key);
    const cap = c.state === "running" ? 96 : 25;
    const cur = _segPcts[key] ?? 4;
    _segPcts[key] = Math.min(cap, cur + Math.max(0.4, (cap - cur) * 0.035));
  }
  for (const k of Object.keys(_segPcts)) if (!alive.has(k)) delete _segPcts[k];
}
function segPct(c) { return Math.round(_segPcts[c.jobId + ":" + c.index] ?? 4); }

/* 进度卡内层 HTML（页面负责外层 .icard/.dcell 容器） */
function segCardInner(c) {
  if (c.state === "detecting") {
    return `<div class="split-prog"><span class="spname">AI 识别中…</span>
      <div class="spbar"><i style="width:30%"></i></div></div>`;
  }
  const key = c.jobId + ":" + c.index;
  if (c.state === "fail") {
    return `<div class="split-prog"><span class="spname">${escapeHTML(c.label)}</span>
      <span class="spfail">生成失败</span>
      <button class="spretry" data-segretry="${key}">重试</button></div>`;
  }
  const p = segPct(c);
  return `<div class="split-prog"><span class="spname">${escapeHTML(c.label)}</span>
    <span class="sppct" data-segpct="${key}">${p}%</span>
    <div class="spbar"><i data-segbar="${key}" style="width:${p}%"></i></div>
    <span class="ai-pill" style="padding:5px 12px;font-size:11.5px;color:var(--ink-2)">${c.state === "pending" ? "排队中" : "AI 生成中"}</span></div>`;
}

/* 页面渲染进度卡后调用：给失败卡的重试按钮绑事件（乐观置回排队，轮询接管后续） */
function bindSegRetry() {
  $$("[data-segretry]").forEach(b => b.addEventListener("click", async (e) => {
    e.stopPropagation();
    const [jobId, idx] = b.dataset.segretry.split(":");
    b.disabled = true;
    try {
      await AI.segmentRetry(jobId, +idx);
      const snap = SEG_SNAPSHOT[jobId];
      if (snap && snap.targets && snap.targets[+idx]) snap.targets[+idx].state = "pending";
      window.dispatchEvent(new CustomEvent("segments-updated"));
    } catch {
      toast("重试发起失败，请稍后再点");
      b.disabled = false;
    }
  }));
}

/* 全局定时刷进度数字（无卡片时零开销）；状态推进由 segments-updated 触发页面重渲 */
setInterval(() => {
  const cards = typeof segCardList === "function" ? segCardList() : [];
  if (!cards.length) return;
  segTickPcts(cards);
  for (const c of cards) {
    if (c.state !== "pending" && c.state !== "running") continue;
    const key = c.jobId + ":" + c.index;
    const el = document.querySelector(`[data-segpct="${CSS.escape(key)}"]`);
    const bar = document.querySelector(`[data-segbar="${CSS.escape(key)}"]`);
    const p = segPct(c);
    if (el) el.textContent = p + "%";
    if (bar) bar.style.width = p + "%";
  }
}, 400);

/* 压缩图片：限制最大边长并转 JPEG，防止 localStorage 超限 */
function compressImage(dataUrl, maxW = 800, quality = 0.8) {
  return new Promise((resolve,reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxW / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx=canvas.getContext("2d");ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => resolve(dataUrl);
    MediaCache.url(dataUrl).then(url=>img.src=url).catch(reject);
  });
}

/* 生成单品图的白边裁剪+方形规整（含压缩，入橱用它替代 compressImage）：
   qwen-image-edit 输出跟随输入图比例，竖幅全身照会产出高瘦画布——单品缩在中间、
   上下大片空白，放进方形衣橱卡片就显得特别小。
   做法：扫描非白像素的边界框 → 裁掉四周空白 → 6% 留边 → 补成正方形白底 → 压缩输出。
   近白(≥245)才算背景，白裤等浅色单品靠内部阴影褶皱不会被误裁；全白/异常图原样返回 */
function trimToSquare(dataUrl, maxW = 800, quality = 0.8) {
  return new Promise((resolve,reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const cv = document.createElement("canvas");
        cv.width = img.width; cv.height = img.height;
        const ctx = cv.getContext("2d");
        ctx.drawImage(img, 0, 0);
        const { data } = ctx.getImageData(0, 0, cv.width, cv.height);
        let top = cv.height, bottom = -1, left = cv.width, right = -1;
        for (let y = 0; y < cv.height; y++) {
          for (let x = 0; x < cv.width; x++) {
            const i = (y * cv.width + x) * 4;
            if (data[i+3] > 20 && (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245)) {
              if (x < left) left = x;
              if (x > right) right = x;
              if (y < top) top = y;
              if (y > bottom) bottom = y;
            }
          }
        }
        if (bottom < 0 || right - left < 10 || bottom - top < 10) { resolve(dataUrl); return; }
        const bw = right - left + 1, bh = bottom - top + 1;
        const pad = Math.round(Math.max(bw, bh) * 0.06);
        const side = Math.max(bw, bh) + pad * 2;
        const scale = Math.min(1, maxW / side);
        const out = document.createElement("canvas");
        out.width = out.height = Math.round(side * scale);
        const octx = out.getContext("2d");
        octx.fillStyle = "#fff";
        octx.fillRect(0, 0, out.width, out.height);
        octx.drawImage(cv, left, top, bw, bh,
          Math.round((side / 2 - bw / 2) * scale), Math.round((side / 2 - bh / 2) * scale),
          Math.round(bw * scale), Math.round(bh * scale));
        resolve(out.toDataURL("image/jpeg", quality));
      } catch { resolve(dataUrl); }
    };
    img.onerror = () => resolve(dataUrl);
    MediaCache.url(dataUrl).then(url=>img.src=url).catch(reject);
  });
}

/* ---------- 拆分任务全局轮询：上传拆分后台化 ----------
   任何页面加载后都轮询未完成的拆分任务；完成即写入衣橱（customItems），
   让用户提交上传后可离开当前页面，结果在后台跑完自动落地。 */
async function buildSegmentItems(result) {
  const list = (result.items && result.items.length)
    ? result.items : [{ image: result.image, category: "上衣" }];
  return await Promise.all(list.map(async (d, i) => ({
    id: d.id || ("c" + Date.now() + "_" + i + Math.random().toString(36).slice(2, 5)),
    name: d.name || "我的单品",
    cat: ["上衣", "下装", "鞋子", "连体裙"].includes(d.category) ? d.category : "上衣",
    ph: "tee",
    /* 生成图入橱前裁白边+方形规整+压缩（trimToSquare） */
    dataUrl: (d.image||result.image)?.startsWith('media:')?(d.image||result.image):await trimToSquare(d.image||result.image),
    labels: d.labels || null,
  })));
}

/* 任务快照（内存，不入 localStorage）：jobId → /api/segment/result 最近一次返回，
   衣橱/试穿抽屉的进度卡靠它渲染逐件状态 */
const SEG_SNAPSHOT = {};
// Completed records are durable; the client never discards a task by elapsed time.

let _segPolling = false;
async function pollSegmentJobs() {
  if (_segPolling) return;
  const pend = Store.get().pendingSegments || [];
  const epoch = LocalState.epoch;
  const started = new Set(pend.map(j => j.jobId));
  if (!pend.length) return;
  _segPolling = true;
  try {
    const addItems = [], keep = [];
    const processed = new Set(Store.get().processedSegmentTargets || []);
    let changed = false;
    for (const job of pend) {

      let r;
      try {
        const resp = await AppAPI.request("/api/segment/result", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId: job.jobId, got: job.landed || [] }),
        });
        r = resp.ok ? await resp.json() : (resp.status === 404 ? {status:"missing"} : null);
      } catch { r = null; }   /* 网络闪断/后端未起：保留任务，下轮再试 */
      if (!r) { keep.push(job); continue; }

      if (r.status === "missing") {
        changed = true;   /* 识别失败或服务重启丢失：移除任务并提示 */
        delete SEG_SNAPSHOT[job.jobId];
        toast(r.status === "error" ? "有一次拆分识别失败，请重新上传" : "拆分任务已丢失，请重新上传");
        continue;
      }

      SEG_SNAPSHOT[job.jobId] = r;
      /* 逐件落地：哪件先生成好哪件先入橱（landed 记录已取走的件，防重复） */
      const landed = new Set(job.landed || []);
      for (let i = 0; i < (r.targets || []).length; i++) {
        const t = r.targets[i];
        if (t.state === "done" && t.item && !landed.has(i)) {
          if (!processed.has(t.item.id)) { if(AppAPI.demo)addItems.push(...await buildSegmentItems({items:[t.item]})); processed.add(t.item.id); }
          landed.add(i);
          changed = true;
        }
      }
      job.landed = [...landed];

      /* 全部完成且无失败 → 任务出队；有失败卡（等重试）或还在跑 → 保留 */
      if (r.status === "done" && !(r.targets || []).some(t => t.state === "fail")) {
        changed = true;
        delete SEG_SNAPSHOT[job.jobId];
      } else {
        keep.push(job);
      }
    }
    if (epoch !== LocalState.epoch || LocalState.locked) return;
    if (changed || addItems.length) {
      const latest = Store.get();
      const seen = new Set(latest.processedSegmentTargets || []);
      const freshItems = addItems.filter(i => !seen.has(i.id));
      Store.set({
        customItems: [...freshItems, ...latest.customItems],
        pendingSegments: [...keep, ...(latest.pendingSegments || []).filter(j => !started.has(j.jobId))],
        processedSegmentTargets: [...new Set([...seen, ...processed])],
      });
      if (addItems.length) {
        savedToast(addItems.length > 1 ? `${addItems.length} 件已入橱` : `「${addItems[0].name}」已入橱`);
        Track.send("item_confirm", { count: addItems.length });   /* 拆图成品入衣橱 */
      }
    }
    if(changed&&!AppAPI.demo&&typeof CloudSync!=='undefined')CloudSync.schedule();
    /* 每轮都通知页面：进度卡需要感知 排队中→生成中 等状态推进 */
    window.dispatchEvent(new CustomEvent("segments-updated"));
  } finally {
    _segPolling = false;
  }
}

/* 供页面渲染进度卡：把待处理任务摊平成卡片清单
   [{jobId, index, state: detecting|pending|running|fail, label}] */
function segCardList() {
  const out = [];
  for (const job of (Store.get().pendingSegments || [])) {
    const snap = SEG_SNAPSHOT[job.jobId];
    if(snap?.status==='error'){out.push({jobId:job.jobId,index:-1,state:'fail',label:snap.error||'整理未完成'});continue;}
    if (!snap || snap.status === "detecting") {
      out.push({ jobId: job.jobId, index: -1, state: "detecting", label: "" });
      continue;
    }
    const landed = new Set(job.landed || []);
    (snap.targets || []).forEach((t, i) => {
      if (t.state === "done" || landed.has(i)) return;   /* 已入橱的不再出卡 */
      out.push({ jobId: job.jobId, index: i, state: t.state, label: t.description || t.category || "衣服" });
    });
  }
  return out;
}
/* 每页加载即查一次，之后每 3s 查一次（仅在有待处理任务时真正请求） */
pollSegmentJobs();
setInterval(pollSegmentJobs, 3000);

const fmtTime = ts => {
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
};
