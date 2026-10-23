"use client";

import { useEffect, useState } from "react";
import { useTrip } from "./TripApp";
import { Icon, MODE_ICON } from "./Icon";
import { Badge, LEG, MODE, PRI, STATUS, VERIFY } from "./ui";
import { DayCalendar } from "./DayCalendar";
import { ActPhoto, PhotoViewer, mapsPhotoLink, type DayPhoto } from "./Photos";
import { DayMap } from "./MapViews";
import { effectiveDay, isTentative } from "@/domain/effective-day";
import { checks, feasibility } from "@/domain/rules";
import { basis, dayTotal, lineAmount, stayOf } from "@/domain/budget";
import { fmtDay, mins, money } from "@/domain/format";
import type { Item } from "@/domain/schema";

function Legs({ travel }: { travel: Item["travel"] }) {
  const parts = Object.entries(travel ?? {}).filter(([, v]) => (v ?? 0) > 0) as [string, number][];
  if (!parts.length) return null;
  const total = parts.reduce((a, [, v]) => a + v, 0);
  return (
    <li className="leg">
      {parts.map(([k, v]) => (
        <span key={k}>
          <Icon name={MODE_ICON[k] ?? "route"} size={16} /> {LEG[k] ?? k} {mins(v)}
        </span>
      ))}
      <span>・約 {mins(total)}（估計）</span>
    </li>
  );
}

