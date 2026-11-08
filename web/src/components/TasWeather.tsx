"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import type * as Leaflet from "leaflet";
import { useTrip } from "./TripApp";
import { useReducedMotion } from "./ui";
import { Icon } from "./Icon";
import { WxIcon, wxIconSvg } from "./Weather";
import { blockPagePinch, loadLeaflet, pinchZoom, tiles, ZOOM_OPTIONS } from "./MapViews";
import { project, rubber, spring } from "./motion";
import { releaseVelocity } from "./DriftGallery";
import { api } from "@/client/api";
import { wxLabel } from "@/domain/weather";
import { createPortal } from "react-dom";
import { declutter, hobartToday, mergeNightRain, wxSeverity, secondsToHobartMidnight, kpWindow, REGIONS, risks, skyScore, tripPoint, wetHour, type HourDay, type HourRow, type RegionKey, type TasDay, type TasPoint } from "@/domain/tas-weather";
import { getLang, t } from "@/i18n/current";

/*
 * 天氣 (Kai 2026-11-08, docs/PLAN-2026-11-08-weather.md): Tasmania-wide forecast on a map and by region.
 * Icons and numbers first, text behind a tap (Aya skips long text). Day ↔ night (aurora) on one toggle.
 */

type Resp = {
  points: TasPoint[];
  days: Record<string, TasDay[]>;
  kp: { time: string; kp: number; kind: string }[];
  fetchedAt: string;
  stale: boolean;
  source: string;
  url: string;
};
type Mode = "day" | "night";
type HourlyResp = {
  id: string;
  days: HourDay[];
  summary: TasDay[];
  fetchedAt: string;
  url?: string;
  stale: boolean;
};

const BOM = "https://www.bom.gov.au/tas/warnings/";
const TIER2_ZOOM = 8.3;

let memo: { at: number; day: string; p: Promise<Resp | null> } | null = null;
/** The summary, kept 15 minutes and never across a Hobart date boundary. */
function loadTas(day: string): Promise<Resp | null> {
  if (memo && memo.day === day && Date.now() - memo.at < 15 * 60_000) return memo.p;
  const p = api<Resp>("/api/weather/tas").then((r) => (r.ok ? r.data : null));
  memo = { at: Date.now(), day, p };
  void p.then((v) => !v && (memo = null));
  return p;
}

/** One point's hours, loaded when its sheet opens; kept 15 minutes like the summary. */
const hourMemo = new Map<string, { at: number; p: Promise<HourlyResp | null> }>();
function loadHourly(id: string, today: string): Promise<HourlyResp | null> {
  // Keyed by the Hobart date too: after midnight the ten-day window moves on, so yesterday's copy is not reused.
  const key = `${id}@${today}`;
  const hit = hourMemo.get(key);
  if (hit && Date.now() - hit.at < 15 * 60_000) return hit.p;
  const p = api<HourlyResp>(`/api/weather/tas/hourly?id=${encodeURIComponent(id)}`).then((r) => (r.ok ? r.data : null));
  hourMemo.set(key, { at: Date.now(), p });
  void p.then((v) => !v && hourMemo.delete(key));
  return p;
}

