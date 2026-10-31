"use client";

import { dayCoverTitle, dayTitle, dayTitleZh } from "@/domain/day-title";
import { t } from "@/i18n/current";
import { useEffect, useRef, useState } from "react";
import { useTrip } from "./TripApp";
import { Icon, MODE_ICON } from "./Icon";
import { Badge, LEG, MODE, PendingButton, PRI, STATUS, TapChips, useReducedMotion, VERIFY, type TapChip } from "./ui";
import { clearDaySplit } from "@/domain/ops";
import { AvatarStack, PeopleToggle, peopleOf } from "./People";
import { PEOPLE, type Person } from "@/domain/schema";
import { DayCalendar } from "./DayCalendar";
import { useWeather } from "@/client/weather";
import { RainPlan, WxLine, wxChips, wxFor } from "./Weather";
import { isWet, weatherNote } from "@/domain/weather";
import { CATEGORY_META, distanceLabel, nearbyPlaces, type NearbyPlace } from "./Places";
import { PhotoViewer, mapsPhotoLink, type DayPhoto } from "./Photos";
import { DayMap } from "./MapViews";
import { effectiveDay, isTentative } from "@/domain/effective-day";
import { checks, feasibility } from "@/domain/rules";
import { basis, dayTotal, lineAmount, stayOf } from "@/domain/budget";
import { fmtDay, mins, money } from "@/domain/format";
import type { Item } from "@/domain/schema";
import { computeLegs, legLabel, routeStops, softTravel, useLegs, type Leg } from "./useLegs";
import { daySegments, navMode, navUrl, type NavPoint } from "@/domain/nav";
import { nightStay } from "@/domain/stay";
import { dayEnds } from "@/domain/home-pins";
import { PlaceGallery, sizedPhoto } from "./PlaceGallery";
import { displayName, isLogistics, nameIsTentative } from "@/domain/day-title";

/**
 * One line per leg (Kai 2026-10-26): the road-computed time and distance when known, else the estimate.
 * `nav` adds a 「導航」 link that opens Google Maps directions for the leg.
 */
function Legs({ travel, road, nav }: { travel?: Item["travel"]; road?: Leg | null; nav?: string | null }) {
  const parts = Object.entries(travel ?? {}).filter(([, v]) => (v ?? 0) > 0) as [string, number][];
  const link = nav ? (
    <a className="leg-nav" href={nav} target="_blank" rel="noopener noreferrer" aria-label="導航">
      <Icon name="route" size={16} />
    </a>
  ) : null;
  if (road && road.durationS > 0) {
    const how = road.source.endsWith("-walking") ? { icon: "walk", t: "步行" } : road.source.endsWith("-transit") ? { icon: "bus", t: "大眾運輸" } : { icon: "car", t: "開車" };
    return (
      <li className="leg">
        <span className="leg-road" role="img" aria-label={`${how.t} ${legLabel(road)}`}>
          <Icon name={how.icon} size={16} /> {legLabel(road)}
        </span>
        {link}
      </li>
    );
  }
  if (!parts.length) return link ? <li className="leg">{link}</li> : null;
  const total = parts.reduce((a, [, v]) => a + v, 0);
  const [k, v] = parts.length === 1 ? parts[0] : [null, total];
  return (
    <li className="leg">
      <span role="img" aria-label={`${k ? `${LEG[k] ?? k} ` : ""}約 ${mins(v as number)}（估計）`}>
        <Icon name={k ? (MODE_ICON[k] ?? "route") : "route"} size={16} /> ~{mins(v as number)}
      </span>
      {link}
    </li>
  );
}

const iconOf = (i?: Item): string => {
  if (!i) return "calendar";
  if (i.name.startsWith("住宿：")) return "bed";
  if (isLogistics(i)) return MODE_ICON[i.mode] ?? "route";
  return i.cat ? CATEGORY_META[i.cat].icon : (MODE_ICON[i.mode] ?? "pin");
};

