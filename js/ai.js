/* AI only starts after an explicit user action. Existing tasks are queried without replay. */

const AI = {
  guard(){const key=LocalState.key,epoch=LocalState.epoch;return ()=>{if(key!==LocalState.key||epoch!==LocalState.epoch||LocalState.locked)throw Error('账号已切换或资料正在保存');};},
  async submit(path,body){if(LocalState.locked)throw Error('资料正在保存，请稍后重试');const actionId=body.actionId||crypto.randomUUID(),key=LocalState.key,epoch=LocalState.epoch;
    Store.set({pendingAIActions:[...(Store.get().pendingAIActions||[]).slice(-99),{actionId,path,at:Date.now()}]});await LocalState.flush();if(key!==LocalState.key||epoch!==LocalState.epoch)throw Error('账号已切换');
    const result=await this._post(path,{...body,actionId});if(key!==LocalState.key||epoch!==LocalState.epoch||LocalState.locked)throw Error('账号已切换，原任务可在原账号中查看');Store.set({pendingAIActions:(Store.get().pendingAIActions||[]).filter(a=>a.actionId!==actionId)});await LocalState.flush();if(key!==LocalState.key||epoch!==LocalState.epoch||LocalState.locked)throw Error('账号已切换');return result;
  },
  async operation(kind,input){
    const key=LocalState.key,epoch=LocalState.epoch,current=()=>key===LocalState.key&&epoch===LocalState.epoch&&!LocalState.locked;await this.requireCapability(kind);if(!current())throw Error('账号已切换');await Consent.ensure();if(!current())throw Error('账号已切换');
    const encoded=await MediaCache.upload(input,current,{force:true});if(!current())throw Error('资料已切换');let op;
    try{op=await this.submit('/api/ai/operations',{kind,input:encoded});}
    catch(e){if(!current())throw Error('账号已切换');if(e.code!=='AI_RETRY_REQUIRED'||!confirm('上次任务结果未确认。重试可能再次消耗额度，是否继续？'))throw e;op=await this.submit('/api/ai/operations',{kind,input:encoded,retry:true});}
    if(!current())throw Error('账号已切换');const id=op.operationId;Store.set({pendingOperations:[...new Set([...(Store.get().pendingOperations||[]),id])]});await LocalState.flush();
    for(let i=0;i<240;i++){
      if(!current())throw Error('任务已提交，可在试穿记录中查看');
      if(op.status==='done'){if(op.deleted)throw Error('此结果已删除');await CloudSync.run({pull:true});if(!current())throw Error('账号已切换');return op;}
      if(['failed','unknown'].includes(op.status))throw Error(op.error||'任务未完成，请查看记录后决定是否重试');
      await new Promise(r=>setTimeout(r,1500));const r=await AppAPI.request('/api/ai/operations/'+encodeURIComponent(id));op=await r.json();if(!r.ok)throw Error(op.error||'任务查询失败');
    }throw Error('任务仍在处理，可稍后在试穿记录查看');
  },
  async capabilities(){if(AppAPI.demo)return {TRYON:{available:false,reason:'本地模式仅支持搭配拼图'},CUTOUT:{available:false,reason:'本地模式未连接图片处理服务'},INSPECT:{available:false},RECOMMEND:{available:false}};
    try{const r=await AppAPI.request('/api/ai/capabilities');if(!r.ok)throw Error();return (await r.json()).capabilities;}catch{return Object.fromEntries(['TRYON','CUTOUT','INSPECT','RECOMMEND'].map(k=>[k,{available:false,reason:'AI 服务暂时无法连接'}]));}},
  async requireCapability(kind){const guard=this.guard(),cap=(await this.capabilities())[kind];guard();if(!cap?.available)throw Error(cap?.reason||'此 AI 功能暂不可用');},
  async inspect(image,purpose,target){const r=await this.operation('INSPECT',{image,purpose,target});if(r.inspection!=='passed')throw Error((r.inspection==='needs_selection'?'照片中有多个目标，请换成单件衣物或单人照片。':'照片暂不适合处理。')+(r.reason||''));return r.operationId;},
  async cutout(item){const guard=this.guard();await this.requireCapability('CUTOUT');guard();if(!confirm('会先检查这张照片，再去除衣物背景。检查和去背景均可能消耗额度；有效检查会复用。继续？'))throw Object.assign(Error('已取消'),{handled:true});
    const key=LocalState.key,epoch=LocalState.epoch;await CloudSync.run();if(key!==LocalState.key||epoch!==LocalState.epoch||LocalState.locked)throw Error('账号已切换');
    const input={image:item.originalImage||item.dataUrl,purpose:'garment',target:item.cat,itemId:item.id};input.inspectionId=await this.inspect(input.image,'garment',item.cat);if(key!==LocalState.key||epoch!==LocalState.epoch||LocalState.locked)throw Error('账号已切换');return this.operation('CUTOUT',input);},
  _online: null,   // 后端是否在线（null=未探测）

  async _post(path, body, timeout = 30000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      /* 生成类接口服务端要求登录：带上登录发的 token */
      const token = (Store.get().account || {}).token || "";
      /* 会话号 + 当前页：让后端权威事件（生成成功/失败、配额拦截）能关联到会话/来源页 */
      const sid = (typeof Track !== "undefined" && Track.sid) ? Track.sid() : "";
      const resp = await AppAPI.request(path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(sid ? { "X-Sid": sid } : {}),
          "X-Page": location.pathname.split("/").pop() || "",
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        const err = new Error(data.error || ("HTTP " + resp.status));
        /* 未登录(401)/额度用完(429)：这里统一 toast 并标记 handled，
           页面 catch 里请判 e.handled 再决定要不要再报通用失败提示（防覆盖） */
        if (resp.status === 401 || resp.status === 429) {
          toast(data.error || "请先登录后使用 AI 功能");
          err.handled = true;
        }
        err.status=resp.status;err.code=data.code;throw err;
      }
      return await resp.json();
    } finally {
      clearTimeout(timer);
    }
  },

  /* 探测后端是否在线（只探测一次，结果缓存） */
  async available() { return !AppAPI.demo; },

  /* ---------- ⓪ 上传照片质检（创建模特前） ---------- */
  async validatePhoto(image) {
    if (!AppAPI.demo) {
      try {
        return await this.operation("VALIDATE", {image});
      } catch (e) { throw e; }
    }
    return { pass: true, fail_reasons: [], primary_reason: "", mock: true };
  },

  /* ---------- ① 衣物识别/平铺图/标签 ---------- */
  async segment(image) {
    if (!AppAPI.demo) {
      try {
        return await this._post("/api/segment", { image }, 240000);
      } catch (e) {
        /* 后端在线但请求失败＝真失败，上抛给页面提示"识别失败"，
           不再静默把整张原图当"上衣"入橱（mock 只用于离线演示降级） */
        console.warn("segment 请求失败（在线）", e);
        throw e;
      }
    }
    /* 本地模拟：原图返回 */
    return { image, items: [{ image, category: "上衣", name: "我的单品" }], mock: true };
  },

  /* ---------- ①b 拆分（后台化 · 逐件粒度）：提交任务 ----------
     在线 → { jobId }：识别与逐件生成都在服务器跑（并发上限2），
       app.js 的全局轮询取回逐件状态驱动进度卡、完成落库，用户可离开页面；
     离线 → { local }：无后台队列，返回本地模拟结果，调用方即时入橱 */
  async segmentStart(image, requestId = crypto.randomUUID()) {
    if (!AppAPI.demo) {
      const key=LocalState.key,epoch=LocalState.epoch,current=()=>key===LocalState.key&&epoch===LocalState.epoch&&!LocalState.locked;await Consent.ensure();if(!current())throw Error('账号已切换');const encoded=await MediaCache.upload({image},current,{force:true});if(!current())throw Error('账号已切换');try{return await this.submit('/api/segment/start',{...encoded,requestId});}catch(e){if(e.code!=='AI_RETRY_REQUIRED'||!confirm('上次整理未完成。重新提交可能消耗额度，继续吗？'))throw e;return this.submit('/api/segment/start',{...encoded,requestId,retry:true});}
    }
    return { local: { image, items: [{ image, category: "上衣", name: "我的单品" }], mock: true } };
  },

  /* 拆分单件重试：把任务里 fail 的一件重新排队，进度由轮询接管 */
  async segmentRetry(jobId, index) {
    const guard=this.guard();await Consent.ensure();guard();if(!confirm('重试可能再次消耗额度，继续吗？'))throw Object.assign(Error('已取消'),{handled:true});return await this.submit('/api/segment/retry',{jobId,index});
  },

  /* ---------- ② 虚拟试穿 ----------
     返回 { image } —— image 为 null 时由页面用本地叠图合成兜底 */
  async tryon(modelImage, items, meta={}) {
    const entryGuard=this.guard();
    if (!AppAPI.demo) {
      try {
        await this.requireCapability('TRYON');entryGuard();
        if(!confirm('会检查人物照和所选衣物，再生成试穿图。最多 '+(items.length+1)+' 次照片检查及 1 次生成；有效检查和已有结果会复用。继续？'))throw Object.assign(Error('已取消'),{handled:true});
        const key=LocalState.key,epoch=LocalState.epoch,current=()=>key===LocalState.key&&epoch===LocalState.epoch&&!LocalState.locked;
        const inspectionId=await this.inspect(modelImage,'person','full_body');const checked=[];
        for(const item of items){if(!current())throw Error('账号已切换');checked.push({...item,inspectionId:await this.inspect(item.image,'garment',item.category)});}if(!current())throw Error('账号已切换');
        return await this.operation("TRYON", {modelImage,items:checked,...meta,inspectionId});
      } catch (e) {
        /* 后端在线但本次请求失败（网络闪断/服务重启/5xx）＝真失败，
           不带 mock——mock 只标记"无密钥/后端不在线"的预期降级 */
        console.warn("tryon 请求失败（在线）", e);
        throw e;
      }
    }
    return { image: null, mock: true };
  },

  /* ---------- ③ 搭配推荐 ---------- */
  async recommend(wardrobe, around = null, context = {}) {
    const payload = {
      wardrobe: wardrobe.map(i => ({
        id: i.id, category: i.cat, custom: !!i.dataUrl,
        name: i.name || "", labels: {...i.labels,scene:i.scene||'',warmth:i.warmth||'',color:i.color||''},
        gender: i.gender || null,
      })),
      around, context:WardrobeModel.context(context),
    };
    if (!AppAPI.demo) {
      try {
        const r = await this.operation("RECOMMEND", payload);
        if (r && Array.isArray(r.items) && r.items.length) return r;
      } catch (e) { throw e; }
    }
    /* 本地模拟：与后端 recommend.js 的 ruleMatch 同口径——
       有锚点单品时按它的性别过滤（系统款不跨性别混搭），无锚点才用偏好；
       用户自己上传的衣服（dataUrl）不限性别；组套后做成套校验，缺件不算一套 */
    const pick = list => list[Math.floor(Math.random() * list.length)];
    const it = around ? wardrobe.find(i => i.id === around) : null;
    const genders = it && it.gender ? new Set([it.gender]) : prefGenders();
    const byCat = (cat, ex) => {
      const pool = wardrobe.filter(i => i.cat === cat && i.id !== ex
        && (i.dataUrl || !i.gender || genders.has(i.gender)));
      const mine = pool.filter(i => i.dataUrl);
      const list = mine.length ? mine : pool;
      return list.length ? pick(list).id : null;
    };
    let items;
    if (it) {
      const need = {
        "上衣": ["下装", "鞋子"], "下装": ["上衣", "鞋子"],
        "连体裙": ["鞋子"], "鞋子": Math.random() > .3 ? ["上衣", "下装"] : ["连体裙"],
      }[it.cat] || [];
      items = [it.id, ...need.map(c => byCat(c, it.id))];
    } else {
      items = Math.random() > .3
        ? [byCat("上衣"), byCat("下装"), byCat("鞋子")]
        : [byCat("连体裙"), byCat("鞋子")];
    }
    items = items.filter(Boolean);
    /* 成套校验（与后端 isComplete 同口径）：上衣+下装+鞋子 或 连体裙+鞋子 */
    const cats = items.map(id => (wardrobe.find(i => i.id === id) || {}).cat);
    const complete = cats.includes("鞋子")
      && (cats.includes("连体裙") || (cats.includes("上衣") && cats.includes("下装")));
    return { items: complete ? items : [], mock: true };
  },
};