/** Hobart's date, re-rendered at the next Hobart midnight and when the page comes back into view. */
function useHobartDate(): string {
  const [d, setD] = useState(() => hobartToday());
  useEffect(() => {
    let timer = 0;
    const tick = () => {
      setD(hobartToday());
      window.clearTimeout(timer);
      // Wake just after the next Hobart midnight (DST-aware); a sleeping device is caught by visibilitychange.
      timer = window.setTimeout(tick, (secondsToHobartMidnight() + 1) * 1000);
    };
    const onVis = () => document.visibilityState === "visible" && tick();
    tick();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);
  return d;
}

const deg = (v: number | null) => (v == null ? "–" : `${Math.round(v)}°`);
const name = (p: TasPoint) => (getLang() === "zh" ? p.name : p.en);
const wk = (date: string) => {
  const d = new Date(date + "T12:00:00Z");
  const lang = getLang();
  return new Intl.DateTimeFormat(lang === "en" ? "en-AU" : lang === "ja" ? "ja-JP" : "zh-TW", { weekday: "short", timeZone: "UTC" }).format(d);
};
const md = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

function skyLabel(day: TasDay | undefined) {
  const s = day ? skyScore(day.nightCloud, day.nightLow) : null;
  return s;
}

/** Marker markup for one point on one date. */
function markerHtml(p: TasPoint, day: TasDay | undefined, mode: Mode, here: boolean) {
  const r = day ? risks(day) : { wind: false, frost: false };
  const nr = day?.nightRain?.length ? `<span class="tw-warn nr" title="${rainHint(day.nightRain)}">${moonRainSvg}</span>` : "";
  const warn = `${r.wind ? `<span class="tw-warn" title="${t("強風")}">${windSvg}</span>` : ""}${r.frost ? `<span class="tw-warn frost" title="${t("可能結霜")}">❄︎</span>` : ""}${nr}`;
  const badge = here ? `<span class="tw-here">${t("我們")}</span>` : "";
  if (!day) return `<div class="tw-mk none">${badge}<span>–</span></div>`;
  if (mode === "night") {
    const s = skyScore(day.nightCloud, day.nightLow);
    return `<div class="tw-mk night ${s?.band ?? "na"}${here ? " is-here" : ""}">${badge}<span class="tw-sky">${s ? `${day.nightLow}<small>%</small>` : "–"}</span>${warn}</div>`;
  }
  const wet = (dayPop(day) ?? 0) >= 60 ? " wet" : "";
  return `<div class="tw-mk${wet}${here ? " is-here" : ""}">${badge}${wxIconSvg(dayCode(day), 22)}<span class="tw-t"><b>${deg(day.tMax)}</b><i>${deg(day.tMin)}</i></span>${warn}</div>`;
}
const moonRainSvg = `<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path d="M16.5 3.5a5.5 5.5 0 1 0 4 9.2 4.6 4.6 0 0 1-4-9.2z M7 15.5l-1.2 3 M11 15.5l-1.2 3 M15 17l-1.2 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const windSvg = `<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path d="M3 9h11a2.5 2.5 0 1 0-2.5-2.5 M3 13h15a2.5 2.5 0 1 1-2.5 2.5 M3 17h7a2 2 0 1 1-2 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

/** Daylight values (sunrise–sunset), falling back to the whole day for a forecast cached before they existed. */
const dayCode = (d: TasDay) => d.dayCode ?? d.code;
const dayPop = (d: TasDay) => (d.dayCode == null ? d.pop : d.dayPop);
/** 「雨在 02–05 點」: rain that falls only outside daylight. */
const rainHint = (ranges: string[]) => t("雨在 {h} 點").replace("{h}", ranges.join("、"));

export function TasWeather({ active }: { active: boolean }) {
  const { doc } = useTrip();
  const reduce = useReducedMotion();
  const today = useHobartDate();
  const [data, setData] = useState<Resp | null | "error">(null);
  const [mode, setMode] = useState<Mode>("day");
  const [picked, setPicked] = useState<string | null>(null);
  const [sheet, setSheet] = useState<RegionKey | null>(null);
  const [hourly, setHourly] = useState<string | null>(null);

  // Revalidated at Hobart midnight and whenever the tab shows again (the panel stays mounted while hidden);
  // a fresh memo returns the same object, so nothing re-renders. A failed refresh keeps what is showing.
  useEffect(() => {
    if (!active) return;
    let live = true;
    void loadTas(today).then((v) => live && setData((prev) => v ?? (prev && prev !== "error" ? prev : "error")));
    return () => {
      live = false;
    };
  }, [today, active]);

  const resp = data && data !== "error" ? data : null;
  const dates = useMemo(() => (resp ? (resp.days[resp.points[0].id] ?? []).map((d) => d.date).filter((d) => d >= today) : []), [resp, today]);
  const date = picked && dates.includes(picked) ? picked : (dates[0] ?? today);
  const tripByDate = useMemo(() => new Map(doc.days.map((d) => [d.date, tripPoint(doc, d)])), [doc]);
  const here = tripByDate.get(date) ?? null;
  const kp = resp ? kpWindow(resp.kp, date) : null;
  const dayOf = (id: string, dt = date) => resp?.days[id]?.find((x) => x.date === dt);

  if (data === null) return <p className="muted tw-loading">{t("天氣載入中…")}</p>;
  if (!resp) return <p className="muted">{t("天氣暫時無法取得，稍後再試。")}</p>;

  return (
    <div className="tw">
      <DayStrip dates={dates} date={date} onPick={setPicked} trip={tripByDate} reduce={reduce} />
      <div className="tw-map-wrap">
        <TasMap active={active} points={resp.points} dayOf={(id) => dayOf(id)} mode={mode} here={here} reduce={reduce} onOpen={setHourly} />
        <div className="tw-float">
          <Segmented mode={mode} onChange={setMode} reduce={reduce} />
          {mode === "night" && kp && (
            <span className="tw-kp">
              {t("極光指數")} Kp {kp.kp}（{kp.from}–{kp.to}）
            </span>
          )}
          {here === "syd" && <span className="tw-kp">{t("這天在雪梨")}</span>}
        </div>
        {mode === "night" && (
          <div className="tw-legend" aria-hidden="true">
            <span className="clear" />
            {t("晴")}
            <span className="some" />
            {t("部分")}
            <span className="cloudy" />
            {t("多雲")}
          </div>
        )}
      </div>

      <section className="tw-regions" aria-label={t("各地區")}>
        {REGIONS.map((rg) => (
          <RegionCard key={rg.key} region={rg} points={resp.points.filter((p) => p.region === rg.key)} date={date} dates={dates} dayOf={dayOf} mode={mode} here={here} onOpen={() => setSheet(rg.key)} />
        ))}
      </section>

      <footer className="tw-foot small muted">
        <a href={resp.url} target="_blank" rel="noopener noreferrer">
          {t("天氣資料：Open-Meteo（CC BY 4.0）")}
        </a>
        <span>
          {t("更新")}{" "}
          {new Intl.DateTimeFormat("zh-TW", {
            timeZone: "Australia/Hobart",
            month: "numeric",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }).format(new Date(resp.fetchedAt))}
          {resp.stale ? `（${t("舊資料")}）` : ""}
        </span>
        <a href={BOM} target="_blank" rel="noopener noreferrer">
          <Icon name="warn" size={14} /> {t("BOM 天氣警報")}
        </a>
        <span>{t("預報僅供參考，出發前再確認。")}</span>
      </footer>

      {sheet && (
        <RegionSheet
          region={REGIONS.find((r) => r.key === sheet)!}
          points={resp.points.filter((p) => p.region === sheet)}
          dayOf={(id) => dayOf(id)}
          date={date}
          here={here}
          reduce={reduce}
          onOpen={setHourly}
          onClose={() => setSheet(null)}
        />
      )}
      {hourly && (
        <HourlySheet
          point={resp.points.find((p) => p.id === hourly)!}
          day={dayOf(hourly)}
          date={date}
          dates={dates}
          onPick={setPicked}
          trip={tripByDate}
          mode={mode}
          kp={kp}
          here={here}
          reduce={reduce}
          onClose={() => setHourly(null)}
        />
      )}
    </div>
  );
}

/* ---------- Horizontal strips: native scroll with snap for touch (the platform's own momentum), drag + spring for a mouse ---------- */

/**
 * Mouse drag for a horizontal scroller: 10 px hysteresis, then 1:1; on release the velocity is projected and
 * the strip springs (critically damped, from where it is) to the nearest `unit()` step. A drag is not a click.
 */
function useDragScroll(ref: RefObject<HTMLDivElement | null>, unit: () => number, reduce: boolean) {
  const drag = useRef<{
    id: number;
    x0: number;
    s0: number;
    moved: boolean;
    samples: { t: number; pos: number }[];
  } | null>(null);
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);
  // CSS snap would re-snap every frame of a spring or a mouse drag; it is off while we move the strip ourselves.
  const halt = () => {
    stop.current?.();
    stop.current = null;
    if (ref.current) ref.current.style.scrollSnapType = "";
  };

  const scrollTo = (to: number, v = 0) => {
    const el = ref.current;
    if (!el) return;
    halt();
    if (reduce) {
      el.scrollLeft = to;
      return;
    }
    el.style.scrollSnapType = "none";
    stop.current = spring(el.scrollLeft, v, to, 0.4, (x) => (el.scrollLeft = x), () => (el.style.scrollSnapType = ""));
  };
  const onPointerDown = (e: ReactPointerEvent) => {
    // Any touch or click catches a moving strip where it is.
    halt();
    if (e.pointerType !== "mouse" || !ref.current) return;
    drag.current = {
      id: e.pointerId,
      x0: e.clientX,
      s0: ref.current.scrollLeft,
      moved: false,
      samples: [{ t: e.timeStamp, pos: ref.current.scrollLeft }],
    };
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    const el = ref.current;
    if (!d || !el || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x0;
    if (!d.moved && Math.abs(dx) < 10) return;
    if (!d.moved) {
      el.setPointerCapture(e.pointerId);
      el.style.scrollSnapType = "none";
    }
    d.moved = true;
    el.scrollLeft = d.s0 - dx;
    d.samples.push({ t: e.timeStamp, pos: el.scrollLeft });
    if (d.samples.length > 12) d.samples.shift();
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    const d = drag.current;
    const el = ref.current;
    drag.current = null;
    if (!d || !el || !d.moved) return;
    const v = releaseVelocity(d.samples, e.timeStamp);
    const u = unit();
    const max = el.scrollWidth - el.clientWidth;
    scrollTo(Math.max(0, Math.min(max, Math.round((el.scrollLeft + project(v)) / u) * u)), v);
    const swallow = (ev: Event) => {
      ev.stopPropagation();
      ev.preventDefault();
    };
    el.addEventListener("click", swallow, { capture: true, once: true });
    window.setTimeout(() => el.removeEventListener("click", swallow, { capture: true }), 0);
  };
  return {
    scrollTo,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
    },
  };
}