/** The day as a line of round pictures: photos for main sights, icons for the rest; tap scrolls to the stop. */
function RouteStrip({ items, legBefore }: { items: Item[]; legBefore: (id: string) => Leg | null }) {
  const reduce = useReducedMotion();
  const toStop = (id: string) => document.getElementById(`act-${id}`)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  return (
    <ol className="route-strip" aria-label="當日路線">
      {items.map((i, k) => {
        const road = legBefore(i.id);
        const minutes = road && road.durationS > 0 ? Math.round(road.durationS / 60) : Object.values(i.travel ?? {}).reduce<number>((a, v) => a + (v ?? 0), 0);
        const how = road ? (road.source.endsWith("-walking") ? "walk" : road.source.endsWith("-transit") ? "bus" : "car") : (MODE_ICON[i.mode] ?? "route");
        const pic = i.major && !isLogistics(i) ? (i.photo ?? i.gallery?.[0]) : undefined;
        return (
          <li key={i.id}>
            {k > 0 && (
              <span className="rs-link" role="img" aria-label={`${MODE[i.mode] ?? ""} ${minutes ? mins(minutes) : ""}`}>
                <Icon name={how} size={14} />
                {minutes > 0 && <small>{mins(minutes)}</small>}
              </span>
            )}
            <button type="button" className={`rs-stop${pic ? " has-photo" : ""}`} aria-label={i.dur === 0 && i.time === "00:00" ? displayName(i) : `${i.time} ${displayName(i)}`} onClick={() => toStop(i.id)}>
              <span className="rs-pic">
                {pic ? (
                  // eslint-disable-next-line @next/next/no-img-element -- hotlinked photo, see Photos.tsx
                  <img src={sizedPhoto(pic.url, 250, pic.w)} alt="" referrerPolicy="no-referrer" loading="lazy" decoding="async" />
                ) : (
                  <Icon name={iconOf(i)} size={20} />
                )}
              </span>
              {i.major && !isLogistics(i) && <span className="rs-name">{displayName(i)}</span>}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** 「新增活動」: nearby unscheduled places first (one tap to add), manual entry as the fallback. */
function NearbyPicker({
  date,
  places,
  onAdd,
  onManual,
  onClose,
}: {
  date: string;
  places: NearbyPlace[];
  onAdd: (key: string, id: string) => Promise<boolean>;
  onManual: () => void;
  onClose: () => void;
}) {
  return (
    <section className="nearby-picker" aria-label={`新增活動到 ${fmtDay(date)}`}>
      <header>
        <h4>附近的待安排景點</h4>
        <button type="button" className="close" onClick={onClose} aria-label="關閉">
          <Icon name="close" size={18} />
        </button>
      </header>
      {places.length ? (
        <ul>
          {places.map(({ i, p, km }) => (
            <li key={i.id}>
              {i.photo ? (
                // eslint-disable-next-line @next/next/no-img-element -- hotlinked photo, see Photos.tsx
                <img src={i.photo.url} alt="" referrerPolicy="no-referrer" loading="lazy" decoding="async" />
              ) : (
                <span className="ph-icon" aria-hidden="true">
                  <Icon name={i.cat ? CATEGORY_META[i.cat].icon : "pin"} size={20} />
                </span>
              )}
              <span className="t">
                <strong>{i.name}</strong>
                <span className="sub">
                  {i.cat ? `${CATEGORY_META[i.cat].t}・` : ""}
                  {distanceLabel(km)}
                </span>
              </span>
              <PendingButton className="btn small" pendingLabel="加入中…" onAction={() => onAdd(p.key, i.id)} aria-label={`把「${i.name}」加入這天`}>
                加入
              </PendingButton>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">這個地區沒有待安排景點了。</p>
      )}
      <button type="button" className="btn ghost small manual" onClick={onManual}>
        都不是？手動新增活動
      </button>
    </section>
  );
}

/** 「移到…」: move an activity to another day of the same region; confirmed bookings stay locked. */
function MoveTo({ item, date, disabled }: { item: Item; date: string; disabled: boolean }) {
  const { doc, runOp } = useTrip();
  const seg = doc.days.find((d) => d.date === date)?.seg;
  const days = doc.days.filter((d) => d.seg === seg && d.date !== date);
  const [to, setTo] = useState("");
  const locked = item.status === "confirmed";
  return (
    <span className="move-to">
      <label className="field-inline">
        <span>移到</span>
        <select value={to} disabled={disabled || locked} onChange={(e) => setTo(e.target.value)}>
          <option value="">選擇日期…</option>
          {days.map((d) => (
            <option key={d.date} value={d.date}>
              {fmtDay(d.date)} {d.items.length ? dayTitle(d) : "（可安排）"}
            </option>
          ))}
        </select>
      </label>{" "}
      <PendingButton className="btn ghost small" disabled={disabled || locked || !to} pendingLabel="移動中…" onAction={() => runOp({ op: "moveItem", date, itemId: item.id, toDate: to })}>
        移動
      </PendingButton>
      {locked ? <span className="hint">已確認的預訂鎖定中；要移動請先把狀態改成待確認</span> : !to && <span className="hint">先選一個日期，就能移動</span>}
    </span>
  );
}

/** Long notes start at two lines with 「更多」; warnings (⚠) always show in full. */
function ActNote({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const warn = text.includes("⚠");
  const long = text.length > 60;
  return (
    <div className={`note${warn ? " warn-note" : ""}${!warn && long && !open ? " clamp" : ""}`}>
      <Icon name={warn ? "warn" : "note"} size={16} /> <span>{text}</span>
      {!warn && long && (
        <button type="button" className="more" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? "收起" : "更多"}
        </button>
      )}
    </div>
  );
}

export function DaysView({ active }: { active: boolean }) {
  const { doc, mode, currentDay, setCurrentDay, runOp, runOpUndoable, ask, online, myVotes, vote, unvote, counts, canVote, token } = useTrip();
  const weather = useWeather();
  const [showNearby, setShowNearby] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [viewer, setViewer] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const owner = mode === "owner";
  const editable = owner && online;
  const raw = doc.days[currentDay];
  const d = effectiveDay(raw);
  const N = doc.partySize;
  const night = nightStay(doc, raw);
  const st = stayOf(doc, night);
  const cs = checks(doc, d, { showWindow: owner });
  const fe = VERIFY[feasibility(doc, d)];
  const warnN = cs.filter((c) => c.lv === "warn").length;
  const majors = d.items.filter((i) => i.major).length;
  const seg = doc.segments[d.seg];
  const nearby = nearbyPlaces(doc, d.date, 12);
  const dayPhotos: DayPhoto[] = d.items.flatMap((i) => (i.photo ? [{ id: i.id, name: i.name, photo: i.photo }] : []));
  // Everyone who takes part in at least one of the day's activities (Kai + Aya when the day is empty).
  // Road legs between consecutive stops with coordinates, on driving days (chictrip review P2-a).
  // The day as a route: last night's stay → stops → tonight's stay (Kai 2026-10-26), with road legs.
  const ends = dayEnds(doc, d.date);
  const route = routeStops(d.items, ends);
  const roadLegs = useLegs(route);
  const posOf = (id: string) => route.findIndex((s) => s.itemId === id);
  const roadBefore = (id: string) => {
    const pos = posOf(id);
    return pos > 0 ? (roadLegs?.[pos - 1] ?? null) : null;
  };
  // Navigation: the residence is never put in a URL as text; share links start from the viewer's location.
  const navPt = (s: (typeof route)[number]): NavPoint => (s.kind === "start" && ends.start?.home && !owner ? null : { lat: s.pt[0], lng: s.pt[1] });
  const navTo = (s: (typeof route)[number]): Exclude<NavPoint, null> =>
    s.kind === "end" && ends.end?.home && !owner ? { query: doc.stays[nightStay(doc, raw)]?.name ?? "Hobart" } : { lat: s.pt[0], lng: s.pt[1] };
  const canNav = owner || !!token;
  const navBefore = (pos: number) => {
    const m = pos > 0 ? navMode(route[pos].mode) : null;
    return canNav && m ? navUrl(navPt(route[pos - 1]), navTo(route[pos]), m) : null;
  };
  // Whole-day links, one set per way of travelling (driving, then walking on an island, …); flights are skipped.
  const daySegs = canNav && route.length >= 2 ? daySegments(route.map(navTo), route.slice(1).map((s) => navMode(s.mode)), navPt(route[0])) : [];
  const MODE_T: Record<string, string> = { driving: "開車", walking: "步行", transit: "大眾運輸" };
  const dayNav = daySegs.flatMap((sg) => sg.urls.map((u, k) => ({ u, t: `${daySegs.length > 1 ? MODE_T[sg.mode] : "全日"}導航${sg.urls.length > 1 ? `（${k + 1}/${sg.urls.length}）` : ""}` })));
  // The owner's view computes missing driving legs once (within the daily Google cap); they are stored.
  const autoAsked = useRef(new Set<string>());
  useEffect(() => {
    if (!editable || !active || !roadLegs) return;
    if (!route.slice(1).some((s, k) => (s.drive || (softTravel(s.mode) && !s.gap)) && !roadLegs[k])) return;
    const key = JSON.stringify(route.map((s) => [s.pt, s.drive]));
    if (autoAsked.current.has(key)) return;
    autoAsked.current.add(key);
    void computeLegs(route);
    // route is derived from the day; its key guards the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable, active, roadLegs, d.date]);
  const dayPeople: Person[] = PEOPLE.filter((p) => (raw.items.length ? raw.items.some((i) => peopleOf(i, raw).includes(p)) : peopleOf({}, raw).includes(p)));
  // The day's headline picture: its first major stop with a photo, else any photo.
  const dayHero = d.items.find((i) => i.photo && i.major) ?? d.items.find((i) => i.photo);

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
    const r = await ask(isMust ? "永久刪除必去活動？" : "永久刪除這個活動？", {
      body: (
        <>
          <p>
            {isMust ? (
              <>
                「{it.name}」是<strong>必去</strong>活動。依規則，必去活動不會被默默移除。若確定要移除，請輸入活動名稱。
              </>
            ) : (
              <>「{it.name}」會從行程裡刪掉，不會放回待安排景點。想之後再排，請改用「移回待安排」。</>
            )}
          </p>
          <p className="small muted">刪除後 5 秒內可以按「復原」。</p>
        </>
      ),
      fields: isMust ? [{ name: "confirm", label: "活動名稱", required: true }] : [],
      ok: "永久刪除",
    });
    if (!r) return null;
    return runOpUndoable({ op: "removeItem", date: d.date, itemId: it.id, ...(isMust ? { confirmMustName: r.confirm } : {}) }, `已刪除「${it.name}」`);
  }

  const samePeople = (a: Person[], b: Person[]) => a.length === b.length && a.every((p) => b.includes(p));

/** 「清空這天」: everything except confirmed bookings, flights and stay notes goes back to the pool, in one version. */
  async function clearDay() {
    const { move, keep } = clearDaySplit(raw.items);
    const r = await ask("清空這天？", {
      body: (
        <>
          <p>
            將 <strong>{move.length}</strong> 個活動移回待安排{keep.length ? `，${keep.length} 個保留（已確認的預訂、航班、住宿）` : ""}。
          </p>
          <p className="small muted">不會刪除任何東西；之後可以從「新增活動」或地圖再排回來。完成後 5 秒內可以按「復原」整天還原。</p>
        </>
      ),
      ok: "移回待安排",
    });
    if (!r) return null;
    return runOpUndoable({ op: "clearDay", date: d.date }, `已清空 ${fmtDay(d.date)}：${move.length} 個活動移回待安排`);
  }

  async function confirmDriver() {
    const r = await ask(`確認 ${d.needsDriver} 的開車時段`, {
      body: <p className="small muted">確認日期與時段後，當天開車行程才會從「暫定」變成可執行。</p>,
      fields: [{ name: "win", label: "可開車時段（HH:MM–HH:MM）", placeholder: "例如 08:30–18:00", required: true }],
      ok: "確認",
    });
    if (!r) return null;
    return runOp({ op: "confirmDriver", date: d.date, window: r.win });
  }

  // Status chips above the stops: pictures and numbers first, the sentence opens on tap.
  const dayWx = wxFor(weather, d.date);
  const facts: TapChip[] = [
    ...(weather ? wxChips(dayWx, <WxLine day={dayWx} />) : []),
    ...(weather && dayWx?.wx && isWet(dayWx.wx)
      ? [{
          key: "rain",
          icon: <Icon name="umbrella" size={18} />,
          text: t("備案"),
          label: "雨天備案",
          tone: "wet" as const,
          panel: (
            <RainPlan
              date={d.date}
              seg={d.seg}
              items={raw.items}
              pool={doc}
              w={weather}
              owner={editable}
              onUse={(itemId, key, backupId) => runOpUndoable({ op: "useBackup", date: d.date, itemId, key, backupId }, "已換成備案，可以按「復原」")}
              onSwapDay={(toDate) => runOpUndoable({ op: "swapDays", date: d.date, toDate }, "已對調，可以按「復原」")}
              onIndoor={(itemId, indoor) => runOp({ op: "setIndoor", itemId, indoor })}
            />
          ),
        }]
      : []),
    { key: "cost", icon: <Icon name="wallet" size={18} />, text: money(dayTotal(doc, currentDay, N)), label: `當日花費（${N} 人）：${money(dayTotal(doc, currentDay, N))}` },
    ...(night !== "none" && st.name
      ? [{
          key: "stay",
          icon: <Icon name="bed" size={18} />,
          text: st.area || st.name,
          label: `今晚住宿：${st.area || st.name}`,
          panel: (
            <p className="small">
              {st.name}
              {owner && st.address ? `・地址：${st.address}` : "・確切地址已隱藏"}
              {st.note ? `・${st.note}` : ""}
            </p>
          ),
        }]
      : []),
    {
      key: "drive",
      icon: <Icon name="car" size={18} />,
      text: d.driveHrs ? `${d.driveHrs} h` : "0",
      label: d.driveHrs ? `開車約 ${d.driveHrs} 小時` : "不開車",
      panel: (
        <p className="small">
          主要活動 {majors} 個・{d.driveHrs ? `開車約 ${d.driveHrs} 小時` : "不開車"}・可行性：{fe.t}
          {d.transfer ? "・移動日" : ""}
          {d.ferry ? "・有渡輪" : ""}
          {d.hike ? "・有步道" : ""}
        </p>
      ),
    },
    ...(d.needsDriver
      ? [{
          key: "driver",
          icon: <Icon name={d.driverOk ? "ok" : "wait"} size={18} />,
          label: d.driverOk ? `司機：${d.needsDriver} 已確認` : `司機：${d.needsDriver}（未確認）`,
          tone: d.driverOk ? ("ok" as const) : ("warn" as const),
          panel: <p className="small">{d.driverOk ? `司機：${d.needsDriver} 已確認` : `司機：${d.needsDriver}（未確認）`}</p>,
        }]
      : []),
    ...(cs.length
      ? [{
          key: "checks",
          icon: <Icon name={warnN ? "warn" : "info"} size={18} />,
          text: String(cs.length),
          label: `${cs.length} 項提醒`,
          tone: warnN ? ("warn" as const) : undefined,
          panel: cs.map((c, k) => (
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
          )),
        }]
      : []),
    ...dayNav.map(({ u, t: navT }) => ({ key: u, icon: <Icon name="route" size={18} />, label: navT, href: u })),
  ];

  return (
    <div className="days-layout">
      <DayCalendar />

      <div className="day-main">
        <article className="day-detail" key={d.date}>
          <div className={`day-cover${dayHero?.photo ? "" : " no-photo"}`}>
            {dayHero?.photo ? (
              <button type="button" className="day-cover-photo" onClick={() => setViewer(dayPhotos.findIndex((p) => p.id === dayHero.id))} aria-label={`放大看照片：${dayHero.name}`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- hotlinked photo, see Photos.tsx */}
                <img src={sizedPhoto(dayHero.photo.url, 960, dayHero.photo.w)} alt="" referrerPolicy="no-referrer" fetchPriority="high" decoding="async" data-photo-id={dayHero.id} />
              </button>
            ) : (
              <span className="day-cover-tile" aria-hidden="true">
                <Icon name={iconOf(d.items.find((i) => i.major) ?? d.items[0])} size={72} />
              </span>
            )}
            <div className="day-cover-text">
              <div className="day-date">
                {t("第 {n} 天", { n: currentDay + 1 })}・{fmtDay(d.date)}・{seg?.name}
              </div>
              <h2>{dayCoverTitle(raw)}</h2>
            </div>
            <span className="day-cover-people">
              <AvatarStack people={dayPeople} size={30} />
            </span>
            <button className="day-arrow prev" type="button" disabled={currentDay === 0} onClick={() => setCurrentDay(currentDay - 1)} aria-label="前一天">
              <Icon name="chevron-left" size={22} />
            </button>
            <button className="day-arrow next" type="button" disabled={currentDay === doc.days.length - 1} onClick={() => setCurrentDay(currentDay + 1)} aria-label="後一天">
              <Icon name="chevron-right" size={22} />
            </button>
          </div>
          <div className="day-chip-line">
            <TapChips items={facts} />
            {editable && (
              <details className="owner-menu">
                <summary aria-label="更多動作">
                  <Icon name="more" size={20} />
                </summary>
                <div className="owner-menu-body">
                  <p className="title-pin small">
                    {raw.titlePinned ? "標題已固定" : "標題依當天活動自動產生"}{" "}
                    <PendingButton
                      className="btn ghost small"
                      pendingLabel="儲存中…"
                      onAction={async () => {
                        const v = await ask(raw.titlePinned ? "修改或取消固定標題" : "自訂這天的標題", {
                          body: <p className="small muted">留空會改回依當天活動自動產生的標題。</p>,
                          fields: [{ name: "title", label: "標題（最多 60 字）", value: raw.titlePinned ? raw.title : dayTitleZh(raw), maxLength: 60 }],
                        });
                        if (!v) return null;
                        return runOp({ op: "setDayTitle", date: raw.date, title: v.title });
                      }}
                    >
                      {raw.titlePinned ? "修改標題" : "自訂標題"}
                    </PendingButton>
                  </p>
                  {clearDaySplit(raw.items).move.length > 0 && (
                    <PendingButton className="btn ghost small clear-day" pendingLabel="清空中…" onAction={clearDay}>
                      清空這天…
                    </PendingButton>
                  )}
                  {d.needsDriver && (d.driverOk || raw.driverConfirmation) && (
                    <PendingButton className="btn ghost small" pendingLabel="儲存中…" onAction={() => runOp({ op: "clearDriver", date: d.date })}>
                      改回未確認
                    </PendingButton>
                  )}
                  {d.needsDriver && !d.driverOk && (
                    <PendingButton className="btn small" pendingLabel="確認中…" onAction={confirmDriver}>
                      ✓ 確認司機與時段
                    </PendingButton>
                  )}
                </div>
              </details>
            )}
          </div>
          {owner && !online && <p className="small muted">離線中：可以查看，但修改需要網路連線。</p>}
          {d.items.length > 0 && <RouteStrip items={d.items} legBefore={roadBefore} />}
          {d.items.length ? (
            <ol className="acts">
              {route[0]?.kind === "start" && (
                <li className="act act-end">
                  <div className={`pin home ${d.seg}`} aria-hidden="true">
                    <Icon name="home" size={14} />
                  </div>
                  <div className="body">
                    <Icon name="home" size={16} /> <span className="muted">{ends.start?.home ? "住處" : ends.start?.name}</span>
                  </div>
                </li>
              )}
              {d.items.map((i, k) => {
                const tent = isTentative(d, i);
                const voted = myVotes.find((v) => v.itemId === i.id && v.dayDate === d.date);
                const cnt = countOf(i.id);
                const big = i.major && !isLogistics(i);
                const name = displayName(i);
                const waiting = i.status === "pending" || tent || nameIsTentative(i);
                const stateIcon =
                  i.status === "confirmed" ? (
                    <span className="stop-state ok">
                      <Icon name="ok" size={16} label="已確認" />
                    </span>
                  ) : waiting ? (
                    <span className="stop-state wait">
                      <Icon name="wait" size={16} label={tent ? "暫定（司機未確認）" : "待確認"} />
                    </span>
                  ) : null;
                const chips = (
                  <div className="stop-chips">
                    <span aria-label={`停留 ${mins(i.dur)}`} role="img">
                      <Icon name="clock" size={14} /> {mins(i.dur)}
                    </span>
                    <span role="img" aria-label={MODE[i.mode]}>
                      <Icon name={MODE_ICON[i.mode] ?? "route"} size={14} />
                    </span>
                    {i.cost && i.cost.status !== "unknown" && (
                      <span role="img" aria-label={`費用 ${money(lineAmount(i.cost, N))}`}>
                        <Icon name="wallet" size={14} /> {money(lineAmount(i.cost, N))}
                      </span>
                    )}
                    {i.pri === "must" && <Badge {...PRI.must} />}
                    {!samePeople(peopleOf(i, raw), dayPeople) && <AvatarStack people={peopleOf(i, raw)} size={22} />}
                  </div>
                );
                const more = (
                  <>
                    {name !== i.name && <p className="small muted">{i.name}</p>}
                    {weatherNote(i) && <p className="small wx-note">{weatherNote(i)}</p>}
                    {i.note && <ActNote text={i.note} />}
                    {i.ownerNote && (
                      <div className="note owner-note">
                        <Icon name="info" size={16} /> 只有你看得到：{i.ownerNote}
                      </div>
                    )}
                    <ul className="stop-more-list">
                      {i.en && <li className="en">{i.en}</li>}
                      <li>
                        <Badge {...VERIFY[i.verify]} /> <Badge {...PRI[i.pri]} /> {i.originPackage && <Badge t="來自待安排景點" c="b-line" />}
                      </li>
                      {i.src && (
                        <li>
                          來源：
                          <a href={i.src.url} target="_blank" rel="noopener noreferrer">
                            {i.src.label}
                          </a>
                          {i.checked ? `（${i.checked} 查核）` : "（未查核）"}
                        </li>
                      )}
                      {i.cost && (
                        <li>
                          {i.cost.status === "unknown" ? "費用未知" : `${basis(i.cost, N)} = ${money(lineAmount(i.cost, N))}`} <Badge {...STATUS[i.cost.status]} />
                          {i.cost.note ? `・${i.cost.note}` : ""}
                        </li>
                      )}
                      {!i.photo && (i.src || i.originPackage) && i.mode !== "flight" && (
                        <li>
                          <a href={mapsPhotoLink(i.en || i.name)} target="_blank" rel="noopener noreferrer">
                            在 Google 地圖看照片
                          </a>
                        </li>
                      )}
                      {i.packageContext && (
                        <li>
                          來自「{i.packageContext.title ?? i.packageContext.key}」：{i.packageContext.driveHrs ? `整趟約開車 ${i.packageContext.driveHrs} 小時；` : ""}共乘費用未套用。
                        </li>
                      )}
                    </ul>
                    <div className="tools">
                      <button className="btn ghost small" type="button" onClick={() => setFocusId(i.id)} aria-label="地圖">
                        <Icon name="map" size={16} />
                      </button>
                      {mode !== "public" && (
                            <details className="act-manage">
                              <summary>管理</summary>
                              <div className="manage">
                                <div className="manage-group">
                                  <label className="field-inline">
                                    <span>狀態</span>
                                    <select
                                      value={i.status ?? ""}
                                      disabled={!editable}
                                      onChange={(e) => void runOp({ op: "setStatus", date: d.date, itemId: i.id, status: e.target.value as "" | "confirmed" | "pending" })}
                                    >
                                      <option value="">已安排</option>
                                      <option value="pending">待確認</option>
                                      <option value="confirmed">已確認（鎖定）</option>
                                    </select>
                                  </label>
                                  <MoveTo item={i} date={d.date} disabled={!editable} />
                                  <PeopleToggle
                                    value={peopleOf(i, raw)}
                                    disabled={!editable}
                                    onChange={(next) => void runOp({ op: "setPeople", date: d.date, itemId: i.id, people: next })}
                                  />
                                </div>
                                <div className="manage-group">
                                  <label className="field-inline">
                                    <span>優先度</span>
                                    <select value={i.pri} disabled={!editable} onChange={(e) => void runOp({ op: "setPriority", date: d.date, itemId: i.id, pri: e.target.value })}>
                                      {Object.entries(PRI).map(([v, p]) => (
                                        <option key={v} value={v}>
                                          {p.t}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                  <PendingButton className="btn ghost small" disabled={!editable} pendingLabel="儲存中…" onAction={() => runOp({ op: "toggleVerify", date: d.date, itemId: i.id })}>
                                    {i.verify === "verified" ? "取消查核" : "✓ 標記已查核"}
                                  </PendingButton>
                                  <button className="btn ghost small" type="button" disabled={!editable} onClick={() => void editItem(i)}>
                                    修改
                                  </button>
                                  <PendingButton
                                    className="btn ghost small"
                                    disabled={!editable || i.status === "confirmed"}
                                    title={i.status === "confirmed" ? "已確認的預訂鎖定中，請先把狀態改成待確認" : undefined}
                                    pendingLabel="移回中…"
                                    onAction={() => runOpUndoable({ op: "unscheduleItem", date: d.date, itemId: i.id }, `已把「${i.name}」移回待安排景點`)}
                                  >
                                    移回待安排
                                  </PendingButton>
                                  {cnt > 0 && (
                                    <span className="count-pill" title="訪客興趣（合計）">
                                      <Icon name="hand" size={14} label="訪客興趣" /> {cnt}
                                    </span>
                                  )}
                                </div>
                                <div className="manage-danger">
                                  <PendingButton className="btn danger ghost small" disabled={!editable || i.status === "confirmed"} pendingLabel="刪除中…" onAction={() => removeItem(i)}>
                                    永久刪除…
                                  </PendingButton>
                                  <span className="small muted">一般請用「移回待安排」，資料和照片都會保留。</span>
                                </div>
                              </div>
                            </details>
                          )}
                    </div>
                  </>
                );
                const interest = mode === "public" && canVote && (
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
                );
                return (
                  <FragmentItem key={i.id}>
                    {posOf(i.id) !== 0 && <Legs travel={i.travel} road={roadBefore(i.id)} nav={posOf(i.id) > 0 ? navBefore(posOf(i.id)) : null} />}
                    <li id={`act-${i.id}`} className={`act ${big ? "act-big" : "act-row"} ${focusId === i.id ? "active" : ""}`}>
                      <div className={`pin ${d.seg}`} aria-hidden="true">
                        {k + 1}
                      </div>
                      {big ? (
                        <div className="body">
                          <div className="stop-media">
                            {i.id !== dayHero?.id && !i.name.startsWith("住宿：") && (i.photo || i.gallery?.length || ((owner || token) && i.lat != null)) && <PlaceGallery item={i} className="stop-photo" empty="hide" />}
                            <span className="stop-time">{i.time}</span>
                            {stateIcon}
                          </div>
                          <h4>{name}</h4>
                          {chips}
                          {interest}
                          <details className="act-more">
                            <summary>更多</summary>
                            {more}
                          </details>
                        </div>
                      ) : (
                        <div className="body">
                          <details className="stop-line">
                            <summary>
                              {!(i.dur === 0 && i.time === "00:00") && <span className="stop-line-time">{i.time}</span>}
                              <Icon name={iconOf(i)} size={18} />
                              <span className="stop-line-name">{name}</span>
                              {stateIcon}
                              <span className="stop-line-more" aria-hidden="true">
                                <Icon name="chevron-right" size={16} />
                              </span>
                            </summary>
                            {chips}
                            {more}
                          </details>
                          {interest}
                        </div>
                      )}
                    </li>
                  </FragmentItem>
                );
              })}
              {route.at(-1)?.kind === "end" && route.length > 1 && (
                <>
                  <Legs travel={undefined} road={roadLegs?.[route.length - 2] ?? null} nav={navBefore(route.length - 1)} />
                  <li className="act act-end">
                    <div className={`pin home ${d.seg}`} aria-hidden="true">
                      <Icon name="home" size={14} />
                    </div>
                    <div className="body">
                      <Icon name={ends.end?.home ? "home" : "bed"} size={16} /> <strong>{ends.end?.home ? "回到住處" : `入住 ${ends.end?.name}`}</strong>
                    </div>
                  </li>
                </>
              )}
            </ol>
          ) : (
            <div className="empty-day">
              <Icon name="calendar" size={28} />
              <span>{t("可安排")}</span>
              {owner && <span className="small muted">可以保留休息、新增活動，或從「待安排景點」排入。</span>}
            </div>
          )}
          {/* Phones: the calendar scrolls away, so the next day is also here at the end of the day. */}
          <div className="day-nav day-nav-end">
            <button className="btn ghost small" type="button" disabled={currentDay === 0} aria-label="前一天" onClick={() => { setCurrentDay(currentDay - 1); scrollTo({ top: 0 }); }}>
              <Icon name="chevron-left" size={18} />
            </button>
            <button className="btn ghost small" type="button" disabled={currentDay === doc.days.length - 1} aria-label="後一天" onClick={() => { setCurrentDay(currentDay + 1); scrollTo({ top: 0 }); }}>
              <Icon name="chevron-right" size={18} />
            </button>
          </div>
          {editable &&
            (addOpen ? (
              <NearbyPicker
                date={d.date}
                places={nearby}
                onAdd={(key, id) => runOp({ op: "scheduleItem", key, itemId: id, date: d.date })}
                onManual={() => {
                  setAddOpen(false);
                  void addItem();
                }}
                onClose={() => setAddOpen(false)}
              />
            ) : (
              <p>
                <button className="btn ghost" type="button" onClick={() => setAddOpen(true)}>
                  ＋ 新增活動
                </button>
              </p>
            ))}
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
          <DayMap
            day={d}
            ends={ends}
            active={active}
            focusId={focusId}
            nearby={(showNearby ? nearby : [])
              .filter((n) => n.i.lat != null && n.i.lng != null)
              .slice(0, 8)
              .map((n) => ({
                id: n.i.id,
                key: n.p.key,
                lat: n.i.lat!,
                lng: n.i.lng!,
                name: n.i.name,
                sub: [n.i.cat ? CATEGORY_META[n.i.cat].t : "", distanceLabel(n.km)].filter(Boolean).join("・"),
                photo: n.i.photo?.url,
                icon: n.i.cat ? CATEGORY_META[n.i.cat].icon : undefined,
              }))}
            onAdd={editable ? (key, id) => runOp({ op: "scheduleItem", key, itemId: id, date: d.date }) : undefined}
          />
          <div className="day-map-tools">
            <label className="toggle small">
              <input type="checkbox" checked={showNearby} onChange={(e) => setShowNearby(e.target.checked)} /> 附近景點
            </label>
            {editable && roadLegs && route.slice(1).some((s, k) => (s.drive || (softTravel(s.mode) && !s.gap)) && !roadLegs[k]) && (
              <PendingButton className="btn ghost small" pendingLabel="計算中…" onAction={() => computeLegs(route)}>
                重新計算路線
              </PendingButton>
            )}
          </div>

          <p className="map-note map-legend small muted">
            <span role="img" aria-label="實線是開車路線"><Icon name="car" size={14} /> ━</span>{" "}
            <span role="img" aria-label="虛線是步行或大眾運輸（沿實際路線）"><Icon name="walk" size={14} /> ┅</span>{" "}
            {roadLegs && route.slice(1).some((s, k) => (s.drive || (softTravel(s.mode) && !s.gap)) && !roadLegs[k]) ? "有路段還沒算出路線（可能是今天的 Google 用量上限到了）；可以按「重新計算路線」，或明天再打開這天。" : ""}
          </p>
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
