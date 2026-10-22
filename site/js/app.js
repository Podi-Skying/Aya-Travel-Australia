/* Aya 的澳洲旅程｜靜態原型主程式
 * 資料存在這個瀏覽器的 localStorage；清除網站資料即回到原始草稿。
 */
(function () {
  "use strict";

  const DATA = window.TRIP_DATA;
  const KEY = "aya-trip-v1";
  const WD = ["日", "一", "二", "三", "四", "五", "六"];
  const PRI = { must: { t: "必去", c: "b-must" }, pref: { t: "優先", c: "b-pref" }, repl: { t: "可替換", c: "b-repl" } };
  const MODE = { walk: "🚶 步行", bus: "🚌 大眾運輸", drive: "🚗 開車", ferry: "⛴️ 渡輪", train: "🚆 火車", flight: "✈️ 飛機" };
  const LEG = { drive: "🚗 開車", walk: "🚶 步行", wait: "⏳ 等候", ferry: "⛴️ 渡輪", transit: "🚌 乘車", flight: "✈️ 飛行" };
  const STATUS = { estimate: { t: "估計", c: "b-warn" }, quote: { t: "報價", c: "b-info" }, confirmed: { t: "已確認", c: "b-ok" }, unknown: { t: "未知", c: "b-danger" } };
  const VERIFY = { verified: { t: "已驗證", c: "b-ok" }, partial: { t: "部分驗證", c: "b-info" }, unverified: { t: "未驗證", c: "b-line" } };
  const CATS = { transport: { t: "交通", color: "#1f5f8b" }, stay: { t: "住宿", color: "#1f7a6d" }, food: { t: "餐飲", color: "#c2643a" }, tickets: { t: "門票／活動", color: "#7a4fa0" }, other: { t: "其他", color: "#6b7a7a" } };
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- storage ---------- */
  const clone = (o) => JSON.parse(JSON.stringify(o));
  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* 私密模式等情況下無法儲存 */ } }

  const S = load();
  if (!Array.isArray(S.days)) S.days = clone(DATA.days);
  if (!Array.isArray(S.versions) || !S.versions.length) S.versions = [{ id: 1, ts: new Date().toISOString(), summary: "原始草稿（由需求文件建立）", days: clone(DATA.days) }];
  if (!S.partySize) S.partySize = DATA.meta.defaultPartySize;
  if (!S.interest) S.interest = {};
  if (!S.myVotes) S.myVotes = {};
  if (S.shareActive === undefined) S.shareActive = true;
  if (!S.shareToken) S.shareToken = Math.random().toString(36).slice(2, 10);
  save();

  const params = new URLSearchParams(location.search);
  const SHARE = params.get("view") === "share";
  const PREVIEW = params.get("preview") === "1";
  if (!Array.isArray(S.revoked)) S.revoked = [];
  // 原型限制：沒有伺服器，只能在同一個瀏覽器判斷連結是否已停用
  const shareBlocked = SHARE && !PREVIEW && (!S.shareActive || S.revoked.includes(params.get("t")));

  let currentDay = pickInitialDay();
  let dayMap = null, tripMap = null, dayLayer = null, tripLayer = null, tripSeg = "all";

  /* ---------- helpers ---------- */
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function parseDate(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
  function fmtDay(s) { const d = parseDate(s); return `${d.getMonth() + 1}/${d.getDate()}（${WD[d.getDay()]}）`; }
  function money(n) { return "AUD $" + Math.round(n).toLocaleString("en-AU"); }
  function mins(m) { if (!m) return "0 分"; const h = Math.floor(m / 60), r = m % 60; return (h ? h + " 小時" : "") + (r ? r + " 分" : ""); }
  function fmtTs(iso) { const d = new Date(iso); return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; }
  function todayStr() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
  function pickInitialDay() { const t = todayStr(); const i = S.days.findIndex((d) => d.date === t); return i >= 0 ? i : 0; }
  function badge(t, c) { return `<span class="badge ${c}">${esc(t)}</span>`; }
  function toast(msg) { const el = $("#toast"); el.textContent = msg; el.classList.add("show"); clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove("show"), 2600); }
  function driverLabel(d) { return SHARE ? "朋友" : d.needsDriver; }
  function stayOf(d) { return DATA.stays[d.stay] || DATA.stays.none; }

  function ask(title, bodyHtml, okText) {
    return new Promise((resolve) => {
      const dlg = $("#dlg");
      $("#dlg-title").textContent = title;
      $("#dlg-body").innerHTML = bodyHtml || "";
      $("#dlg-ok").textContent = okText || "確定";
      dlg.returnValue = "";
      const onClose = () => {
        dlg.removeEventListener("close", onClose);
        if (dlg.returnValue !== "ok") return resolve(null);
        const out = {};
        $$("input,select,textarea", $("#dlg-body")).forEach((el) => { out[el.name] = el.value; });
        resolve(out);
      };
      dlg.addEventListener("close", onClose);
      if (typeof dlg.showModal === "function") dlg.showModal();
      else resolve(window.confirm(title) ? {} : null);
      const first = $("input,select,textarea", $("#dlg-body"));
      if (first) first.focus();
    });
  }

  /* ---------- versioning (FR-07) ---------- */
  function commit(summary, mutate) {
    mutate(S.days);
    const id = Math.max.apply(null, S.versions.map((v) => v.id)) + 1;
    S.versions.unshift({ id, ts: new Date().toISOString(), summary, days: clone(S.days) });
    // 保留原始版本；其餘最多 60 筆
    if (S.versions.length > 60) { const orig = S.versions[S.versions.length - 1]; S.versions = S.versions.slice(0, 59).concat(orig); }
    save();
    renderAll();
    toast("已儲存為新版本 v" + id);
  }

  /* ---------- rules (PLANNING_RULES.md) ---------- */
  function checks(d) {
    const out = [];
    const majors = d.items.filter((i) => i.major).length;
    const heavy = d.transfer || d.ferry || d.hike;
    if (d.needsDriver && !d.driverOk) out.push({ lv: "warn", t: `此日依賴 ${driverLabel(d)} 開車，但日期與時段尚未確認：開車行程皆為「暫定」。`, alt: d.alt });
    if (d.needsDriver && d.driverOk) out.push({ lv: "ok", t: `司機已確認${d.driverWindow && !SHARE ? "（" + d.driverWindow + "）" : ""}。` });
    if (d.driveHrs > 3 && !d.transfer) out.push({ lv: "warn", t: `預估總開車約 ${d.driveHrs} 小時，超過一般日 2–3 小時的建議（提案中，待確認）。` });
    if (d.driveHrs > 3 && d.transfer) out.push({ lv: "info", t: `長途移動日（約 ${d.driveHrs} 小時車程），已減少活動量；請安排休息站。` });
    if (majors > 4) out.push({ lv: "warn", t: `主要活動 ${majors} 個，超過每日 3–4 個的彈性目標。` });
    else if (heavy && majors > 3) out.push({ lv: "warn", t: `當天有渡輪／健行／長途移動，主要活動 ${majors} 個可能太滿。` });
    const st = stayOf(d);
    if (st.nightly > 0 && st.status !== "confirmed") out.push({ lv: "info", t: `住宿「${st.area}」尚未預訂，價格為估計值。` });
    if (d.items.some((i) => i.cost && i.cost.status === "unknown")) out.push({ lv: "info", t: "部分費用未知，未計入總額。" });
    if (d.open && !d.items.length) out.push({ lv: "info", t: "尚未安排活動，可保留彈性休息或之後加入。" });
    return out;
  }
  function feasibility(d) {
    if (d.needsDriver && !d.driverOk) return "unverified";
    if (!d.items.length) return "unverified";
    const v = d.items.map((i) => i.verify);
    const warn = checks(d).some((c) => c.lv === "warn" || c.lv === "danger");
    if (v.every((x) => x === "verified") && !warn) return "verified";
    if (v.some((x) => x === "verified" || x === "partial")) return "partial";
    return "unverified";
  }
  const isTentative = (d, i) => d.needsDriver && !d.driverOk && i.mode === "drive";

  /* ---------- budget (FR-13〜17) ---------- */
  function lineAmount(c, N) {
    if (c.status === "unknown") return 0;
    if (c.unit === "pp") return c.amount * N;
    if (c.unit === "shared") { const p = Math.max(c.participants || N, N); return (c.amount * N) / p; }
    return c.amount;
  }
  function basis(c, N) {
    if (c.unit === "pp") return `每人 $${c.amount} × ${N} 人`;
    if (c.unit === "shared") { const p = Math.max(c.participants || N, N); return `共乘 $${c.amount} ÷ ${p} 人 × ${N} 人`; }
    if (c.unit === "night") return `每晚 $${c.amount}`;
    return `整組 $${c.amount}`;
  }
  function budgetLines(N) {
    const lines = [];
    S.days.forEach((d, idx) => {
      d.items.forEach((i) => { if (i.cost) lines.push({ day: d.date, seg: d.seg, idx, cat: i.cost.cat, label: i.name, c: i.cost }); });
      (d.costs || []).forEach((c, ci) => lines.push({ day: d.date, seg: d.seg, idx, ci, cat: c.cat, label: c.label, c }));
      const st = stayOf(d);
      if (d.stay !== "none") lines.push({ day: d.date, seg: d.seg, idx, cat: "stay", label: st.name, c: { amount: st.nightly, unit: "night", status: st.status, note: st.note } });
      const f = DATA.meta.foodPerPersonPerDay[d.seg];
      lines.push({ day: d.date, seg: d.seg, idx, cat: "food", label: "三餐", c: { amount: f, unit: "pp", status: "estimate", note: "每人每日估計" } });
    });
    lines.forEach((l) => { l.total = lineAmount(l.c, N); });
    return lines;
  }
  function dayTotal(idx, N) { return budgetLines(N).filter((l) => l.idx === idx).reduce((a, l) => a + l.total, 0); }

  /* ---------- header ---------- */
  function renderHero() {
    $("#trip-title").textContent = DATA.meta.title;
    $("#trip-sub").textContent = DATA.meta.subtitle;
    const t = parseDate(todayStr()), s = parseDate(DATA.meta.start), e = parseDate(DATA.meta.end);
    const day = 86400000;
    let when;
    if (t < s) when = `距離出發還有 ${Math.round((s - t) / day)} 天`;
    else if (t <= e) when = `旅程第 ${Math.round((t - s) / day) + 1} 天`;
    else when = "旅程已結束";
    const n = S.days.length;
    $("#hero-meta").innerHTML = [
      `🗓️ 10/25 – 11/26・${n} 天`, `📍 塔斯馬尼亞 + 雪梨（11/3–11/6）`, `⏱️ ${when}`
    ].map((x) => `<span class="chip-hero">${x}</span>`).join("");
    const btn = $("#mode-btn");
    if (SHARE) {
      btn.textContent = "返回擁有者模式";
      btn.hidden = !PREVIEW;
      btn.onclick = () => { location.href = location.pathname; };
    } else {
      btn.textContent = "👀 以訪客身分預覽";
      btn.onclick = () => { location.href = `${location.pathname}?view=share&t=${S.shareToken}&preview=1`; };
    }
    $$("[data-owner]").forEach((el) => { el.hidden = SHARE; });
    const bn = $("#share-banner");
    if (SHARE) { bn.hidden = false; bn.textContent = PREVIEW ? "訪客預覽：這是朋友打開分享連結時看到的唯讀畫面（住址與私人交通細節已隱藏）。" : "你正在檢視 Aya 的旅程（唯讀）。可以對活動按「我有興趣」！"; }
    $("#sync-line").textContent = `資料最後同步：${fmtTs(DATA.meta.lastSync)}（行程草稿建立時間）。目前沒有即時資料連線，所有資訊請視為離線副本。`;
  }

  /* ---------- overview ---------- */
  function renderOverview() {
    const N = S.partySize;
    const lines = budgetLines(N);
    const total = lines.reduce((a, l) => a + l.total, 0);
    const allItems = S.days.flatMap((d) => d.items);
    const must = allItems.filter((i) => i.pri === "must" && i.major);
    const pendingDriver = S.days.filter((d) => d.needsDriver && !d.driverOk);
    const openDays = S.days.filter((d) => !d.items.length);
    const paidNights = S.days.filter((d) => stayOf(d).nightly > 0 && stayOf(d).status !== "confirmed");
    const warnDays = S.days.filter((d) => checks(d).some((c) => c.lv === "warn"));

    const timeline = S.days.map((d, i) => {
      const w = checks(d).some((c) => c.lv === "warn");
      return `<button class="${d.seg} ${d.items.length ? "" : "open"} ${w ? "has-warn" : ""}" data-goto="${i}" title="${fmtDay(d.date)} ${esc(d.title)}" aria-label="${fmtDay(d.date)} ${esc(d.title)}${w ? "（有提醒）" : ""}"></button>`;
    }).join("");

    const todo = [];
    if (!SHARE && pendingDriver.length) todo.push(`與 Zayden、JJ 確認可開車的<strong>日期與時段</strong>（${pendingDriver.length} 天依賴司機）`);
    if (paidNights.length) todo.push(`預訂需付費住宿（${paidNights.length} 晚：東海岸、朗塞斯頓、搖籃山、雪梨）`);
    todo.push("預訂荷巴特 ⇄ 雪梨 來回機票（11/3 去、11/6 回）");
    todo.push("出發前查看國家公園、道路與天氣警示（見「資訊與警示」）");
    if (openDays.length) todo.push(`${openDays.length} 天尚未安排，可保留休息或加入新活動`);

    $("#tab-overview").innerHTML = `
      <div class="grid cols-4">
        <div class="card stat"><div class="num">${S.days.length}</div><div class="lbl">旅程天數</div></div>
        <div class="card stat"><div class="num">${must.length}</div><div class="lbl">必去活動</div></div>
        <div class="card stat"><div class="num">${money(total)}</div><div class="lbl">預估總花費（${N} 人，估計）</div></div>
        <div class="card stat"><div class="num">${warnDays.length}</div><div class="lbl">有提醒的日子</div></div>
      </div>

      <div class="card section">
        <h2>旅程時間軸</h2>
        <p class="muted small">每格一天。綠色為塔斯馬尼亞、橘色為雪梨；淡色為尚未安排；黃點代表有提醒。點一下即可查看當天。</p>
        <div class="timeline-mini">${timeline}</div>
        <div class="tl-axis"><span>10/25</span><span>11/3 雪梨</span><span>11/26</span></div>
      </div>

      <div class="grid cols-2 section">
        ${Object.entries(DATA.segments).map(([k, s]) => {
          const ds = S.days.filter((d) => d.seg === k);
          const segTotal = lines.filter((l) => l.seg === k).reduce((a, l) => a + l.total, 0);
          return `<div class="card seg-card"><span class="bar" style="background:${s.color}"></span>
            <h3>${s.name} <span class="muted small">${s.en}</span></h3>
            <p class="muted">${s.range}・${ds.length} 天・${ds.reduce((a, d) => a + d.items.filter((i) => i.major).length, 0)} 個主要活動</p>
            <p>預估花費 <strong>${money(segTotal)}</strong> <span class="badge b-warn">估計</span></p>
          </div>`;
        }).join("")}
      </div>

      <div class="grid cols-2 section">
        <div class="card">
          <h3>下一步待辦</h3>
          <ol class="todo-list">${todo.map((t) => `<li>${t}</li>`).join("")}</ol>
        </div>
        <div class="card">
          <h3>必去清單</h3>
          <ul class="todo-list">${must.map((i) => {
            const idx = S.days.findIndex((d) => d.items.includes(i));
            return `<li><a href="#" data-goto="${idx}">${fmtDay(S.days[idx].date)}</a> ${esc(i.name)}</li>`;
          }).join("")}</ul>
        </div>
      </div>

      ${SHARE ? "" : `<div class="card section">
        <h3>司機安排（未確認）</h3>
        <p class="muted small">依規則：司機的日期與時段確認之前，開車行程一律為「暫定」，並提供替代方案。</p>
        <div class="grid cols-2">
          ${Object.entries(DATA.drivers).map(([n, dr]) => {
            const ds = S.days.filter((d) => d.needsDriver === n);
            const ok = ds.filter((d) => d.driverOk).length;
            return `<div><strong>${esc(n)}</strong>・${dr.label}<br><span class="muted small">${dr.note}</span><br>${badge(`已確認 ${ok} / ${ds.length} 天`, ok === ds.length ? "b-ok" : "b-warn")}</div>`;
          }).join("")}
        </div>
      </div>`}
    `;
  }

  /* ---------- days ---------- */
  function renderDayStrip() {
    $("#day-strip").innerHTML = S.days.map((d, i) => {
      const dt = parseDate(d.date);
      const w = checks(d).some((c) => c.lv === "warn");
      return `<button class="day-chip" data-day="${i}" ${i === currentDay ? 'aria-current="true"' : ""}>
        <span class="d ${d.seg}">${dt.getMonth() + 1}/${dt.getDate()}<small>週${WD[dt.getDay()]}</small></span>
        <span class="t">${w ? '<span class="dot" aria-label="有提醒"></span>' : ""}${esc(d.title)}</span>
      </button>`;
    }).join("");
    const cur = $(`.day-chip[data-day="${currentDay}"]`);
    if (cur) cur.scrollIntoView({ block: "nearest", inline: "center", behavior: reduceMotion ? "auto" : "smooth" });
  }

  function legHtml(t) {
    if (!t) return "";
    const parts = Object.entries(t).filter(([, v]) => v > 0);
    if (!parts.length) return "";
    const total = parts.reduce((a, [, v]) => a + v, 0);
    return `<li class="leg">${parts.map(([k, v]) => `<span>${LEG[k] || k} ${mins(v)}</span>`).join("")}<span>・約 ${mins(total)}（估計）</span></li>`;
  }

  function renderDayDetail() {
    const d = S.days[currentDay];
    const N = S.partySize;
    const st = stayOf(d);
    const cs = checks(d);
    const fe = VERIFY[feasibility(d)];
    const warnN = cs.filter((c) => c.lv === "warn").length;
    const majors = d.items.filter((i) => i.major).length;
    const segName = DATA.segments[d.seg].name;

    const actHtml = d.items.map((i, k) => {
      const tent = isTentative(d, i);
      const voted = S.myVotes[i.id];
      const count = S.interest[i.id] || 0;
      const cost = i.cost ? `${i.cost.status === "unknown" ? "費用未知" : basis(i.cost, N) + " = " + money(lineAmount(i.cost, N))} ${badge(STATUS[i.cost.status].t, STATUS[i.cost.status].c)}` : "";
      return `${legHtml(i.travel)}
      <li class="act" data-act="${k}">
        <div class="pin ${d.seg}" aria-hidden="true">${k + 1}</div>
        <div class="body">
          <div class="top">
            <span class="time">${esc(i.time)}・${mins(i.dur)}</span>
            <span>${badge(PRI[i.pri].t, PRI[i.pri].c)} ${tent ? badge("暫定（司機未確認）", "b-warn") : ""} ${badge(VERIFY[i.verify].t, VERIFY[i.verify].c)}</span>
          </div>
          <h4>${esc(i.name)}</h4>
          <div class="en">${esc(i.en || "")}</div>
          <div class="meta">
            <span>${MODE[i.mode] || ""}</span>
            ${i.src ? `<span>來源：<a href="${esc(i.src.url)}" target="_blank" rel="noopener">${esc(i.src.label)}</a>${i.checked ? `（${esc(i.checked)} 查核）` : "（未查核）"}</span>` : ""}
            ${cost ? `<span>${cost}</span>` : ""}
          </div>
          ${i.note ? `<div class="note">💡 ${esc(i.note)}</div>` : ""}
          <div class="tools">
            <button class="btn ghost small" data-focus="${k}">🗺️ 地圖</button>
            ${SHARE ? `<span class="interest">
                <button class="btn small ${voted ? "ghost" : ""}" data-vote="${esc(i.id)}">${voted ? "✓ 已表達興趣（" + esc(voted.nick) + "）" : "🙋 我有興趣"}</button>
                ${voted ? `<button class="btn ghost small" data-unvote="${esc(i.id)}">收回</button>` : ""}
              </span>` : `
              <label class="small">優先度
                <select data-pri="${k}">${Object.entries(PRI).map(([v, p]) => `<option value="${v}" ${v === i.pri ? "selected" : ""}>${p.t}</option>`).join("")}</select>
              </label>
              <button class="btn ghost small" data-verify="${k}">${i.verify === "verified" ? "取消查核" : "✓ 標記已查核"}</button>
              <button class="btn ghost small" data-del="${k}">移除</button>
              ${count ? `<span class="count-pill" title="訪客興趣（合計）">🙋 ${count}</span>` : ""}`}
          </div>
        </div>
      </li>`;
    }).join("");

    const shared = (d.costs || []).filter((c) => c.unit === "shared");
    const sharedHtml = shared.length ? `<div class="card section">
        <h3>共乘費用分攤</h3>
        ${shared.map((c) => {
          const ci = d.costs.indexOf(c);
          return `<p>${esc(c.label)}：${basis(c, N)} = <strong>${money(lineAmount(c, N))}</strong> ${badge(STATUS[c.status].t, STATUS[c.status].c)}
          ${SHARE ? "" : `<br><label class="small">這段車程的參與人數（含司機）<input type="number" min="1" max="12" value="${c.participants}" data-part="${ci}" style="width:70px"></label>`}</p>`;
        }).join("")}
        <p class="muted small">規則：油資、停車、渡輪等車輛費用只由該段車程的參與者分攤。</p>
      </div>` : "";

    $("#day-detail").innerHTML = `
      <div class="day-head">
        <div>
          <div class="day-date">第 ${currentDay + 1} 天・${fmtDay(d.date)}・${segName}</div>
          <h2>${esc(d.title)}</h2>
        </div>
        <div class="day-nav">
          <button class="btn ghost small" data-step="-1" ${currentDay === 0 ? "disabled" : ""} aria-label="前一天">← 前一天</button>
          <button class="btn ghost small" data-step="1" ${currentDay === S.days.length - 1 ? "disabled" : ""} aria-label="後一天">後一天 →</button>
        </div>
      </div>
      <div class="day-badges">
        ${badge(segName, "b-" + d.seg)}
        ${badge("可行性：" + fe.t, fe.c)}
        ${badge(warnN ? `規劃檢查：${warnN} 項提醒` : "規劃檢查：無警示", warnN ? "b-warn" : "b-ok")}
        ${d.needsDriver ? badge(d.driverOk ? `司機：${driverLabel(d)} 已確認` : `司機：${driverLabel(d)}（未確認）`, d.driverOk ? "b-ok" : "b-warn") : ""}
        ${d.transfer ? badge("移動日", "b-info") : ""}${d.ferry ? badge("渡輪", "b-info") : ""}${d.hike ? badge("步道", "b-info") : ""}
      </div>
      <div class="day-facts">
        <div class="fact"><div class="k">主要活動</div><div class="v">${majors} 個</div></div>
        <div class="fact"><div class="k">預估開車</div><div class="v">${d.driveHrs ? "約 " + d.driveHrs + " 小時" : "不開車"}</div></div>
        <div class="fact"><div class="k">當日花費（${N} 人）</div><div class="v">${money(dayTotal(currentDay, N))}</div></div>
        <div class="fact"><div class="k">今晚住宿</div><div class="v">${esc(st.area || st.name)}</div></div>
      </div>
      ${st.name && d.stay !== "none" ? `<p class="small muted">🏠 ${esc(st.name)}${!SHARE && st.address ? "・地址：" + esc(st.address) : "・確切地址已隱藏"}${st.note ? "・" + esc(st.note) : ""}</p>` : ""}
      ${cs.map((c) => `<div class="alert ${c.lv}"><span class="ic">${c.lv === "warn" ? "⚠️" : c.lv === "ok" ? "✅" : c.lv === "danger" ? "⛔" : "ℹ️"}</span><div><p>${esc(c.t)}</p>${c.alt ? `<p class="small"><strong>替代方案：</strong>${esc(c.alt)}</p>` : ""}</div></div>`).join("")}
      ${!SHARE && d.needsDriver ? `<p><button class="btn small ${d.driverOk ? "ghost" : ""}" data-driver="1">${d.driverOk ? "改回未確認" : "✓ 確認司機與時段"}</button></p>` : ""}
      ${d.items.length ? `<ol class="acts">${actHtml}</ol>` : `<div class="empty-day">這天還沒有安排活動。${SHARE ? "" : "<br>可以保留休息，或新增活動。"}</div>`}
      ${SHARE ? "" : `<p><button class="btn ghost" data-add="1">＋ 新增活動</button></p>`}
      ${sharedHtml}
    `;
    renderDayMap();
  }

  /* ---------- maps ---------- */
  function mapAvailable() { return typeof window.L !== "undefined"; }
  function tiles() {
    return L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "&copy; OpenStreetMap contributors" });
  }
  function numIcon(n, seg) { return L.divIcon({ className: "num-marker " + seg, html: String(n), iconSize: [26, 26] }); }
  function segColor(seg) { return getComputedStyle(document.documentElement).getPropertyValue(seg === "syd" ? "--syd" : "--tas").trim(); }

  function renderDayMap() {
    const box = $("#day-map");
    const d = S.days[currentDay];
    $("#day-map-note").textContent = "路線為點對點直線示意，非實際道路；實際路線與時間請以導航為準。";
    if (!mapAvailable()) { box.innerHTML = `<div class="map-fallback">地圖無法載入（可能離線）。<br>行程內容不受影響。</div>`; return; }
    if ($("#tab-days").hidden) return;
    if (!dayMap) { dayMap = L.map(box, { scrollWheelZoom: false, zoomAnimation: !reduceMotion }).setView([-42.88, 147.33], 9); tiles().addTo(dayMap); }
    if (dayLayer) dayLayer.remove();
    dayLayer = L.layerGroup().addTo(dayMap);
    const pts = d.items.filter((i) => i.lat).map((i) => [i.lat, i.lng]);
    const st = d.stay === "utas" ? [-42.8826, 147.3257] : null;
    d.items.forEach((i, k) => {
      if (!i.lat) return;
      L.marker([i.lat, i.lng], { icon: numIcon(k + 1, d.seg), keyboard: true, title: i.name }).addTo(dayLayer)
        .bindPopup(`<strong>${esc(i.time)} ${esc(i.name)}</strong><br>${esc(i.en || "")}<br>${PRI[i.pri].t}`);
    });
    if (pts.length > 1) {
      const line = L.polyline(pts, { color: segColor(d.seg), weight: 4, opacity: .85, className: "route-anim", dashArray: null }).addTo(dayLayer);
      line.bringToBack();
    }
    dayMap.invalidateSize();
    if (pts.length) dayMap.flyToBounds(L.latLngBounds(pts.concat(st && d.seg === "tas" ? [st] : [])).pad(0.25), { maxZoom: 13, animate: !reduceMotion, duration: 1.2 });
    else dayMap.setView(d.seg === "syd" ? [-33.87, 151.21] : [-42.88, 147.33], 11);
  }

  function renderTripMap() {
    const box = $("#trip-map");
    $("#map-legend").innerHTML = `
      <button class="btn small ${tripSeg === "all" ? "" : "ghost"}" data-seg="all">全部</button>
      <button class="btn small ${tripSeg === "tas" ? "" : "ghost"}" data-seg="tas">塔斯馬尼亞</button>
      <button class="btn small ${tripSeg === "syd" ? "" : "ghost"}" data-seg="syd">雪梨</button>`;
    $("#trip-map-note").textContent = "點地圖上的地點可跳到當天行程。路線為直線示意。";
    $("#map-text").innerHTML = S.days.map((d, i) => `<li><a href="#" data-goto="${i}">${fmtDay(d.date)} ${esc(d.title)}</a>${d.items.length ? "：" + d.items.map((x) => esc(x.name)).join(" → ") : ""}</li>`).join("");
    if (!mapAvailable()) { box.innerHTML = `<div class="map-fallback">地圖無法載入（可能離線）。<br>請展開下方「文字版路線」。</div>`; return; }
    if ($("#tab-map").hidden) return;
    if (!tripMap) { tripMap = L.map(box, { zoomAnimation: !reduceMotion }).setView([-38, 147], 5); tiles().addTo(tripMap); }
    if (tripLayer) tripLayer.remove();
    tripLayer = L.layerGroup().addTo(tripMap);
    const all = [];
    S.days.forEach((d, idx) => {
      if (tripSeg !== "all" && d.seg !== tripSeg) return;
      // 只畫屬於該目的地的點（航班另一端的機場不連線）
      const inSeg = (i) => i.lat && (i.lat > -40) === (d.seg === "syd");
      const pts = d.items.filter(inSeg).map((i) => [i.lat, i.lng]);
      if (pts.length > 1) L.polyline(pts, { color: segColor(d.seg), weight: 3, opacity: .7, className: "route-anim" }).addTo(tripLayer);
      d.items.forEach((i) => {
        if (!inSeg(i)) return;
        all.push([i.lat, i.lng]);
        L.circleMarker([i.lat, i.lng], { radius: i.pri === "must" ? 7 : 5, color: "#fff", weight: 2, fillColor: segColor(d.seg), fillOpacity: 1 })
          .addTo(tripLayer)
          .bindPopup(`<strong>${fmtDay(d.date)}</strong> ${esc(d.title)}<br>${esc(i.name)}<br><a href="#" data-goto="${idx}">查看當天 →</a>`);
      });
    });
    tripMap.invalidateSize();
    if (all.length) tripMap.flyToBounds(L.latLngBounds(all).pad(0.1), { animate: !reduceMotion, duration: 1.4 });
  }

  /* ---------- budget ---------- */
  function renderBudget() {
    const N = S.partySize;
    const lines = budgetLines(N);
    const total = lines.reduce((a, l) => a + l.total, 0);
    const byCat = {};
    lines.forEach((l) => { byCat[l.cat] = (byCat[l.cat] || 0) + l.total; });
    const max = Math.max.apply(null, Object.values(byCat).concat([1]));
    const est = lines.filter((l) => l.c.status === "estimate" && l.total > 0).reduce((a, l) => a + l.total, 0);
    const unknown = lines.filter((l) => l.c.status === "unknown").length;

    const rows = lines.filter((l) => l.total > 0 || l.c.status === "unknown" || l.cat === "stay").map((l) => `<tr>
      <td>${fmtDay(l.day)}</td><td><span class="cat-dot" style="background:${CATS[l.cat].color}"></span>${CATS[l.cat].t}</td>
      <td>${esc(l.label)}${l.c.note ? `<br><span class="muted small">${esc(l.c.note)}</span>` : ""}</td>
      <td class="small">${l.c.status === "unknown" ? "—" : l.c.unit === "night" ? (l.c.amount ? `每晚 $${l.c.amount}` : "$0") : basis(l.c, N)}</td>
      <td>${badge(STATUS[l.c.status].t, STATUS[l.c.status].c)}</td>
      <td class="num">${l.c.status === "unknown" ? "未知" : money(l.total)}</td></tr>`).join("");

    $("#tab-budget").innerHTML = `
      <div class="card">
        <div class="party">
          <label for="party">同行人數（本組）</label>
          <input id="party" type="number" min="1" max="10" value="${N}" ${SHARE ? "disabled" : ""}>
          <span class="muted small">改人數後，每人費用、共乘分攤會自動重算。</span>
        </div>
        ${N > 2 ? `<div class="alert info"><span class="ic">ℹ️</span><p>UTAS Hobart Apartments 的 AUD $0 只適用擁有者與 Aya；其他同行者的住宿尚未列入，需另外估算。</p></div>` : ""}
      </div>
      <div class="grid cols-4 section">
        <div class="card stat"><div class="num">${money(total)}</div><div class="lbl">全程總額（${N} 人）</div></div>
        <div class="card stat"><div class="num">${money(total / N)}</div><div class="lbl">每人平均</div></div>
        <div class="card stat"><div class="num">${money(total / S.days.length)}</div><div class="lbl">每日平均（整組）</div></div>
        <div class="card stat"><div class="num">${Math.round((est / (total || 1)) * 100)}%</div><div class="lbl">屬於估計值的比例${unknown ? `・${unknown} 項未知` : ""}</div></div>
      </div>
      <div class="grid cols-2 section">
        <div class="card">
          <h3>分類</h3>
          <div class="bars">${Object.keys(CATS).filter((k) => byCat[k]).map((k) => `<div class="bar-row"><span>${CATS[k].t}</span><div class="bar-track"><div class="bar-fill" style="width:${(byCat[k] / max) * 100}%;background:${CATS[k].color}"></div></div><span class="num" style="text-align:right">${money(byCat[k])}</span></div>`).join("")}</div>
        </div>
        <div class="card">
          <h3>目的地</h3>
          <div class="bars">${Object.entries(DATA.segments).map(([k, s]) => { const v = lines.filter((l) => l.seg === k).reduce((a, l) => a + l.total, 0); return `<div class="bar-row"><span>${s.name}</span><div class="bar-track"><div class="bar-fill" style="width:${(v / (total || 1)) * 100}%;background:${s.color}"></div></div><span class="num" style="text-align:right">${money(v)}</span></div>`; }).join("")}</div>
          <p class="muted small">不套用固定誤差百分比；每筆都列出計算基礎與狀態。抵達澳洲與離開的國際機票未列入。</p>
        </div>
      </div>
      <div class="card section">
        <h3>逐項明細</h3>
        <div class="table-wrap"><table>
          <thead><tr><th>日期</th><th>分類</th><th>項目</th><th>計算基礎</th><th>狀態</th><th class="num">金額</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr><th colspan="5">合計</th><th class="num">${money(total)}</th></tr></tfoot>
        </table></div>
      </div>`;
  }

  /* ---------- info ---------- */
  function renderInfo() {
    const legend = (obj) => Object.values(obj).map((v) => badge(v.t, v.c)).join(" ");
    $("#tab-info").innerHTML = `
      <div class="alert warn"><span class="ic">⚠️</span><p><strong>目前沒有即時資料連線。</strong>以下為官方來源連結，出發前與每天出門前請手動查看道路、國家公園與天氣警示。網站不會把舊資料當成最新資訊。</p></div>
      <div class="grid cols-2 section">
        <div class="card">
          <h3>官方警示與交通來源</h3>
          <ul class="src-list">${DATA.alertsSources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a><span class="badge b-line">${esc(s.kind)}</span></li>`).join("")}</ul>
          <p class="muted small">最後已知警示狀態：未連線（未查詢）。</p>
        </div>
        <div class="card">
          <h3>標籤說明</h3>
          <p><strong>活動優先度</strong><br>${legend(PRI)}</p>
          <p class="small muted">必去：不會被默默移除，衝突時會請你決定。優先：條件允許時優先安排。可替換：天氣或交通變動時第一個被替換。</p>
          <p><strong>可行性</strong><br>${legend(VERIFY)}</p>
          <p class="small muted">標籤只描述目前證據，不保證行程一定能照計畫進行。已知封閉或不可能的轉乘不會被標為可執行。</p>
          <p><strong>費用狀態</strong><br>${legend(STATUS)}</p>
        </div>
      </div>
      <div class="grid cols-2 section">
        <div class="card">
          <h3>規劃原則</h3>
          <ul class="todo-list">
            <li>每天 3–4 個主要活動是彈性目標，移動日、渡輪日、健行日會減量。</li>
            <li>一般開車日以總車程 2–3 小時為準（提案中，待確認），移動日例外但需安排休息。</li>
            <li>司機的日期與時段確認前，不依賴朋友開車。</li>
            <li>任何變更都保留原始行程，確認後才套用並重新檢查。</li>
            <li>網站只提供外部預訂連結，不會代為預訂或付款。</li>
          </ul>
        </div>
        <div class="card">
          <h3>隱私</h3>
          <ul class="todo-list">
            <li>分享連結為唯讀，預設隱藏確切住宿地址與司機等私人交通細節。</li>
            <li>即使隱藏地址，分享連結仍會透露旅行日期與活動模式，分享前請先檢查。</li>
            <li>訪客表達興趣只需暱稱；擁有者只看到合計人數。</li>
            <li>已下載或截圖的離線副本無法收回。</li>
          </ul>
        </div>
      </div>
      ${SHARE ? "" : `<div class="card section">
        <h3>尚未決定的事項（TBD）</h3>
        <ul class="todo-list">
          <li>Zayden、JJ 可開車的確切日期與時段、乘客與路線限制</li>
          <li>需付費住宿的晚數與每晚／全程預算上限</li>
          <li>開車時數上限與休息規則</li>
          <li>登入與帳號找回方式、資料更新頻率、重大警示的定義</li>
          <li>哪些資料第一版要即時、哪些用估計或外部連結</li>
        </ul>
      </div>`}`;
  }

  /* ---------- manage (owner) ---------- */
  function renderManage() {
    if (SHARE) { $("#tab-manage").innerHTML = ""; return; }
    const url = `${location.origin === "null" || location.protocol === "file:" ? location.href.split("?")[0] : location.origin + location.pathname}?view=share&t=${S.shareToken}`;
    const interestRows = S.days.flatMap((d) => d.items.filter((i) => S.interest[i.id]).map((i) => `<tr><td>${fmtDay(d.date)}</td><td>${esc(i.name)}</td><td class="num">${S.interest[i.id]}</td></tr>`)).join("");
    $("#tab-manage").innerHTML = `
      <div class="grid cols-2">
        <div class="card">
          <h3>分享連結（唯讀）</h3>
          <p>${S.shareActive ? badge("啟用中", "b-ok") : badge("已停用", "b-danger")}</p>
          <div class="share-url"><input id="share-url" value="${esc(url)}" readonly aria-label="分享連結"><button class="btn small" id="copy-share">複製</button></div>
          <p class="small muted">訪客不需帳號即可查看並表達興趣。分享前請先用「以訪客身分預覽」檢查內容。</p>
          <p><button class="btn ${S.shareActive ? "danger" : ""} small" id="toggle-share">${S.shareActive ? "停用分享連結" : "重新啟用"}</button>
             <button class="btn ghost small" id="new-token">產生新連結（舊連結失效）</button></p>
          <p class="small muted">原型限制：目前沒有伺服器，分享狀態與興趣回覆只存在這個瀏覽器；要讓朋友真正使用需要之後選定的後端服務。</p>
        </div>
        <div class="card">
          <h3>訪客興趣（合計）</h3>
          ${interestRows ? `<div class="table-wrap"><table><thead><tr><th>日期</th><th>活動</th><th class="num">人數</th></tr></thead><tbody>${interestRows}</tbody></table></div>` : `<p class="muted">還沒有人表達興趣。</p>`}
        </div>
      </div>
      <div class="card section">
        <h3>版本紀錄</h3>
        <p class="small muted">每次修改都會自動存成新版本；還原會建立新的版本，原有紀錄不會被覆蓋。</p>
        <p><button class="btn small" id="snap">＋ 存一個命名版本</button> <button class="btn ghost small" id="export">⬇︎ 下載行程備份（JSON）</button></p>
        <ul class="ver-list">${S.versions.map((v, k) => `<li>
          <div><strong>v${v.id}</strong> ${esc(v.summary)}<br><span class="muted small">${fmtTs(v.ts)}</span></div>
          ${k === 0 ? badge("目前版本", "b-ok") : `<button class="btn ghost small" data-restore="${v.id}">還原</button>`}
        </li>`).join("")}</ul>
      </div>
      <div class="card section">
        <h3>離線使用</h3>
        <p>行程、預算、來源連結都在這個網站資料夾內，沒有網路也能開啟 <code>index.html</code> 查看（地圖底圖與字型需要網路）。畫面底部會顯示最後同步時間，離線內容不代表最新狀態。</p>
        <p><button class="btn ghost small" id="print">🖨️ 列印／存成 PDF</button> <button class="btn ghost small" id="reset">清除本機修改</button></p>
      </div>`;
  }

  /* ---------- tabs & render ---------- */
  let activeTab = "overview";
  function showTab(name) {
    if (SHARE && name === "manage") name = "overview";
    activeTab = name;
    $$(".tabs [role=tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
    $$(".panel").forEach((p) => { p.hidden = p.id !== "tab-" + name; });
    if (name === "days") { renderDayDetail(); setTimeout(() => dayMap && dayMap.invalidateSize(), 50); }
    if (name === "map") { renderTripMap(); setTimeout(() => tripMap && tripMap.invalidateSize(), 50); }
    try { sessionStorage.setItem(KEY + "-tab", name); } catch (e) { /* ignore */ }
  }
  function gotoDay(i) { currentDay = Math.max(0, Math.min(S.days.length - 1, i)); renderDayStrip(); showTab("days"); window.scrollTo({ top: $(".tabs").offsetTop, behavior: reduceMotion ? "auto" : "smooth" }); }

  function renderAll() {
    renderHero();
    renderOverview();
    renderDayStrip();
    renderDayDetail();
    renderBudget();
    renderInfo();
    renderManage();
    if (activeTab === "map") renderTripMap();
  }

  /* ---------- events ---------- */
  document.addEventListener("click", async (e) => {
    const t = e.target.closest("button, a");
    if (!t) return;
    const ds = t.dataset;
    const d = S.days[currentDay];

    if (ds.tab) return showTab(ds.tab);
    if (ds.goto !== undefined) { e.preventDefault(); if (tripMap) tripMap.closePopup(); return gotoDay(Number(ds.goto)); }
    if (ds.day !== undefined) { currentDay = Number(ds.day); renderDayStrip(); renderDayDetail(); return; }
    if (ds.step) { currentDay += Number(ds.step); renderDayStrip(); renderDayDetail(); return; }
    if (ds.seg) { tripSeg = ds.seg; return renderTripMap(); }
    if (ds.focus !== undefined) {
      const i = d.items[Number(ds.focus)];
      if (dayMap && i.lat) { dayMap.flyTo([i.lat, i.lng], 14, { animate: !reduceMotion }); dayLayer.eachLayer((l) => { if (l.getLatLng && l.options.title === i.name) l.openPopup(); }); }
      $$(".act").forEach((a) => a.classList.toggle("active", a.dataset.act === ds.focus));
      return;
    }

    if (SHARE) {
      if (ds.vote) {
        const id = ds.vote;
        const prev = S.myVotes[id];
        const r = await ask(prev ? "修改暱稱" : "我有興趣！", `<p class="small muted">只需要暱稱，擁有者只會看到合計人數。</p><div class="field"><label for="nick">暱稱</label><input id="nick" name="nick" maxlength="20" required value="${esc(prev ? prev.nick : "")}"></div>`, "送出");
        if (!r || !r.nick.trim()) return;
        if (!prev) S.interest[id] = (S.interest[id] || 0) + 1;
        S.myVotes[id] = { nick: r.nick.trim().slice(0, 20), ts: new Date().toISOString() };
        save(); renderDayDetail(); toast("已送出，謝謝！");
        return;
      }
      if (ds.unvote) {
        const id = ds.unvote;
        if (S.myVotes[id]) { delete S.myVotes[id]; S.interest[id] = Math.max(0, (S.interest[id] || 1) - 1); save(); renderDayDetail(); toast("已收回"); }
        return;
      }
      return;
    }

    /* owner actions */
    if (ds.verify !== undefined) {
      const k = Number(ds.verify), i = d.items[k];
      const on = i.verify !== "verified";
      return commit(`${fmtDay(d.date)}「${i.name}」${on ? "標記為已查核" : "取消查核"}`, (days) => {
        const it = days[currentDay].items[k];
        it.verify = on ? "verified" : "unverified";
        it.checked = on ? todayStr() : undefined;
      });
    }
    if (ds.del !== undefined) {
      const k = Number(ds.del), i = d.items[k];
      const r = await ask(i.pri === "must" ? "移除必去活動？" : "移除活動？", `<p>${i.pri === "must" ? "「" + esc(i.name) + "」是<strong>必去</strong>活動。依規則，必去活動不會被默默移除。確定要移除嗎？" : "確定移除「" + esc(i.name) + "」？"}</p><p class="small muted">移除後仍可從版本紀錄還原。</p>`, "移除");
      if (!r) return;
      return commit(`${fmtDay(d.date)} 移除「${i.name}」`, (days) => { days[currentDay].items.splice(k, 1); });
    }
    if (ds.driver) {
      if (d.driverOk) return commit(`${fmtDay(d.date)} 司機改回未確認`, (days) => { days[currentDay].driverOk = false; days[currentDay].driverWindow = ""; });
      const r = await ask(`確認 ${d.needsDriver} 的開車時段`, `<p class="small muted">確認日期與時段後，當天開車行程才會從「暫定」變成可執行。</p><div class="field"><label for="win">可開車時段</label><input id="win" name="win" placeholder="例如 08:30–18:00" required></div>`, "確認");
      if (!r || !r.win.trim()) return;
      return commit(`${fmtDay(d.date)} 確認 ${d.needsDriver} 開車 ${r.win.trim()}`, (days) => { days[currentDay].driverOk = true; days[currentDay].driverWindow = r.win.trim(); });
    }
    if (ds.add) {
      const r = await ask(`新增活動・${fmtDay(d.date)}`, `
        <div class="field"><label for="n">活動名稱</label><input id="n" name="name" required maxlength="60"></div>
        <div class="field"><label for="tm">開始時間</label><input id="tm" name="time" type="time" value="10:00"></div>
        <div class="field"><label for="du">停留（分鐘）</label><input id="du" name="dur" type="number" min="15" step="15" value="90"></div>
        <div class="field"><label for="pr">優先度</label><select id="pr" name="pri"><option value="pref">優先</option><option value="must">必去</option><option value="repl">可替換</option></select></div>
        <div class="field"><label for="md">交通方式</label><select id="md" name="mode">${Object.entries(MODE).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div>
        <div class="field"><label for="co">每人估計費用（AUD，可留空）</label><input id="co" name="cost" type="number" min="0"></div>
        <div class="field"><label for="url">官方連結（可留空）</label><input id="url" name="url" type="url" placeholder="https://"></div>`, "新增");
      if (!r || !r.name.trim()) return;
      return commit(`${fmtDay(d.date)} 新增「${r.name.trim()}」`, (days) => {
        const day = days[currentDay];
        const it = { id: "u" + Date.now().toString(36), time: r.time || "10:00", dur: Number(r.dur) || 60, name: r.name.trim(), en: "", pri: r.pri, major: true, mode: r.mode, travel: {}, verify: "unverified", note: "使用者新增，位置未設定" };
        if (/^https?:\/\//.test(r.url)) it.src = { label: "官方連結", url: r.url };
        if (r.cost !== "") it.cost = { cat: "tickets", amount: Number(r.cost), unit: "pp", status: "estimate" };
        day.items.push(it);
        day.items.sort((a, b) => a.time.localeCompare(b.time));
        day.open = false;
      });
    }
    if (ds.restore) {
      const v = S.versions.find((x) => String(x.id) === ds.restore);
      const r = await ask(`還原到 v${v.id}？`, `<p>「${esc(v.summary)}」</p><p class="small muted">會建立一個新版本，現有紀錄都會保留。</p>`, "還原");
      if (!r) return;
      return commit(`還原至 v${v.id}（${v.summary}）`, (days) => { days.splice(0, days.length, ...clone(v.days)); });
    }
    if (t.id === "snap") {
      const r = await ask("存一個命名版本", `<div class="field"><label for="sm">版本說明</label><input id="sm" name="s" required maxlength="60" placeholder="例如：和 Aya 討論後的版本"></div>`, "儲存");
      if (!r || !r.s.trim()) return;
      return commit(r.s.trim(), () => {});
    }
    if (t.id === "copy-share") { const inp = $("#share-url"); inp.select(); try { await navigator.clipboard.writeText(inp.value); toast("已複製連結"); } catch (err) { document.execCommand("copy"); toast("已複製連結"); } return; }
    if (t.id === "toggle-share") { S.shareActive = !S.shareActive; save(); renderManage(); toast(S.shareActive ? "分享連結已啟用" : "分享連結已停用"); return; }
    if (t.id === "new-token") { S.revoked.push(S.shareToken); S.shareToken = Math.random().toString(36).slice(2, 10); save(); renderManage(); toast("已產生新連結，舊連結失效"); return; }
    if (t.id === "export") {
      const blob = new Blob([JSON.stringify({ exported: new Date().toISOString(), partySize: S.partySize, days: S.days, versions: S.versions.map((v) => ({ id: v.id, ts: v.ts, summary: v.summary })) }, null, 2)], { type: "application/json" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `aya-trip-backup-${todayStr()}.json`; a.click(); URL.revokeObjectURL(a.href);
      return;
    }
    if (t.id === "print") return window.print();
    if (t.id === "reset") {
      const r = await ask("清除本機修改？", "<p>會清除這個瀏覽器中的所有修改、版本紀錄與興趣回覆，回到原始草稿。這個動作無法復原。</p>", "清除");
      if (!r) return;
      try { localStorage.removeItem(KEY); } catch (err) { /* ignore */ }
      location.reload();
    }
  });

  document.addEventListener("change", (e) => {
    const t = e.target;
    if (SHARE) return;
    const d = S.days[currentDay];
    if (t.id === "party") { S.partySize = Math.max(1, Math.min(10, Number(t.value) || 1)); save(); renderAll(); return; }
    if (t.dataset.pri !== undefined) {
      const k = Number(t.dataset.pri), i = d.items[k];
      return commit(`${fmtDay(d.date)}「${i.name}」優先度 ${PRI[i.pri].t} → ${PRI[t.value].t}`, (days) => { days[currentDay].items[k].pri = t.value; });
    }
    if (t.dataset.part !== undefined) {
      const ci = Number(t.dataset.part), c = d.costs[ci];
      const p = Math.max(1, Math.min(12, Number(t.value) || 1));
      return commit(`${fmtDay(d.date)}「${c.label}」分攤人數 ${c.participants} → ${p}`, (days) => { days[currentDay].costs[ci].participants = p; });
    }
  });

  document.addEventListener("keydown", (e) => {
    if (activeTab !== "days" || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) || $("#dlg").open) return;
    if (e.key === "ArrowRight" && currentDay < S.days.length - 1) { currentDay++; renderDayStrip(); renderDayDetail(); }
    if (e.key === "ArrowLeft" && currentDay > 0) { currentDay--; renderDayStrip(); renderDayDetail(); }
  });

  /* ---------- boot ---------- */
  if (shareBlocked) {
    $("#main").innerHTML = `<div class="card"><h2>此分享連結已停用</h2><p class="muted">請向行程擁有者索取新的連結。</p></div>`;
    $(".tabs").hidden = true;
    renderHero();
    return;
  }
  renderAll();
  let startTab = "overview";
  try { startTab = sessionStorage.getItem(KEY + "-tab") || "overview"; } catch (e) { /* ignore */ }
  showTab(startTab);
})();