export function DaysView({ active }: { active: boolean }) {
  const { doc, mode, currentDay, setCurrentDay, runOp, ask, online, myVotes, vote, unvote, counts, canVote } = useTrip();
  const [focusId, setFocusId] = useState<string | null>(null);
  const [viewer, setViewer] = useState<number | null>(null);
  const owner = mode === "owner";
  const editable = owner && online;
  const raw = doc.days[currentDay];
  const d = effectiveDay(raw);
  const N = doc.partySize;
  const st = stayOf(doc, d.stay);
  const cs = checks(doc, d, { showWindow: owner });
  const fe = VERIFY[feasibility(doc, d)];
  const warnN = cs.filter((c) => c.lv === "warn").length;
  const majors = d.items.filter((i) => i.major).length;
  const seg = doc.segments[d.seg];
  const dayPhotos: DayPhoto[] = d.items.flatMap((i) => (i.photo ? [{ id: i.id, name: i.name, photo: i.photo }] : []));

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      // The tablist handles its own arrows (RV-02).
      if (e.defaultPrevented || (e.target as HTMLElement).closest?.('[role="tablist"]')) return;
      const el = document.activeElement;
      if (el && /INPUT|SELECT|TEXTAREA/.test(el.tagName)) return;
      if (document.querySelector("dialog[open]")) return;
      if (e.key === "ArrowRight" && currentDay < doc.days.length - 1) setCurrentDay(currentDay + 1);
      if (e.key === "ArrowLeft" && currentDay > 0) setCurrentDay(currentDay - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, currentDay, doc.days.length, setCurrentDay]);

  const countOf = (id: string) => counts?.current.find((c) => c.itemId === id && c.dayDate === d.date)?.count ?? 0;

  async function editItem(it: Item) {
    const r = await ask(`修改活動・${fmtDay(d.date)}`, {
      fields: [
        { name: "name", label: "活動名稱", value: it.name, required: true, maxLength: 120 },
        { name: "time", label: "開始時間", type: "time", value: it.time },
        { name: "dur", label: "停留（分鐘）", type: "number", value: String(it.dur), min: 0, step: 15 },
        { name: "mode", label: "交通方式", type: "select", value: it.mode, options: Object.entries(MODE).map(([value, label]) => ({ value, label })) },
        { name: "note", label: "備註", value: it.note ?? "", maxLength: 500 },
        { name: "photoUrl", label: "照片網址（https，留空表示不顯示照片）", value: it.photo?.url ?? "", maxLength: 2000 },
        { name: "amount", label: "費用金額（AUD，留空表示沒有費用）", type: "number", value: it.cost ? String(it.cost.amount) : "", min: 0 },
        { name: "unit", label: "費用單位", type: "select", value: it.cost?.unit ?? "pp", options: [{ value: "pp", label: "每人" }, { value: "group", label: "整組" }, { value: "shared", label: "共乘分攤" }] },
        { name: "status", label: "費用狀態", type: "select", value: it.cost?.status ?? "estimate", options: Object.entries(STATUS).map(([value, s]) => ({ value, label: s.t })) },
      ],
      ok: "儲存",
    });
    if (!r) return;
    await runOp({
      op: "editItem",
      date: d.date,
      itemId: it.id,
      fields: {
        name: r.name,
        time: r.time,
        dur: Number(r.dur),
        mode: r.mode,
        note: r.note,
        photoUrl: r.photoUrl,
        cost: r.amount === "" ? null : { amount: Number(r.amount), unit: r.unit, status: r.status },
      },
    });
  }

  async function addItem() {
    const r = await ask(`新增活動・${fmtDay(d.date)}`, {
      fields: [
        { name: "name", label: "活動名稱", required: true, maxLength: 120 },
        { name: "time", label: "開始時間", type: "time", value: "10:00" },
        { name: "dur", label: "停留（分鐘）", type: "number", value: "90", min: 15, step: 15 },
        { name: "mode", label: "交通方式", type: "select", value: "walk", options: Object.entries(MODE).map(([value, label]) => ({ value, label })) },
        { name: "amount", label: "每人估計費用（AUD，可留空）", type: "number", min: 0 },
      ],
      ok: "新增",
    });
    if (!r || !r.name.trim()) return;
    await runOp({
      op: "addItem",
      date: d.date,
      fields: { name: r.name, time: r.time || "10:00", dur: Number(r.dur) || 60, mode: r.mode, ...(r.amount !== "" ? { cost: { amount: Number(r.amount), unit: "pp", status: "estimate" } } : {}) },
    });
  }

  async function removeItem(it: Item) {
    const isMust = it.pri === "must";
    const r = await ask(isMust ? "移除必去活動？" : "移除活動？", {
      body: (
        <>
          <p>
            {isMust ? (
              <>
                「{it.name}」是<strong>必去</strong>活動。依規則，必去活動不會被默默移除。若確定要移除，請輸入活動名稱。
              </>
            ) : (
              <>確定移除「{it.name}」？</>
            )}
          </p>
          <p className="small muted">移除後仍可從版本紀錄還原。</p>
        </>
      ),
      fields: isMust ? [{ name: "confirm", label: "活動名稱", required: true }] : [],
      ok: "移除",
    });
    if (!r) return;
    await runOp({ op: "removeItem", date: d.date, itemId: it.id, ...(isMust ? { confirmMustName: r.confirm } : {}) });
  }

  async function confirmDriver() {
    const r = await ask(`確認 ${d.needsDriver} 的開車時段`, {
      body: <p className="small muted">確認日期與時段後，當天開車行程才會從「暫定」變成可執行。</p>,
      fields: [{ name: "win", label: "可開車時段（HH:MM–HH:MM）", placeholder: "例如 08:30–18:00", required: true }],
      ok: "確認",
    });
    if (!r) return;
    await runOp({ op: "confirmDriver", date: d.date, window: r.win });
  }

  return (
    <div className="days-layout">
      <DayCalendar />

      <div className="day-main">
        <article className="day-detail" key={d.date}>
          <div className="day-head">
            <div>
              <div className="day-date">
                第 {currentDay + 1} 天・{fmtDay(d.date)}・{seg?.name}
              </div>
              <h2>{d.title}</h2>
            </div>
            <div className="day-nav">
              <button className="btn ghost small" type="button" disabled={currentDay === 0} onClick={() => setCurrentDay(currentDay - 1)} aria-label="前一天">
                ← 前一天
              </button>
              <button className="btn ghost small" type="button" disabled={currentDay === doc.days.length - 1} onClick={() => setCurrentDay(currentDay + 1)} aria-label="後一天">
                後一天 →
              </button>
            </div>
          </div>
          <div className="day-badges">
            <Badge t={seg?.name ?? d.seg} c={`b-${d.seg}`} />
            <Badge t={`可行性：${fe.t}`} c={fe.c} />
            <Badge t={warnN ? `規劃檢查：${warnN} 項提醒` : "規劃檢查：無警示"} c={warnN ? "b-warn" : "b-ok"} />
            {d.needsDriver && <Badge t={d.driverOk ? `司機：${d.needsDriver} 已確認` : `司機：${d.needsDriver}（未確認）`} c={d.driverOk ? "b-ok" : "b-warn"} />}
            {d.transfer && <Badge t="移動日" c="b-info" />}
            {d.ferry && <Badge t="渡輪" c="b-info" />}
            {d.hike && <Badge t="步道" c="b-info" />}
          </div>
          <div className="day-facts">
            <div className="fact">
              <div className="k">主要活動</div>
              <div className="v">{majors} 個</div>
            </div>
            <div className="fact">
              <div className="k">預估開車</div>
              <div className="v">{d.driveHrs ? `約 ${d.driveHrs} 小時` : "不開車"}</div>
            </div>
            <div className="fact">
              <div className="k">當日花費（{N} 人）</div>
              <div className="v">{money(dayTotal(doc, currentDay, N))}</div>
            </div>
            <div className="fact">
              <div className="k">今晚住宿</div>
              <div className="v">{st.area || st.name}</div>
            </div>
          </div>
          {st.name && d.stay !== "none" && (
            <p className="small muted">
              <Icon name="home" size={16} /> {st.name}
              {owner && st.address ? `・地址：${st.address}` : "・確切地址已隱藏"}
              {st.note ? `・${st.note}` : ""}
            </p>
          )}
          {cs.map((c, k) => (
            <div key={k} className={`alert ${c.lv}`}>
              <span className="ic">
                <Icon name={c.lv === "warn" ? "warn" : c.lv === "ok" ? "ok" : c.lv === "danger" ? "stop" : "info"} label={c.lv === "warn" ? "提醒" : c.lv === "ok" ? "確認" : c.lv === "danger" ? "危險" : "資訊"} />
              </span>
              <div>
                <p>{c.t}</p>
                {c.alt && (
                  <p className="small">
                    <strong>替代方案：</strong>
                    {c.alt}
                  </p>
                )}
              </div>
            </div>
          ))}
          {editable && d.needsDriver && (
            <p>
              {d.driverOk || raw.driverConfirmation ? (
                <button className="btn ghost small" type="button" onClick={() => void runOp({ op: "clearDriver", date: d.date })}>
                  改回未確認
                </button>
              ) : null}{" "}
              {!d.driverOk && (
                <button className="btn small" type="button" onClick={() => void confirmDriver()}>
                  ✓ 確認司機與時段
                </button>
              )}
            </p>
          )}
          {owner && !online && <p className="small muted">離線中：可以查看，但修改需要網路連線。</p>}
          {d.items.length ? (
            <ol className="acts">
              {d.items.map((i, k) => {
                const tent = isTentative(d, i);
                const voted = myVotes.find((v) => v.itemId === i.id && v.dayDate === d.date);
                const cnt = countOf(i.id);
                return (
                  <FragmentItem key={i.id}>
                    <Legs travel={i.travel} />
                    <li className={`act ${focusId === i.id ? "active" : ""}`}>
                      <div className={`pin ${d.seg}`} aria-hidden="true">
                        {k + 1}
                      </div>
                      <div className="body">
                        <div className="top">
                          <span className="time">
                            {i.time}・{mins(i.dur)}
                          </span>
                          <span>
                            <Badge {...PRI[i.pri]} /> {tent && <Badge t="暫定（司機未確認）" c="b-warn" />} <Badge {...VERIFY[i.verify]} />{" "}
                            {i.originPackage && <Badge t="來自待安排景點" c="b-line" />}
                          </span>
                        </div>
                        <h4>{i.name}</h4>
                        <div className="en">{i.en}</div>
                        {i.photo && (
                          <ActPhoto id={i.id} name={i.name} photo={i.photo} onOpen={() => setViewer(dayPhotos.findIndex((p) => p.id === i.id))} />
                        )}
                        <div className="meta">
                          <span>
                            <Icon name={MODE_ICON[i.mode] ?? "route"} size={16} /> {MODE[i.mode]}
                          </span>
                          {i.src && (
                            <span>
                              來源：
                              <a href={i.src.url} target="_blank" rel="noopener noreferrer">
                                {i.src.label}
                              </a>
                              {i.checked ? `（${i.checked} 查核）` : "（未查核）"}
                            </span>
                          )}
                          {!i.photo && (i.src || i.originPackage) && i.mode !== "flight" && (
                            <span>
                              <a href={mapsPhotoLink(i.en || i.name)} target="_blank" rel="noopener noreferrer">
                                在 Google 地圖看照片
                              </a>
                            </span>
                          )}
                          {i.cost && (
                            <span>
                              {i.cost.status === "unknown" ? "費用未知" : `${basis(i.cost, N)} = ${money(lineAmount(i.cost, N))}`} <Badge {...STATUS[i.cost.status]} />
                            </span>
                          )}
                        </div>
                        {i.note && (
                          <div className="note">
                            <Icon name="note" size={16} /> {i.note}
                          </div>
                        )}
                        {i.packageContext && (
                          <div className="note small">
                            <Icon name="compass" size={16} /> 來自「{i.packageContext.title ?? i.packageContext.key}」：{i.packageContext.driveHrs ? `整趟約開車 ${i.packageContext.driveHrs} 小時；` : ""}共乘費用未套用。
                          </div>
                        )}
                        <div className="tools">
                          <button className="btn ghost small" type="button" onClick={() => setFocusId(i.id)}>
                            <Icon name="map" size={16} /> 地圖
                          </button>
                          {mode === "public" ? (
                            canVote && (
                            <span className="interest">
                              <button className={`btn small ${voted ? "ghost" : ""}`} type="button" onClick={() => void vote(i.id, d.date)}>
                                {voted ? `✓ 已表達興趣${voted.nickname ? "（" + voted.nickname + "）" : ""}` : "我有興趣"}
                              </button>
                              {voted && (
                                <button className="btn ghost small" type="button" onClick={() => void unvote(i.id, d.date)}>
                                  收回
                                </button>
                              )}
                            </span>
                            )
                          ) : (
                            <>
                              <label className="small">
                                優先度{" "}
                                <select value={i.pri} disabled={!editable} onChange={(e) => void runOp({ op: "setPriority", date: d.date, itemId: i.id, pri: e.target.value })}>
                                  {Object.entries(PRI).map(([v, p]) => (
                                    <option key={v} value={v}>
                                      {p.t}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <button className="btn ghost small" type="button" disabled={!editable} onClick={() => void runOp({ op: "toggleVerify", date: d.date, itemId: i.id })}>
                                {i.verify === "verified" ? "取消查核" : "✓ 標記已查核"}
                              </button>
                              <button className="btn ghost small" type="button" disabled={!editable} onClick={() => void editItem(i)}>
                                修改
                              </button>
                              {i.originPackage ? (
                                <button className="btn ghost small" type="button" disabled={!editable} onClick={() => void runOp({ op: "unscheduleItem", date: d.date, itemId: i.id })}>
                                  移回待安排
                                </button>
                              ) : (
                                <button className="btn ghost small" type="button" disabled={!editable} onClick={() => void removeItem(i)}>
                                  移除
                                </button>
                              )}
                              {cnt > 0 && (
                                <span className="count-pill" title="訪客興趣（合計）">
                                  <Icon name="hand" size={14} label="訪客興趣" /> {cnt}
                                </span>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    </li>
                  </FragmentItem>
                );
              })}
            </ol>
          ) : (
            <div className="empty-day">
              這天還沒有安排活動。
              {owner && (
                <>
                  <br />
                  可以保留休息、新增活動，或從「待安排景點」排入。
                </>
              )}
            </div>
          )}
          {editable && (
            <p>
              <button className="btn ghost" type="button" onClick={() => void addItem()}>
                ＋ 新增活動
              </button>
            </p>
          )}
          <SharedCosts />
        </article>
        {viewer !== null && dayPhotos[viewer] && (
          <PhotoViewer
            key={d.date}
            photos={dayPhotos}
            start={viewer}
            onClose={(id) => {
              setViewer(null);
              document.querySelector<HTMLElement>(`[data-photo-id="${id}"]`)?.closest("button")?.focus({ preventScroll: true });
            }}
          />
        )}
        <aside className="day-map-wrap">
          <DayMap day={d} active={active} focusId={focusId} />
          <p className="map-note">路線為點對點直線示意，非實際道路；實際路線與時間請以導航為準。</p>
        </aside>
      </div>
    </div>
  );
}

function FragmentItem({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function SharedCosts() {
  const { doc, mode, currentDay, runOp, online } = useTrip();
  const raw = doc.days[currentDay];
  const N = doc.partySize;
  const own = (raw.costs ?? []).map((c, ci) => ({ c, ci })).filter((x) => x.c.unit === "shared");
  const attached = (raw.attached ?? []).flatMap((a) => a.costs.filter((c) => c.unit === "shared").map((c) => ({ c, from: a.title ?? a.key })));
  if (!own.length && !attached.length) return null;
  return (
    <div className="card section">
      <h3>共乘費用分攤</h3>
      {own.map(({ c, ci }) => (
        <p key={ci}>
          {c.label}：{basis(c, N)} = <strong>{money(lineAmount(c, N))}</strong> <Badge {...STATUS[c.status]} />
          {mode === "owner" && (
            <>
              <br />
              <label className="small">
                這段車程的參與人數（含司機）{" "}
                <input
                  type="number"
                  min={1}
                  max={12}
                  defaultValue={c.participants}
                  key={`${raw.date}-${ci}-${c.participants}`}
                  disabled={!online}
                  style={{ width: 70 }}
                  onBlur={(e) => {
                    const p = Math.max(1, Math.min(12, Number(e.target.value) || 1));
                    if (p !== c.participants) void runOp({ op: "setParticipants", date: raw.date, costIndex: ci, participants: p });
                  }}
                />
              </label>
            </>
          )}
        </p>
      ))}
      {attached.map(({ c, from }, k) => (
        <p key={`a${k}`}>
          {c.label}（來自「{from}」）：{basis(c, N)} = <strong>{money(lineAmount(c, N))}</strong> <Badge {...STATUS[c.status]} />
        </p>
      ))}
      <p className="muted small">規則：油資、停車、渡輪等車輛費用只由該段車程的參與者分攤。</p>
    </div>
  );
}