function DayStrip({ dates, date, onPick, trip, reduce, sticky = true }: { dates: string[]; date: string; onPick: (d: string) => void; trip: Map<string, string>; reduce: boolean; sticky?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollTo, handlers } = useDragScroll(ref, () => (ref.current?.firstElementChild as HTMLElement | null)?.offsetWidth ?? 64, reduce);

  // Keep the picked day in view, animating from where the strip is now.
  useEffect(() => {
    const el = ref.current;
    const chip = el?.querySelector<HTMLElement>(`[data-date="${date}"]`);
    if (!el || !chip) return;
    scrollTo(Math.max(0, Math.min(el.scrollWidth - el.clientWidth, chip.offsetLeft - el.clientWidth / 2 + chip.offsetWidth / 2)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, reduce]);

  const onKey = (e: React.KeyboardEvent) => {
    const i = dates.indexOf(date);
    const j = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : -1;
    if (j < 0 || j >= dates.length) return;
    e.preventDefault();
    onPick(dates[j]);
    ref.current?.querySelector<HTMLElement>(`[data-date="${dates[j]}"]`)?.focus();
  };
  return (
    <div className={`tw-strip${sticky ? "" : " in-sheet"}`} ref={ref} role="tablist" aria-label={t("選日期")} {...handlers} onKeyDown={onKey}>
      {dates.map((d) => {
        const tp = trip.get(d);
        return (
          <button key={d} type="button" role="tab" data-date={d} aria-selected={d === date} tabIndex={d === date ? 0 : -1} className={`tw-chip${d === date ? " on" : ""}`} onClick={() => onPick(d)}>
            <span className="wd">{wk(d)}</span>
            <span className="dt">{md(d)}</span>
            {tp && tp !== "syd" && <span className="trip-dot" aria-label={t("行程日")} />}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Segmented 白天 / 晚上・極光: the thumb springs from where it is ---------- */

function Segmented({ mode, onChange, reduce }: { mode: Mode; onChange: (m: Mode) => void; reduce: boolean }) {
  const thumb = useRef<HTMLSpanElement>(null);
  const pos = useRef(mode === "day" ? 0 : 1);
  useEffect(() => {
    const el = thumb.current;
    if (!el) return;
    const to = mode === "day" ? 0 : 1;
    const paint = (x: number) => {
      pos.current = x;
      el.style.transform = `translateX(${x * 100}%)`;
    };
    if (reduce) {
      paint(to);
      return;
    }
    return spring(pos.current, 0, to, 0.35, paint);
  }, [mode, reduce]);
  return (
    <div className="tw-seg" role="radiogroup" aria-label={t("白天或晚上")}>
      <span className="tw-seg-thumb" ref={thumb} aria-hidden="true" />
      <button type="button" role="radio" aria-checked={mode === "day"} className={mode === "day" ? "on" : ""} onClick={() => onChange("day")}>
        <Icon name="uv" size={16} /> {t("白天")}
      </button>
      <button type="button" role="radio" aria-checked={mode === "night"} className={mode === "night" ? "on" : ""} onClick={() => onChange("night")}>
        <Icon name="eye" size={16} /> {t("晚上・極光")}
      </button>
    </div>
  );
}

/* ---------- Map ---------- */

function TasMap({
  active,
  points,
  dayOf,
  mode,
  here,
  reduce,
  onOpen,
}: {
  active: boolean;
  points: TasPoint[];
  dayOf: (id: string) => TasDay | undefined;
  mode: Mode;
  here: string | null;
  reduce: boolean;
  onOpen: (id: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const markers = useRef(new Map<string, Leaflet.Marker>());
  const latest = useRef({ dayOf, mode, here, onOpen });
  useEffect(() => {
    latest.current = { dayOf, mode, here, onOpen };
  });
  const [ready, setReady] = useState(false);

  const layout = () => {
    const m = map.current;
    if (!m) return;
    const z = m.getZoom();
    const boxes = points
      .map((p) => {
        const mk = markers.current.get(p.id);
        const pt = m.latLngToContainerPoint([p.lat, p.lng]);
        const isHere = p.id === latest.current.here;
        const eligible = isHere || p.tier === 1 || z >= TIER2_ZOOM;
        return {
          p,
          mk,
          x: pt.x,
          y: pt.y,
          prio: isHere ? 3 : p.tier === 1 ? 2 : 1,
          eligible,
        };
      })
      .filter((b) => b.mk);
    const kept = declutter(boxes.filter((b) => b.eligible));
    for (const b of boxes) {
      const el = b.mk!.getElement();
      if (el) el.style.display = kept.has(b) ? "" : "none";
    }
  };

  const paint = () => {
    const { dayOf: dOf, mode: md0, here: h } = latest.current;
    for (const p of points) {
      const mk = markers.current.get(p.id);
      const el = mk?.getElement();
      if (!mk || !el) continue;
      const html = markerHtml(p, dOf(p.id), md0, h === p.id);
      const inner = el.firstElementChild as HTMLElement | null;
      if (inner && inner.outerHTML === html) continue;
      el.innerHTML = html;
      el.setAttribute("aria-label", `${name(p)}`);
      if (!reduce) {
        el.classList.remove("tw-fade");
        void el.offsetWidth;
        el.classList.add("tw-fade");
      }
    }
    layout();
  };

  useEffect(() => {
    if (!active || map.current || !box.current) return;
    let live = true;
    void loadLeaflet().then((L) => {
      if (!live || !box.current) return;
      const m = L.map(box.current, {
        zoomControl: false,
        attributionControl: true,
        scrollWheelZoom: false,
        ...ZOOM_OPTIONS,
      });
      tiles(L).addTo(m);
      // Room for the floating controls on top and the 46 px markers on every side.
      m.fitBounds(
        [
          [-43.62, 144.62],
          [-40.7, 148.33],
        ],
        { paddingTopLeft: [28, 64], paddingBottomRight: [28, 28] },
      );
      // A plain wheel scrolls the page; a trackpad pinch (ctrl+wheel) zooms the map.
      pinchZoom(m);
      for (const p of points) {
        const mk = L.marker([p.lat, p.lng], {
          icon: L.divIcon({
            className: "tw-pin",
            html: "",
            iconSize: [46, 46],
            iconAnchor: [23, 23],
            popupAnchor: [0, -20],
          }),
          keyboard: true,
          title: name(p),
          riseOnHover: true,
        }).addTo(m);
        // A tap (or Enter on the focused marker) opens that place's hours.
        mk.on("click", () => latest.current.onOpen(p.id));
        markers.current.set(p.id, mk);
      }
      m.on("zoomend moveend", layout);
      map.current = m;
      setReady(true);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Page pinch stays blocked over the map whenever the tab is showing.
  useEffect(() => {
    if (!active || !box.current) return;
    return blockPagePinch(box.current);
  }, [active]);

  useEffect(() => {
    if (ready) paint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, dayOf, mode, here]);

  useEffect(() => {
    if (active) map.current?.invalidateSize();
  }, [active]);

  useEffect(
    () => () => {
      map.current?.remove();
      map.current = null;
    },
    [],
  );

  return <div className="tw-map" ref={box} role="region" aria-label={t("塔斯馬尼亞天氣地圖")} />;
}

/* ---------- Region cards ---------- */

/**
 * A region's weather for a date: its most frequent daylight code (ties go to the better weather), the
 * temperature range, its warnings, and the night-only rain hours of any point when the daytime is dry.
 */
function regionSummary(points: TasPoint[], dayOf: (id: string, dt?: string) => TasDay | undefined, dt: string) {
  const days = points.map((p) => dayOf(p.id, dt)).filter((d): d is TasDay => !!d);
  if (!days.length) return null;
  const counts = new Map<number, number>();
  for (const d of days) counts.set(dayCode(d), (counts.get(dayCode(d)) ?? 0) + 1);
  const code = [...counts].sort((a, b) => b[1] - a[1] || wxSeverity(a[0]) - wxSeverity(b[0]))[0][0];
  const nums = (xs: (number | null)[]) => xs.filter((x): x is number => x != null);
  const highs = nums(days.map((d) => d.tMax));
  const lows = nums(days.map((d) => d.tMin));
  const pops = nums(days.map(dayPop));
  const hi = highs.length ? Math.max(...highs) : null;
  const lo = lows.length ? Math.min(...lows) : null;
  const pop = pops.length ? Math.max(...pops) : null;
  const wind = days.some((d) => risks(d).wind);
  const frost = days.some((d) => risks(d).frost);
  const sky = days.map((d) => skyScore(d.nightCloud, d.nightLow)).filter((s): s is NonNullable<typeof s> => !!s);
  const bestSky = sky.length ? sky.reduce((a, b) => (b.score < a.score ? b : a)) : null;
  const nightRain = wetHour({ code, mm: null }) ? [] : mergeNightRain(days.flatMap((d) => d.nightRain ?? []));
  return { code, hi, lo, pop, wind, frost, bestSky, nightRain };
}

function RegionCard({
  region,
  points,
  date,
  dates,
  dayOf,
  mode,
  here,
  onOpen,
}: {
  region: (typeof REGIONS)[number];
  points: TasPoint[];
  date: string;
  dates: string[];
  dayOf: (id: string, dt?: string) => TasDay | undefined;
  mode: Mode;
  here: string | null;
  onOpen: () => void;
}) {
  const s = regionSummary(points, dayOf, date);
  const isHere = points.some((p) => p.id === here);
  const next = dates.slice(dates.indexOf(date), dates.indexOf(date) + 5);
  const said = s
    ? [
        t(region.name),
        isHere ? t("我們在這") : "",
        mode === "night" ? (s.bestSky ? `${t("最好")} ${s.bestSky.score}` : "") : `${t(wxLabel(s.code).t)} ${deg(s.hi)}／${deg(s.lo)}`,
        mode === "day" && s.pop != null ? `${t("降雨")} ${s.pop}%` : "",
        s.nightRain.length ? rainHint(s.nightRain) : "",
        s.wind ? t("強風") : "",
        s.frost ? t("可能結霜") : "",
      ]
        .filter(Boolean)
        .join("，")
    : t(region.name);
  return (
    <button type="button" className={`tw-card${isHere ? " here" : ""}`} onClick={onOpen} aria-label={said}>
      <span className="tw-card-head">
        <strong>{t(region.name)}</strong>
        {isHere && <span className="tw-here-tag">{t("我們在這")}</span>}
        <span className="tw-card-warn">
          {s?.wind && <Icon name="wind" size={14} label={t("強風")} />}
          {s?.frost && <span title={t("可能結霜")}>❄︎</span>}
        </span>
      </span>
      {s ? (
        mode === "night" ? (
          <span className="tw-card-main">
            <span className={`tw-sky-dot ${s.bestSky?.band ?? "na"}`} />
            <span className="tw-card-t">{s.bestSky ? `${t("最好")} ${s.bestSky.score}` : "–"}</span>
            {s.nightRain.length > 0 && <NightRain ranges={s.nightRain} />}
          </span>
        ) : (
          <span className="tw-card-main">
            <WxIcon code={s.code} size={30} />
            <span className="tw-card-t">
              <b>{deg(s.hi)}</b> <i>{deg(s.lo)}</i>
            </span>
            <span className={`tw-rain${(s.pop ?? 0) >= 60 ? " wet" : ""}`}>
              <Icon name="droplet" size={12} /> {s.pop == null ? "–" : `${s.pop}%`}
            </span>
            {s.nightRain.length > 0 && <NightRain ranges={s.nightRain} />}
          </span>
        )
      ) : (
        <span className="muted">–</span>
      )}
      <span className="tw-mini" aria-hidden="true">
        {next.map((d) => {
          const x = regionSummary(points, dayOf, d);
          return (
            <span key={d} className={d === date ? "on" : ""}>
              <small>{wk(d)}</small>
              {x ? <WxIcon code={x.code} size={16} /> : "–"}
              <small>{x ? deg(x.hi) : ""}</small>
            </span>
          );
        })}
      </span>
    </button>
  );
}

/** Small moon-with-drops and the hours: rain that falls only outside daylight. */
function NightRain({ ranges }: { ranges: string[] }) {
  return (
    <span className="tw-nr" title={rainHint(ranges)}>
      <Icon name="moonRain" size={14} />
      {ranges.join(" ")}
    </span>
  );
}

/* ---------- Sheets: rise from the bottom, follow the finger, project the release, rubber-band upward, leave the way they came ---------- */

/** Open sheets, newest last: Escape and the focus trap belong to the top one only. */
const sheetStack: symbol[] = [];

/** `head` sits in the draggable header row, before the close button; `children` scroll below it. */
function Sheet({ label, head, reduce, onClose, className = "", children }: { label: string; head: ReactNode; reduce: boolean; onClose: () => void; className?: string; children: ReactNode }) {
  const sheet = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const y = useRef(0);
  const h = useRef(600);
  const stop = useRef<(() => void) | null>(null);
  const fadeTimer = useRef(0);
  const closing = useRef(false);
  const opener = useRef<Element | null>(null);
  const drag = useRef<{
    id: number;
    y0: number;
    moved: boolean;
    samples: { t: number; pos: number }[];
  } | null>(null);

  const paint = () => {
    if (sheet.current) sheet.current.style.transform = `translate3d(0, ${y.current}px, 0)`;
    if (scrim.current) scrim.current.style.opacity = String(Math.max(0, 1 - y.current / h.current));
  };
  const to = (target: number, v0: number, done?: () => void) => {
    stop.current?.();
    window.clearTimeout(fadeTimer.current);
    if (reduce) {
      // Cross-fade instead of motion.
      y.current = 0;
      paint();
      if (sheet.current) sheet.current.style.opacity = target === 0 ? "1" : "0";
      if (scrim.current) scrim.current.style.opacity = target === 0 ? "1" : "0";
      fadeTimer.current = window.setTimeout(() => done?.(), target === 0 ? 0 : 160);
      return;
    }
    stop.current = spring(
      y.current,
      v0,
      target,
      0.3,
      (x) => {
        y.current = x;
        paint();
      },
      done,
    );
  };
  const close = (v0 = 0) => {
    if (closing.current) return;
    closing.current = true;
    to(h.current, v0, onClose);
  };

  useEffect(() => {
    const me = Symbol(label);
    sheetStack.push(me);
    opener.current = document.activeElement;
    h.current = sheet.current?.offsetHeight ?? 600;
    y.current = reduce ? 0 : h.current;
    if (reduce && sheet.current) sheet.current.style.opacity = "0";
    paint();
    requestAnimationFrame(() => to(0, 0));
    sheet.current?.focus({ preventScroll: true });
    // Everything behind the sheet (a sheet under it included) is inert while it is open; Tab cycles inside it.
    const host = sheet.current?.parentElement;
    const behind = [...document.body.children].filter((el) => el !== host && !el.hasAttribute("inert")) as HTMLElement[];
    behind.forEach((el) => el.setAttribute("inert", ""));
    const onKey = (e: KeyboardEvent) => {
      if (sheetStack[sheetStack.length - 1] !== me) return;
      if (e.key === "Escape") close();
      if (e.key !== "Tab" || !sheet.current) return;
      const f = [...sheet.current.querySelectorAll<HTMLElement>("button, [href], [tabindex]:not([tabindex='-1'])")];
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === sheet.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      sheetStack.splice(sheetStack.indexOf(me), 1);
      behind.forEach((el) => el.removeAttribute("inert"));
      window.removeEventListener("keydown", onKey);
      stop.current?.();
      (opener.current as HTMLElement | null)?.focus?.({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onDown = (e: ReactPointerEvent) => {
    // The sheet moves from its grabber and header; lists and strips keep native scrolling.
    const el = e.target as Element;
    if ((el !== e.currentTarget && !el.closest(".tw-grab, .tw-sheet-head")) || el.closest("button")) return;
    // A grab while closing catches the sheet where it is and takes it back.
    closing.current = false;
    stop.current?.();
    window.clearTimeout(fadeTimer.current);
    if (reduce && sheet.current) sheet.current.style.opacity = "1";
    drag.current = {
      id: e.pointerId,
      y0: e.clientY - y.current,
      moved: false,
      samples: [{ t: e.timeStamp, pos: y.current }],
    };
  };
  const onMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    const raw = e.clientY - d.y0;
    if (!d.moved && Math.abs(raw) < 8) return;
    if (!d.moved) (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    d.moved = true;
    y.current = raw >= 0 ? raw : rubber(raw, 200);
    d.samples.push({ t: e.timeStamp, pos: y.current });
    if (d.samples.length > 12) d.samples.shift();
    paint();
  };
  const onUp = (e: ReactPointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || !d.moved) return;
    const v = releaseVelocity(d.samples, e.timeStamp);
    if (e.type !== "pointercancel" && y.current + project(v) > h.current * 0.35) close(v);
    else to(0, v);
  };

  return createPortal(
    <div className="tw-sheet-host">
      <div ref={scrim} className="tw-scrim" onClick={() => close()} aria-hidden="true" />
      <div ref={sheet} className={`tw-sheet ${className}`} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <span className="tw-grab" aria-hidden="true" />
        <div className="tw-sheet-head">
          {head}
          <button type="button" className="btn icon small" onClick={() => close()} aria-label={t("關閉")}>
            <Icon name="close" size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

function RegionSheet({
  region,
  points,
  dayOf,
  date,
  here,
  reduce,
  onOpen,
  onClose,
}: {
  region: (typeof REGIONS)[number];
  points: TasPoint[];
  dayOf: (id: string) => TasDay | undefined;
  date: string;
  here: string | null;
  reduce: boolean;
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <Sheet
      label={t(region.name)}
      reduce={reduce}
      onClose={onClose}
      head={
        <>
          <strong>{t(region.name)}</strong>
          <span className="muted small">
            {wk(date)} {md(date)}
          </span>
        </>
      }
    >
      <ul className="tw-sheet-list">
        {points.map((p) => {
          const d = dayOf(p.id);
          const r = d ? risks(d) : null;
          const sky = skyLabel(d);
          return (
            <li key={p.id} className={p.id === here ? "here" : ""}>
              {/* The whole row opens that place's hours. */}
              <button type="button" className="tw-row" onClick={() => onOpen(p.id)}>
                <span className="nm">
                  {name(p)}
                  {p.id === here && <span className="tw-here-tag">{t("我們在這")}</span>}
                </span>
                {d ? (
                  <>
                    <WxIcon code={dayCode(d)} size={26} />
                    <span className="tw-card-t">
                      <b>{deg(d.tMax)}</b> <i>{deg(d.tMin)}</i>
                    </span>
                    <span className="facts">
                      <span className={(dayPop(d) ?? 0) >= 60 ? "wet" : ""}>
                        <Icon name="droplet" size={12} /> {dayPop(d) ?? "–"}%
                      </span>
                      {d.nightRain?.length > 0 && <NightRain ranges={d.nightRain} />}
                      <span className={r?.wind ? "warn" : ""}>
                        <Icon name="wind" size={12} /> {d.gust ?? "–"}
                      </span>
                      <span>
                        <Icon name="sunrise" size={12} /> {d.sunrise ?? "–"}
                      </span>
                      <span>
                        <Icon name="sunset" size={12} /> {d.sunset ?? "–"}
                      </span>
                      <span className={`sky ${sky?.band ?? "na"}`}>
                        <Icon name="eye" size={12} /> {d.nightLow == null ? "–" : `${d.nightLow}%`}
                      </span>
                      {r?.frost && <span className="warn">❄︎ {t("結霜")}</span>}
                    </span>
                    <span className="chev" aria-hidden="true">
                      ›
                    </span>
                  </>
                ) : (
                  <span className="muted">–</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}

/* ---------- Hourly sheet (Kai 2026-11-08): what each hour brings, night shaded ---------- */

function HourlySheet({
  point,
  day,
  date,
  dates,
  onPick,
  trip,
  mode,
  kp,
  here,
  reduce,
  onClose,
}: {
  point: TasPoint;
  day: TasDay | undefined;
  date: string;
  dates: string[];
  onPick: (d: string) => void;
  trip: Map<string, string>;
  mode: Mode;
  kp: ReturnType<typeof kpWindow>;
  here: string | null;
  reduce: boolean;
  onClose: () => void;
}) {
  const [tries, setTries] = useState(0);
  // The page's first date is Hobart's today: a new date (midnight) fetches the new window.
  const today = dates[0] ?? date;
  const want = `${point.id}#${today}#${tries}`;
  const [got, setGot] = useState<{
    key: string;
    v: HourlyResp | "error";
  } | null>(null);
  useEffect(() => {
    let live = true;
    void loadHourly(point.id, today).then((v) => live && setGot({ key: want, v: v ?? "error" }));
    return () => {
      live = false;
    };
  }, [point.id, today, want]);
  // A result for another place or attempt reads as still loading.
  const data = got?.key === want ? got.v : null;
  const res = data && data !== "error" ? data : null;
  const hd = res?.days.find((x) => x.date === date);
  // The header follows the same fetch as the hours once they arrive (the page's summary may be an hour older).
  const sum = res?.summary?.find((x) => x.date === date) ?? day;
  const sky = sum ? skyScore(sum.nightCloud, sum.nightLow) : null;

  return (
    <Sheet
      label={`${name(point)} ${t("逐時預報")}`}
      reduce={reduce}
      onClose={onClose}
      className="tw-hourly"
      head={
        <>
          <strong>{name(point)}</strong>
          {point.id === here && <span className="tw-here-tag">{t("我們在這")}</span>}
          <span className="muted small">
            {wk(date)} {md(date)}
          </span>
        </>
      }
    >
      <div className="tw-hsum">
        {sum ? (
          <>
            <WxIcon code={dayCode(sum)} size={30} />
            <span className="tw-card-t">
              <b>{deg(sum.tMax)}</b> <i>{deg(sum.tMin)}</i>
            </span>
            <span className={(dayPop(sum) ?? 0) >= 60 ? "wet" : ""}>
              <Icon name="droplet" size={12} /> {dayPop(sum) ?? "–"}%
            </span>
            {sum.nightRain?.length > 0 && <NightRain ranges={sum.nightRain} />}
            <span>
              <Icon name="sunrise" size={12} /> {sum.sunrise ?? "–"}
            </span>
            <span>
              <Icon name="sunset" size={12} /> {sum.sunset ?? "–"}
            </span>
            {mode === "night" && (
              <>
                <span className={`sky ${sky?.band ?? "na"}`} title={t("低雲")}>
                  <Icon name="eye" size={12} /> {sum.nightLow == null ? "–" : `${sum.nightLow}%`}
                </span>
                <span title={t("總雲量")}>
                  <Icon name="cloud" size={12} /> {sum.nightCloud == null ? "–" : `${sum.nightCloud}%`}
                </span>
                {kp && <span>Kp {kp.kp}</span>}
              </>
            )}
          </>
        ) : (
          <span className="muted">–</span>
        )}
      </div>
      <div className="tw-hbody">
        {/* The page's own dates: the picked one stays picked even past the hourly horizon. */}
        <DayStrip dates={dates} date={date} onPick={onPick} trip={trip} reduce={reduce} sticky={false} />
        {data === null ? (
          <div className="tw-hskel" aria-label={t("天氣載入中…")} />
        ) : !res ? (
          <p className="muted tw-herr">
            {t("逐時預報暫時無法取得")}{" "}
            <button type="button" className="btn small" onClick={() => setTries((n) => n + 1)}>
              {t("再試一次")}
            </button>
          </p>
        ) : (
          <>
            {/* Past the horizon the chart stays mounted (hidden), so coming back springs from where it was. */}
            {res.days.length > 0 && <HourChart day={hd ?? res.days[res.days.length - 1]} reduce={reduce} hidden={!hd} />}
            {!hd && <p className="muted tw-herr">{t("逐時預報只有 10 天")}</p>}
          </>
        )}
        <p className="tw-hfoot small muted">
          <a href={res?.url ?? "https://open-meteo.com/"} target="_blank" rel="noopener noreferrer">
            {t("天氣資料：Open-Meteo（CC BY 4.0）")}
          </a>
          {res && (
            <span>
              {t("更新")} {new Intl.DateTimeFormat("zh-TW", { timeZone: "Australia/Hobart", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(res.fetchedAt))}
              {res.stale ? `（${t("舊資料")}）` : ""}
            </span>
          )}
        </p>
      </div>
    </Sheet>
  );
}

/** Wakes at each hour boundary (Hobart's offsets are whole hours) and when the page comes back into view. */
function subscribeHour(cb: () => void) {
  let timer = 0;
  const arm = () => {
    timer = window.setTimeout(() => {
      cb();
      arm();
    }, 3_600_000 - (Date.now() % 3_600_000) + 500);
  };
  arm();
  const onVis = () => document.visibilityState === "visible" && cb();
  document.addEventListener("visibilitychange", onVis);
  return () => {
    window.clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVis);
  };
}
/** Unix start of the current hour (client only: the sheet never renders on the server). */
function useHourStart(): number {
  return useSyncExternalStore(subscribeHour, () => Math.floor(Date.now() / 3_600_000) * 3600, () => -1);
}

/** "02", or "02′" for the second 02:00 when clocks go back. */
const hh = (rows: HourRow[], i: number) => `${String(rows[i].h).padStart(2, "0")}${i > 0 && rows[i - 1].h === rows[i].h ? "′" : ""}`;

const COL = 48;
const CURVE_TOP = 16;
const CURVE_H = 64;

/** Monotone cubic (Fritsch–Carlson) through the points: never overshoots between hours. */
function monotonePath(pts: [number, number][]): string {
  const n = pts.length;
  if (n < 2) return n ? `M${pts[0][0]},${pts[0][1]}` : "";
  const dx = pts.slice(1).map((p, i) => p[0] - pts[i][0]);
  const m = pts.slice(1).map((p, i) => (p[1] - pts[i][1]) / dx[i]);
  const tg = pts.map((_, i) => (i === 0 ? m[0] : i === n - 1 ? m[n - 2] : m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2));
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      tg[i] = tg[i + 1] = 0;
      continue;
    }
    const a = tg[i] / m[i];
    const b = tg[i + 1] / m[i];
    const q = a * a + b * b;
    if (q > 9) {
      const k = 3 / Math.sqrt(q);
      tg[i] = k * a * m[i];
      tg[i + 1] = k * b * m[i];
    }
  }
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const h3 = dx[i] / 3;
    d += ` C${pts[i][0] + h3},${pts[i][1] + tg[i] * h3} ${pts[i + 1][0] - h3},${pts[i + 1][1] - tg[i + 1] * h3} ${pts[i + 1][0]},${pts[i + 1][1]}`;
  }
  return d;
}

function hourLabel(rows: HourRow[], i: number) {
  const r = rows[i];
  return [
    `${hh(rows, i)}:00`,
    t(wxLabel(r.code).t),
    r.t == null ? "" : `${Math.round(r.t)}°`,
    r.f == null ? "" : `${t("體感")} ${Math.round(r.f)}°`,
    r.pop == null ? "" : `${t("降雨")} ${r.pop}%`,
    r.mm == null ? "" : `${r.mm} mm`,
    r.g == null ? "" : `${t("陣風")} ${r.g}`,
    r.cl == null ? "" : `${t("雲")} ${r.cl}%`,
  ]
    .filter(Boolean)
    .join("，");
}

/** One day of hours: icons, a temperature curve with H/L, rain bars, gusts, cloud; night shaded by that place's sun times. */
function HourChart({ day, reduce, hidden = false }: { day: HourDay; reduce: boolean; hidden?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollTo, handlers } = useDragScroll(ref, () => COL, reduce);
  const rows = day.hours;
  const width = rows.length * COL;
  const temps = rows.map((r) => r.t).filter((x): x is number => x != null);
  const lo = temps.length ? Math.min(...temps) : 0;
  const hi = temps.length ? Math.max(...temps) : 1;
  // 2° of room above the high and below the low, so neither mark sits on the edge.
  const yOf = (v: number) => CURVE_TOP + (1 - (v - lo + 2) / (hi - lo + 4)) * CURVE_H;
  const pts = rows.flatMap((r, i) => (r.t == null ? [] : [[i * COL + COL / 2, yOf(r.t)] as [number, number]]));
  const iHi = rows.findIndex((r) => r.t === hi);
  const iLo = rows.findIndex((r) => r.t === lo);
  const nowU = useHourStart();
  const first = useRef(true);
  // Column of an hour (DST days have 23 or 25 rows); shading uses the same mapping.
  const xOfHour = (hf: number) => {
    const i = rows.findIndex((r) => r.h === Math.floor(hf));
    return i < 0 ? (hf < (rows[0]?.h ?? 0) ? 0 : width) : i * COL + (hf % 1) * COL;
  };
  const srX = day.sr == null ? null : xOfHour(day.sr);
  const ssX = day.ss == null ? null : xOfHour(day.ss);

  // The hour before now (today) or before sunrise: a jump on first paint, a spring from where it is when the date changes.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // While hidden (past the horizon) the strip keeps its place; it moves once it shows again.
    if (hidden) return;
    const now = rows.findIndex((r) => r.u === nowU);
    const i = Math.max(0, now >= 0 ? now - 1 : rows.findIndex((r) => r.h === Math.floor(day.sr ?? 6) - 1));
    if (first.current) el.scrollLeft = i * COL;
    else scrollTo(Math.min(el.scrollWidth - el.clientWidth, i * COL));
    first.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day.date, hidden]);

  return (
    <div className={`tw-hours${hidden ? " is-hidden" : ""}`} aria-hidden={hidden || undefined}>
      <div className="tw-hlegend" aria-hidden="true">
        <span className="r-icon" />
        <span className="r-temp">
          <Icon name="thermo" size={14} />
        </span>
        <span className="r-rain">
          <Icon name="droplet" size={14} />
        </span>
        <span className="r-gust">
          <Icon name="wind" size={14} />
        </span>
        <span className="r-cloud">
          <Icon name="cloud" size={14} />
        </span>
      </div>
      <div
        className="tw-hscroll"
        ref={ref}
        role="list"
        aria-label={t("逐時預報")}
        {...handlers}
        onKeyDown={(e) => {
          const el = ref.current;
          if (!el || (e.key !== "ArrowRight" && e.key !== "ArrowLeft")) return;
          e.preventDefault();
          scrollTo(Math.max(0, Math.min(el.scrollWidth - el.clientWidth, Math.round(el.scrollLeft / COL + (e.key === "ArrowRight" ? 3 : -3)) * COL)));
        }}
        tabIndex={0}
      >
        <div className="tw-hgrid" style={{ width }}>
          {srX != null && srX > 0 && <span className="tw-night" style={{ left: 0, width: srX }} aria-hidden="true" />}
          {ssX != null && ssX < width && <span className="tw-night" style={{ left: ssX, width: width - ssX }} aria-hidden="true" />}
          <svg className="tw-curve" width={width} height={CURVE_TOP + CURVE_H + 22} aria-hidden="true">
            <path d={monotonePath(pts)} fill="none" />
            {rows.map((r, i) =>
              r.t == null ? null : (
                <g key={i}>
                  <circle cx={i * COL + COL / 2} cy={yOf(r.t)} r={i === iHi || i === iLo ? 3.5 : 2.2} className={i === iHi ? "hi" : i === iLo ? "lo" : ""} />
                  <text x={i * COL + COL / 2} y={yOf(r.t) + (i === iLo ? 16 : -7)} textAnchor="middle" className={i === iHi || i === iLo ? "mark" : ""}>
                    {i === iHi && i === iLo ? `H/L ${Math.round(r.t)}°` : i === iHi ? `H ${Math.round(r.t)}°` : i === iLo ? `L ${Math.round(r.t)}°` : `${Math.round(r.t)}°`}
                  </text>
                </g>
              ),
            )}
          </svg>
          {rows.map((r, i) => {
            const wet = r.w === 1;
            return (
              <div key={i} className={`tw-hcol${r.d ? "" : " night"}${r.u === nowU ? " now" : ""}`} role="listitem" aria-label={hourLabel(rows, i)}>
                <span className="hh">{r.u === nowU ? t("現在") : hh(rows, i)}</span>
                <WxIcon code={r.code} size={22} night={!r.d} />
                <span className="curve-gap" />
                <span className="rain">
                  <small className="pop">{(r.pop ?? 0) >= 20 ? `${r.pop}%` : ""}</small>
                  <span
                    className={`bar${wet ? " wet" : ""}`}
                    style={{
                      height: `${Math.round(((r.pop ?? 0) / 100) * 30)}px`,
                    }}
                  />
                  <small className="mm">{r.mm != null && r.mm >= 0.1 ? r.mm : ""}</small>
                </span>
                <span className={`gust${(r.g ?? 0) >= 60 ? " warn" : ""}`}>{r.g ?? "–"}</span>
                <span className="cloud">
                  <span
                    className="all"
                    style={{
                      height: `${Math.round(((r.cl ?? 0) / 100) * 18)}px`,
                    }}
                  />
                  <span
                    className="low"
                    style={{
                      height: `${Math.round(((r.lo ?? 0) / 100) * 18)}px`,
                    }}
                  />
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
