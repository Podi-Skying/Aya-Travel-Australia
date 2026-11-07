"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
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
import { declutter, hobartToday, secondsToHobartMidnight, kpWindow, REGIONS, risks, skyScore, tripPoint, type RegionKey, type TasDay, type TasPoint } from "@/domain/tas-weather";
import { getLang, t } from "@/i18n/current";

/*
 * 天氣 (Kai 2026-11-08, docs/PLAN-2026-11-08-weather.md): Tasmania-wide forecast on a map and by region.
 * Icons and numbers first, text behind a tap (Aya skips long text). Day ↔ night (aurora) on one toggle.
 */

type Resp = { points: TasPoint[]; days: Record<string, TasDay[]>; kp: { time: string; kp: number; kind: string }[]; fetchedAt: string; stale: boolean; source: string; url: string };
type Mode = "day" | "night";

const BOM = "https://www.bom.gov.au/tas/warnings/";
const TIER2_ZOOM = 8.3;

let memo: { at: number; p: Promise<Resp | null> } | null = null;
function loadTas(): Promise<Resp | null> {
  if (memo && Date.now() - memo.at < 15 * 60_000) return memo.p;
  const p = api<Resp>("/api/weather/tas").then((r) => (r.ok ? r.data : null));
  memo = { at: Date.now(), p };
  void p.then((v) => !v && (memo = null));
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
  const warn = `${r.wind ? `<span class="tw-warn" title="${t("強風")}">${windSvg}</span>` : ""}${r.frost ? `<span class="tw-warn frost" title="${t("可能結霜")}">❄︎</span>` : ""}`;
  const badge = here ? `<span class="tw-here">${t("我們")}</span>` : "";
  if (!day) return `<div class="tw-mk none">${badge}<span>–</span></div>`;
  if (mode === "night") {
    const s = skyScore(day.nightCloud, day.nightLow);
    return `<div class="tw-mk night ${s?.band ?? "na"}${here ? " is-here" : ""}">${badge}<span class="tw-sky">${s ? `${day.nightLow}<small>%</small>` : "–"}</span>${warn}</div>`;
  }
  const wet = (day.pop ?? 0) >= 60 ? " wet" : "";
  return `<div class="tw-mk${wet}${here ? " is-here" : ""}">${badge}${wxIconSvg(day.code, 22)}<span class="tw-t"><b>${deg(day.tMax)}</b><i>${deg(day.tMin)}</i></span>${warn}</div>`;
}
const windSvg = `<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path d="M3 9h11a2.5 2.5 0 1 0-2.5-2.5 M3 13h15a2.5 2.5 0 1 1-2.5 2.5 M3 17h7a2 2 0 1 1-2 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

function popupHtml(p: TasPoint, day: TasDay | undefined, mode: Mode, kp: ReturnType<typeof kpWindow>) {
  if (!day) return `<strong>${name(p)}</strong><br>${t("尚無預報")}`;
  const rows =
    mode === "night"
      ? [
          [t("低雲"), day.nightLow == null ? "–" : `${day.nightLow}%`],
          [t("總雲量"), day.nightCloud == null ? "–" : `${day.nightCloud}%`],
          ...(kp ? [[t("極光指數"), `Kp ${kp.kp}`]] : []),
          [t("最低溫"), deg(day.tMin)],
        ]
      : [
          [t("降雨"), `${day.pop == null ? "–" : `${day.pop}%`}・${day.rain == null ? "–" : `${day.rain} mm`}`],
          [t("陣風"), day.gust == null ? "–" : `${day.gust} km/h`],
          [t("日出／日落"), `${day.sunrise ?? "–"}／${day.sunset ?? "–"}`],
          [t("白天雲量"), day.cloudDay == null ? "–" : `${day.cloudDay}%`],
        ];
  return `<div class="tw-pop"><strong>${name(p)}</strong><span class="muted">${mode === "night" ? t("晚上 22:00–03:00") : t(wxLabel(day.code).t)}</span><dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl></div>`;
}

export function TasWeather({ active }: { active: boolean }) {
  const { doc } = useTrip();
  const reduce = useReducedMotion();
  const today = useHobartDate();
  const [data, setData] = useState<Resp | null | "error">(null);
  const [mode, setMode] = useState<Mode>("day");
  const [picked, setPicked] = useState<string | null>(null);
  const [sheet, setSheet] = useState<RegionKey | null>(null);

  useEffect(() => {
    let live = true;
    void loadTas().then((v) => live && setData(v ?? "error"));
    return () => {
      live = false;
    };
  }, []);

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
        <TasMap active={active} points={resp.points} dayOf={(id) => dayOf(id)} mode={mode} here={here} kp={kp} reduce={reduce} />
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
          {t("更新")} {new Intl.DateTimeFormat("zh-TW", { timeZone: "Australia/Hobart", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(resp.fetchedAt))}
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
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}

/* ---------- Day strip: native scroll with snap for touch (the platform's own momentum), drag + spring for a mouse ---------- */

function DayStrip({ dates, date, onPick, trip, reduce }: { dates: string[]; date: string; onPick: (d: string) => void; trip: Map<string, string>; reduce: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x0: number; s0: number; moved: boolean; samples: { t: number; pos: number }[] } | null>(null);
  const stop = useRef<(() => void) | null>(null);

  // Keep the picked day in view, animating from where the strip is now.
  useEffect(() => {
    const el = ref.current;
    const chip = el?.querySelector<HTMLElement>(`[data-date="${date}"]`);
    if (!el || !chip) return;
    const to = Math.max(0, Math.min(el.scrollWidth - el.clientWidth, chip.offsetLeft - el.clientWidth / 2 + chip.offsetWidth / 2));
    stop.current?.();
    if (reduce) el.scrollLeft = to;
    else stop.current = spring(el.scrollLeft, 0, to, 0.4, (x) => (el.scrollLeft = x));
    return () => stop.current?.();
  }, [date, reduce]);

  const onDown = (e: ReactPointerEvent) => {
    if (e.pointerType !== "mouse" || !ref.current) return;
    stop.current?.();
    drag.current = { id: e.pointerId, x0: e.clientX, s0: ref.current.scrollLeft, moved: false, samples: [{ t: e.timeStamp, pos: ref.current.scrollLeft }] };
  };
  const onMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    const el = ref.current;
    if (!d || !el || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x0;
    if (!d.moved && Math.abs(dx) < 10) return;
    if (!d.moved) el.setPointerCapture(e.pointerId);
    d.moved = true;
    el.scrollLeft = d.s0 - dx;
    d.samples.push({ t: e.timeStamp, pos: el.scrollLeft });
    if (d.samples.length > 12) d.samples.shift();
  };
  const onUp = (e: ReactPointerEvent) => {
    const d = drag.current;
    const el = ref.current;
    drag.current = null;
    if (!d || !el || !d.moved) return;
    const v = releaseVelocity(d.samples, e.timeStamp);
    const chipW = (el.firstElementChild as HTMLElement | null)?.offsetWidth ?? 64;
    const max = el.scrollWidth - el.clientWidth;
    const to = Math.max(0, Math.min(max, Math.round((el.scrollLeft + project(v)) / chipW) * chipW));
    stop.current = reduce ? ((el.scrollLeft = to), null) : spring(el.scrollLeft, v, to, 0.4, (x) => (el.scrollLeft = x));
    // A drag is not a click on the chip under the pointer.
    const swallow = (ev: Event) => {
      ev.stopPropagation();
      ev.preventDefault();
    };
    el.addEventListener("click", swallow, { capture: true, once: true });
    window.setTimeout(() => el.removeEventListener("click", swallow, { capture: true }), 0);
  };
  const onKey = (e: React.KeyboardEvent) => {
    const i = dates.indexOf(date);
    const j = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : -1;
    if (j < 0 || j >= dates.length) return;
    e.preventDefault();
    onPick(dates[j]);
    ref.current?.querySelector<HTMLElement>(`[data-date="${dates[j]}"]`)?.focus();
  };
  return (
    <div className="tw-strip" ref={ref} role="tablist" aria-label={t("選日期")} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onKeyDown={onKey}>
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

function TasMap({ active, points, dayOf, mode, here, kp, reduce }: { active: boolean; points: TasPoint[]; dayOf: (id: string) => TasDay | undefined; mode: Mode; here: string | null; kp: ReturnType<typeof kpWindow>; reduce: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const markers = useRef(new Map<string, Leaflet.Marker>());
  const latest = useRef({ dayOf, mode, here, kp });
  useEffect(() => {
    latest.current = { dayOf, mode, here, kp };
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
        return { p, mk, x: pt.x, y: pt.y, prio: isHere ? 3 : p.tier === 1 ? 2 : 1, eligible };
      })
      .filter((b) => b.mk);
    const kept = declutter(boxes.filter((b) => b.eligible));
    for (const b of boxes) {
      const el = b.mk!.getElement();
      if (el) el.style.display = kept.has(b) ? "" : "none";
    }
  };

  const paint = () => {
    const { dayOf: dOf, mode: md0, here: h, kp: k } = latest.current;
    for (const p of points) {
      const mk = markers.current.get(p.id);
      const el = mk?.getElement();
      if (!mk || !el) continue;
      const html = markerHtml(p, dOf(p.id), md0, h === p.id);
      // The popup always follows the day, even when the marker face looks the same.
      mk.setPopupContent(popupHtml(p, dOf(p.id), md0, k));
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
      const m = L.map(box.current, { zoomControl: false, attributionControl: true, scrollWheelZoom: false, ...ZOOM_OPTIONS });
      tiles(L).addTo(m);
      // Room for the floating controls on top and the 46 px markers on every side.
      m.fitBounds([[-43.62, 144.62], [-40.7, 148.33]], { paddingTopLeft: [28, 64], paddingBottomRight: [28, 28] });
      // A plain wheel scrolls the page; a trackpad pinch (ctrl+wheel) zooms the map.
      pinchZoom(m);
      for (const p of points) {
        const mk = L.marker([p.lat, p.lng], {
          icon: L.divIcon({ className: "tw-pin", html: "", iconSize: [46, 46], iconAnchor: [23, 23], popupAnchor: [0, -20] }),
          keyboard: true,
          title: name(p),
          riseOnHover: true,
        }).addTo(m);
        mk.bindPopup("", { closeButton: false, className: "tw-popup", autoPanPadding: [12, 60] });
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
  }, [ready, dayOf, mode, here, kp]);

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

/** A region's weather for a date: its most frequent weather code (ties go to the better weather), the temperature range and its warnings. */
function regionSummary(points: TasPoint[], dayOf: (id: string, dt?: string) => TasDay | undefined, dt: string) {
  const days = points.map((p) => dayOf(p.id, dt)).filter((d): d is TasDay => !!d);
  if (!days.length) return null;
  const counts = new Map<number, number>();
  for (const d of days) counts.set(d.code, (counts.get(d.code) ?? 0) + 1);
  const code = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
  const nums = (xs: (number | null)[]) => xs.filter((x): x is number => x != null);
  const highs = nums(days.map((d) => d.tMax));
  const lows = nums(days.map((d) => d.tMin));
  const pops = nums(days.map((d) => d.pop));
  const hi = highs.length ? Math.max(...highs) : null;
  const lo = lows.length ? Math.min(...lows) : null;
  const pop = pops.length ? Math.max(...pops) : null;
  const wind = days.some((d) => risks(d).wind);
  const frost = days.some((d) => risks(d).frost);
  const sky = days.map((d) => skyScore(d.nightCloud, d.nightLow)).filter((s): s is NonNullable<typeof s> => !!s);
  const bestSky = sky.length ? sky.reduce((a, b) => (b.score < a.score ? b : a)) : null;
  return { code, hi, lo, pop, wind, frost, bestSky };
}

function RegionCard({ region, points, date, dates, dayOf, mode, here, onOpen }: { region: (typeof REGIONS)[number]; points: TasPoint[]; date: string; dates: string[]; dayOf: (id: string, dt?: string) => TasDay | undefined; mode: Mode; here: string | null; onOpen: () => void }) {
  const s = regionSummary(points, dayOf, date);
  const isHere = points.some((p) => p.id === here);
  const next = dates.slice(dates.indexOf(date), dates.indexOf(date) + 5);
  const said = s
    ? [
        t(region.name),
        isHere ? t("我們在這") : "",
        mode === "night" ? (s.bestSky ? `${t("最好")} ${s.bestSky.score}` : "") : `${t(wxLabel(s.code).t)} ${deg(s.hi)}／${deg(s.lo)}`,
        mode === "day" && s.pop != null ? `${t("降雨")} ${s.pop}%` : "",
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

/* ---------- Region sheet: follows the finger, projects the release, rubber-bands upward, leaves the way it came ---------- */

function RegionSheet({ region, points, dayOf, date, here, reduce, onClose }: { region: (typeof REGIONS)[number]; points: TasPoint[]; dayOf: (id: string) => TasDay | undefined; date: string; here: string | null; reduce: boolean; onClose: () => void }) {
  const sheet = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const y = useRef(0);
  const h = useRef(600);
  const stop = useRef<(() => void) | null>(null);
  const fadeTimer = useRef(0);
  const closing = useRef(false);
  const opener = useRef<Element | null>(null);
  const drag = useRef<{ id: number; y0: number; moved: boolean; samples: { t: number; pos: number }[] } | null>(null);

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
    stop.current = spring(y.current, v0, target, 0.3, (x) => {
      y.current = x;
      paint();
    }, done);
  };
  const close = (v0 = 0) => {
    if (closing.current) return;
    closing.current = true;
    to(h.current, v0, onClose);
  };

  useEffect(() => {
    opener.current = document.activeElement;
    h.current = sheet.current?.offsetHeight ?? 600;
    y.current = reduce ? 0 : h.current;
    if (reduce && sheet.current) sheet.current.style.opacity = "0";
    paint();
    requestAnimationFrame(() => to(0, 0));
    sheet.current?.focus({ preventScroll: true });
    // Everything behind the sheet is inert while it is open; Tab cycles inside it.
    const host = sheet.current?.parentElement;
    const behind = [...document.body.children].filter((el) => el !== host && !el.hasAttribute("inert")) as HTMLElement[];
    behind.forEach((el) => el.setAttribute("inert", ""));
    const onKey = (e: KeyboardEvent) => {
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
      behind.forEach((el) => el.removeAttribute("inert"));
      window.removeEventListener("keydown", onKey);
      stop.current?.();
      (opener.current as HTMLElement | null)?.focus?.({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onDown = (e: ReactPointerEvent) => {
    // The sheet moves from its grabber and header; the list keeps native scrolling.
    const el = e.target as Element;
    if ((el !== e.currentTarget && !el.closest(".tw-grab, .tw-sheet-head")) || el.closest("button")) return;
    // A grab while closing catches the sheet where it is and takes it back.
    closing.current = false;
    stop.current?.();
    window.clearTimeout(fadeTimer.current);
    if (reduce && sheet.current) sheet.current.style.opacity = "1";
    drag.current = { id: e.pointerId, y0: e.clientY - y.current, moved: false, samples: [{ t: e.timeStamp, pos: y.current }] };
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
      <div ref={sheet} className="tw-sheet" role="dialog" aria-modal="true" aria-label={t(region.name)} tabIndex={-1} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <span className="tw-grab" aria-hidden="true" />
        <div className="tw-sheet-head">
          <strong>{t(region.name)}</strong>
          <span className="muted small">
            {wk(date)} {md(date)}
          </span>
          <button type="button" className="btn icon small" onClick={() => close()} aria-label={t("關閉")}>
            <Icon name="close" size={18} />
          </button>
        </div>
        <ul className="tw-sheet-list">
          {points.map((p) => {
            const d = dayOf(p.id);
            const r = d ? risks(d) : null;
            const sky = skyLabel(d);
            return (
              <li key={p.id} className={p.id === here ? "here" : ""}>
                <span className="nm">
                  {name(p)}
                  {p.id === here && <span className="tw-here-tag">{t("我們在這")}</span>}
                </span>
                {d ? (
                  <>
                    <WxIcon code={d.code} size={26} />
                    <span className="tw-card-t">
                      <b>{deg(d.tMax)}</b> <i>{deg(d.tMin)}</i>
                    </span>
                    <span className="facts">
                      <span className={(d.pop ?? 0) >= 60 ? "wet" : ""}>
                        <Icon name="droplet" size={12} /> {d.pop ?? "–"}%
                      </span>
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
                  </>
                ) : (
                  <span className="muted">–</span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>,
    document.body,
  );
}
