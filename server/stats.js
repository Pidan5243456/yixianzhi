function computeStats(rows, days) {
  const today = new Date().toISOString().slice(0, 10);
  /* 匿名↔登录归因：登录后的事件天然同时带 email+session_id（前端从 Store 取邮箱），
     先扫一遍建 会话→邮箱 映射，再把登录前的匿名事件归到同一个人头上。
     查询时计算，天然追溯窗口内历史数据。同浏览器登多账号时取窗口内最近一次（rows 按 ts 降序）。 */
  const sidToEmail = {};
  for (const e of rows) {
    if (e.email && e.session_id && sidToEmail[e.session_id] === undefined) {
      sidToEmail[e.session_id] = e.email;
    }
  }
  const id = e => e.email || sidToEmail[e.session_id] || e.session_id || "?";
  const evtOf = {};                    // event → 次数
  const pageOf = {};                   // page → page_view 次数
  const dauSet = new Set(), wauSet = new Set();
  const quotaByKind = { SPLIT: 0, TRYON: 0 };
  let quotaTotal = 0;
  const c = { loginView: 0, login: 0, onboard: 0, tryonView: 0, tryonSubmit: 0, tryonDone: 0, splitSubmit: 0, splitDone: 0 };
  for (const e of rows) {
    evtOf[e.event] = (evtOf[e.event] || 0) + 1;
    const isToday = (e.ts || "").slice(0, 10) === today;
    wauSet.add(id(e));
    if (isToday) dauSet.add(id(e));
    if (e.event === "page_view") {
      const p = e.page || "?";
      pageOf[p] = (pageOf[p] || 0) + 1;
      if (p === "login.html") c.loginView++;
      if (p === "tryon.html") c.tryonView++;
    }
    if (e.event === "login_success") c.login++;
    if (e.event === "onboarding_done") c.onboard++;
    if (e.event === "tryon_submit") c.tryonSubmit++;
    if (e.event === "tryon_done") c.tryonDone++;
    if (e.event === "split_submit") c.splitSubmit++;
    if (e.event === "split_done") c.splitDone++;
    if (e.event === "quota_block") {
      quotaTotal++;
      const k = e.props && e.props.kind;
      if (k && quotaByKind[k] !== undefined) quotaByKind[k]++;
    }
  }
  const topPages = Object.entries(pageOf).sort((a, b) => b[1] - a[1]).map(([page, n]) => ({ page, n }));
  const events = Object.entries(evtOf).sort((a, b) => b[1] - a[1]).map(([event, n]) => ({ event, n }));
  const recent = rows.slice(0, 25).map(e => ({
    ts: e.ts, event: e.event, page: e.page,
    who: id(e) === e.session_id ? "游客·" + e.session_id.slice(0, 6) : id(e),   /* 归因后身份 */
  }));
  return {
    days, today, total: rows.length, dau: dauSet.size, wau: wauSet.size,
    funnels: {
      signup: [{ label: "登录页浏览", n: c.loginView }, { label: "登录成功", n: c.login }, { label: "完成引导", n: c.onboard }],
      tryon: [{ label: "进试穿页", n: c.tryonView }, { label: "发起试穿", n: c.tryonSubmit }, { label: "生成成功", n: c.tryonDone }],
      split: [{ label: "提交拆图", n: c.splitSubmit }, { label: "拆图完成", n: c.splitDone }],
    },
    quotaBlock: { total: quotaTotal, byKind: quotaByKind },
    topPages, events, recent,
  };
}

module.exports=computeStats;
