"use client";

import { dayTitle } from "@/domain/day-title";
import { useEffect, useMemo, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import { useTrip } from "./TripApp";
import { Icon, iconSvg } from "./Icon";
import { PendingButton, useHobartToday, useHydrated, useReducedMotion } from "./ui";
import { ZOOM_OPTIONS, blockPagePinch, pinchZoom, cssVar, esc, loadLeaflet, tiles } from "./MapViews";
import { useLegs, type Pt, routeStops, splitLines } from "./useLegs";
import { PlaceGallery } from "./PlaceGallery";
import { creditText } from "./Photos";
import { effectiveDay } from "@/domain/effective-day";
import { dayEnds, HOUSE_SVG, stayPins } from "@/domain/home-pins";
import { fmtDay } from "@/domain/format";
import type { Category, Item, Package, TripDoc } from "@/domain/schema";

/*
 * The 地圖 tab (Kai 2026-11-02): only the map, between the header and the tab bar, with one stack of controls at
 * the top right. A tapped unscheduled place opens its card over the map. The grouped list lives in 行程方案.
 */

export const CATEGORY_META: Record<Category, { t: string; icon: string }> = {
  nature: { t: "自然・健行", icon: "cat-nature" },
  beach: { t: "海灘・海岸", icon: "cat-beach" },
  lookout: { t: "觀景點", icon: "cat-lookout" },
  wildlife: { t: "動物", icon: "cat-wildlife" },
  food: { t: "美食・咖啡", icon: "cat-food" },
  market: { t: "市集・購物", icon: "cat-market" },
  town: { t: "城鎮・老街", icon: "cat-town" },
  history: { t: "歷史・博物館", icon: "cat-history" },
  art: { t: "藝術", icon: "cat-art" },
  activity: { t: "體驗・活動", icon: "cat-activity" },
};
const OTHER = "other";

export type Place = { i: Item; p: Package };

export const mapsUrl = (name: string, lat?: number, lng?: number) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lat != null && lng != null ? `${name} ${lat},${lng}` : name)}`;

function km(a: [number, number], b: [number, number]) {
  const r = Math.PI / 180;
  const x = (b[1] - a[1]) * r * Math.cos(((a[0] + b[0]) / 2) * r);
  const y = (b[0] - a[0]) * r;
  return 6371 * Math.hypot(x, y);
}

const BASE: Record<string, [number, number]> = { syd: [-33.87, 151.21], tas: [-42.88, 147.33] };

export type NearbyPlace = Place & { km: number | null };

/** Unscheduled places of the day's region, nearest first to the day's stops (or the city when the day is empty). */
export function nearbyPlaces(doc: TripDoc, date: string, limit = 12): NearbyPlace[] {
  const day = doc.days.find((d) => d.date === date);
  if (!day) return [];
  const pts = day.items.filter((i) => i.lat != null && i.lng != null).map((i) => [i.lat!, i.lng!] as [number, number]);
  const refs = pts.length ? pts : [BASE[day.seg] ?? BASE.tas];
  return doc.attractionPool
    .filter((p) => p.seg === day.seg)
    .flatMap((p) => p.items.map((i) => ({ i, p })))
    .map((pl) => ({ ...pl, km: pl.i.lat == null || pl.i.lng == null ? null : Math.min(...refs.map((r) => km(r, [pl.i.lat!, pl.i.lng!]))) }))
    .sort((a, b) => (a.km ?? 1e9) - (b.km ?? 1e9))
    .slice(0, limit);
}

/** Rough drive time: straight-line distance × 1.3 for roads, at 70 km/h, rounded to 5 minutes. */
export function driveMinutes(straightKm: number): number {
  return Math.max(5, Math.round((straightKm * 1.3 * 60) / 70 / 5) * 5);
}

export function distanceLabel(k: number | null): string {
  if (k == null) return "沒有座標";
  return `直線約 ${k < 10 ? k.toFixed(1) : Math.round(k)} 公里・開車約 ${driveMinutes(k)} 分鐘（估計）`;
}

/** The trip day whose planned stops are closest to the place (same region). */
export function suggestDay(doc: TripDoc, place: Place): { date: string; km: number } | null {
  const { i, p } = place;
  if (i.lat == null || i.lng == null) return null;
  let best: { date: string; km: number } | null = null;
  for (const d of doc.days) {
    if (d.seg !== p.seg) continue;
    for (const s of d.items) {
      if (s.lat == null || s.lng == null) continue;
      const k = km([i.lat, i.lng], [s.lat, s.lng]);
      if (!best || k < best.km) best = { date: d.date, km: k };
    }
  }
  return best;
}

/* ---- URL state: ?tab=map&mapLayers=days,pool&mapSeg=tas&mapCat=food&place=g12&mday=2026-11-09 ---- */
type Filters = { days: boolean; pool: boolean; seg: string; cat: string; place: string | null; mday: string | null };
function readUrl(): Filters {
  const q = typeof location === "undefined" ? new URLSearchParams() : new URLSearchParams(location.search);
  const ls = (q.get("mapLayers") ?? "days,pool").split(",");
  return { days: ls.includes("days"), pool: ls.includes("pool"), seg: q.get("mapSeg") ?? "all", cat: q.get("mapCat") ?? "all", place: q.get("place"), mday: q.get("mday") };
}
function writeUrl(f: Filters) {
  const q = new URLSearchParams(location.search);
  if (q.get("tab") === "pool") q.set("tab", "map");
  const ls = [f.days && "days", f.pool && "pool"].filter(Boolean).join(",");
  const set = (k: string, v: string | null, def: string | null) => (v === def || v == null ? q.delete(k) : q.set(k, v));
  set("mapLayers", ls || "none", "days,pool");
  set("mapSeg", f.seg, "all");
  set("mapCat", f.cat, "all");
  set("place", f.place, null);
  set("mday", f.mday, null);
  q.delete("mapGroup");
  history.replaceState(history.state, "", `${location.pathname}?${q.toString()}${location.hash}`);
}

/** Fitted views stay clear of the control stack at the top right. */
const CLEAR_CONTROLS: { paddingTopLeft: [number, number]; paddingBottomRight: [number, number] } = { paddingTopLeft: [24, 28], paddingBottomRight: [72, 28] };
const CLUSTER_PX = 44;
const CLUSTER_UNTIL_ZOOM = 11;

export function PlacesMap({ active }: { active: boolean }) {
  const { doc, gotoDay, mode, online, runOp } = useTrip();
  const reduce = useReducedMotion();
  const [f, setF] = useState<Filters>(readUrl);
  const [failed, setFailed] = useState(false);
  const editable = mode === "owner" && online;
  const patch = (x: Partial<Filters>) => setF((o) => ({ ...o, ...x }));
  // chictrip review P1-c: one selected day in vermilion; 「只看今天」 is on by default during the trip.
  const today = useHobartToday();
  const [todayMode, setTodayMode] = useState(true);
  const inTrip = !!today && doc.days.some((d) => d.date === today);
  const hydrated = useHydrated();
  const selDate = !hydrated ? null : (f.mday ?? (todayMode && inTrip ? today : null));
  const selIdx = selDate ? doc.days.findIndex((d) => d.date === selDate) : -1;
  const selDay = selIdx >= 0 ? effectiveDay(doc.days[selIdx]) : null;
  // The selected day as in 每日行程: from last night's stay to tonight's (Kai 2026-10-26).
  const selStops = selDay ? routeStops(selDay.items.filter((i) => i.lat == null || i.lat > -40 === (selDay.seg === "syd")), dayEnds(doc, selDay.date)) : null;
  const legs = useLegs(selStops);
  const legsKey = legs ? legs.map((l) => (l ? l.durationS : "-")).join(",") : "";
  const [me, setMe] = useState<Pt | null>(null);
  const [meMsg, setMeMsg] = useState("");
  // 全覽: every scheduled day of every region; the redraw then fits the whole trip.
  const fitAll = () => {
    setTodayMode(false);
    fitKey.current = "";
    patch({ mday: null, seg: "all", days: true, pool: true, cat: "all", place: null });
    if (!f.mday && f.seg === "all" && f.days && f.pool && f.cat === "all" && !f.place && allBounds.current) map.current?.fitBounds(allBounds.current, { ...CLEAR_CONTROLS, animate: !reduce });
  };
  const locate = () => {
    if (!("geolocation" in navigator)) return setMeMsg("這個瀏覽器不支援定位");
    setMeMsg("定位中…");
    // Asked only on this click; the position stays in this page and is never sent anywhere.
    navigator.geolocation.getCurrentPosition(
      (p) => {
        goMe.current = true;
        setMe([p.coords.latitude, p.coords.longitude]);
        setMeMsg("");
      },
      () => setMeMsg("沒有取得位置（可能未允許定位）"),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  };

  useEffect(() => writeUrl(f), [f]);

  const places: Place[] = useMemo(() => doc.attractionPool.flatMap((p) => p.items.map((i) => ({ i, p }))), [doc.attractionPool]);
  const shown = f.pool ? places.filter((pl) => (f.seg === "all" || pl.p.seg === f.seg) && (f.cat === "all" || (pl.i.cat ?? OTHER) === f.cat)) : [];
  const selected = f.place ? places.find((pl) => pl.i.id === f.place) ?? null : null;

  /* ---------------------------------------------------------------- map */
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const dayLayer = useRef<Leaflet.LayerGroup | null>(null);
  const poolLayer = useRef<Leaflet.LayerGroup | null>(null);
  const onZoom = useRef<(() => void) | null>(null);
  const handlers = useRef({ gotoDay, select: (id: string) => patch({ place: id }) });
  useEffect(() => {
    handlers.current.gotoDay = gotoDay;
  });
  const pinsKey = shown.map((x) => x.i.id).join(",") + `|${f.place}`;
  // The map refits when the view changes (day, region, layers, first load), not on data-only redraws.
  const fitKey = useRef("");
  const allBounds = useRef<Leaflet.LatLngBounds | null>(null);
  const goMe = useRef(false);

  useEffect(() => {
    if (!active || !box.current) return;
    let cancelled = false;
    loadLeaflet()
      .then((L) => {
        if (cancelled || !box.current) return;
        if (!map.current) {
          map.current = L.map(box.current, { ...ZOOM_OPTIONS, zoomAnimation: !reduce, zoomControl: false }).setView([-38, 147], 5);
          pinchZoom(map.current);
          blockPagePinch(box.current);
          tiles(L).addTo(map.current);
          map.current.on("popupopen", (e) => {
            (e.popup.getElement() as HTMLElement | undefined)?.querySelector<HTMLAnchorElement>("[data-goto]")?.addEventListener("click", (ev) => {
              ev.preventDefault();
              map.current?.closePopup();
              handlers.current.gotoDay(Number((ev.currentTarget as HTMLElement).dataset.goto));
            });
          });
        }
        const m = map.current;
        dayLayer.current?.remove();
        dayLayer.current = L.layerGroup().addTo(m);
        poolLayer.current?.remove();
        poolLayer.current = L.layerGroup().addTo(m);
        const all: [number, number][] = [];
        const selPtsHere: [number, number][] = [];
        const ink = cssVar("--ink", "#292823");
        const red = cssVar("--vermilion", "#b83a2e");
        const popup = (d: ReturnType<typeof effectiveDay>, i: Item, idx: number) =>
          `<div class="stop-pop">${i.photo ? `<img src="${esc(i.photo.url)}" alt="" referrerpolicy="no-referrer" loading="lazy">` : ""}<div><strong>${esc(i.name)}</strong><a href="#" data-goto="${idx}" aria-label="查看當天行程">${iconSvg("calendar", 16)} ${fmtDay(d.date)}</a>${i.photo ? `<span class="src small muted">${esc(creditText(i.photo))}</span>` : ""}</div></div>`;
        if (f.days)
          doc.days.forEach((raw, idx) => {
            if (f.seg !== "all" && raw.seg !== f.seg) return;
            const d = effectiveDay(raw);
            const sel = d.date === selDate;
            const here = (i: { lat?: number; lng?: number }) => i.lat != null && i.lng != null && i.lat > -40 === (d.seg === "syd");
            const pts = d.items.filter(here).map((i) => [i.lat!, i.lng!] as [number, number]);
            if (sel) {
              // Same lines as the day map: walking dashed, everything else solid.
              const { solid, dashed } = splitLines(selStops ?? [], legs);
              if (solid.length) L.polyline(solid, { color: red, weight: 4, opacity: 0.9 }).addTo(dayLayer.current!);
              if (dashed.length) L.polyline(dashed, { color: red, weight: 3, opacity: 0.8, dashArray: "3 7" }).addTo(dayLayer.current!);
              d.items.forEach((i, k) => {
                if (!here(i)) return;
                selPtsHere.push([i.lat!, i.lng!]);
                L.marker([i.lat!, i.lng!], { icon: L.divIcon({ className: "num-hit", html: `<span class="num-marker sel-day">${k + 1}</span>`, iconSize: [44, 44] }), keyboard: true, title: `${k + 1}. ${i.name}`, zIndexOffset: 500 })
                  .addTo(dayLayer.current!)
                  .bindPopup(popup(d, i, idx), { maxWidth: 300, minWidth: 240 });
              });
              return;
            }
            // Other days: faded ink, dashed, small dots, no labels.
            if (pts.length > 1) L.polyline(pts, { color: ink, weight: 2, opacity: selDate ? 0.25 : 0.45 }).addTo(dayLayer.current!);
            d.items.forEach((i) => {
              if (!here(i)) return;
              all.push([i.lat!, i.lng!]);
              L.circleMarker([i.lat!, i.lng!], { radius: i.pri === "must" ? 5 : 4, color: "#fff", weight: 1.5, fillColor: ink, fillOpacity: selDate ? 0.45 : 0.8 })
                .addTo(dayLayer.current!)
                .bindPopup(popup(d, i, idx), { maxWidth: 300, minWidth: 240 });
            });
          });
        all.push(...selPtsHere);
        // Where they sleep: always visible, larger than activity pins; the selected day starts and ends there.
        const homePins = stayPins(doc).filter((p) => f.seg === "all" || (p.lat > -40) === (f.seg === "syd"));
        for (const p of homePins)
          L.marker([p.lat, p.lng], { icon: L.divIcon({ className: "home-hit", html: `<span class="home-pin${p.home ? " base" : ""}">${HOUSE_SVG}</span>`, iconSize: [44, 44] }), keyboard: true, title: p.home ? "住處" : `住宿：${p.name}`, zIndexOffset: 800 })
            .addTo(dayLayer.current!)
            .bindPopup(`<strong>${p.home ? "住處" : "住宿"}</strong><br>${esc(p.name === "住處" ? (doc.stays[p.key]?.name ?? "住處") : p.name)}`);
        if (selDay && selPtsHere.length) {
          const { start, end } = dayEnds(doc, selDay.date);
          // The selected day's view includes where it starts and ends.
          for (const p of [start, end]) if (p) selPtsHere.push([p.lat, p.lng]);
        }
        for (const p of homePins) all.push([p.lat, p.lng]);
        allBounds.current = all.length ? L.latLngBounds(all) : null;
        if (me) L.circleMarker(me, { radius: 7, color: "#fff", weight: 2, fillColor: "#2f6fdf", fillOpacity: 1 }).addTo(dayLayer.current!).bindTooltip("你的位置");
        const pins = shown.filter(({ i }) => i.lat != null && i.lng != null);
        pins.forEach(({ i }) => all.push([i.lat!, i.lng!]));
        const draw = () => {
          const pl = poolLayer.current;
          if (!pl) return;
          pl.clearLayers();
          const z = m.getZoom();
          const cells = new Map<string, Place[]>();
          pins.forEach((x) => {
            const pt = m.project([x.i.lat!, x.i.lng!], z);
            const key = z >= CLUSTER_UNTIL_ZOOM || x.i.id === f.place ? x.i.id : `${Math.floor(pt.x / CLUSTER_PX)}:${Math.floor(pt.y / CLUSTER_PX)}`;
            cells.set(key, [...(cells.get(key) ?? []), x]);
          });
          cells.forEach((xs) => {
            if (xs.length === 1) {
              const { i } = xs[0];
              const meta = i.cat ? CATEGORY_META[i.cat] : null;
              L.marker([i.lat!, i.lng!], {
                icon: L.divIcon({
                  className: `place-pin${i.id === f.place ? " sel" : ""}`,
                  html: meta ? iconSvg(meta.icon) : "",
                  iconSize: [28, 28],
                }),
                keyboard: true,
                title: i.name,
                zIndexOffset: i.id === f.place ? 1000 : 0,
              })
                .addTo(pl)
                .on("click", () => handlers.current.select(i.id));
              return;
            }
            const b = L.latLngBounds(xs.map((x) => [x.i.lat!, x.i.lng!] as [number, number]));
            L.marker(b.getCenter(), { icon: L.divIcon({ className: "pool-cluster", html: String(xs.length), iconSize: [32, 32] }), keyboard: true, title: `${xs.length} 個待安排景點，點一下放大` })
              .addTo(pl)
              .on("click", () => m.flyToBounds(b.pad(0.3), { animate: !reduce, maxZoom: CLUSTER_UNTIL_ZOOM + 1 }));
          });
        };
        if (onZoom.current) m.off("zoomend", onZoom.current);
        onZoom.current = draw;
        m.on("zoomend", draw);
        m.invalidateSize();
        const sel = selected?.i;
        const view = `${selDate}|${f.seg}|${f.days}`;
        const refit = fitKey.current !== view;
        fitKey.current = view;
        if (sel?.lat != null && sel.lng != null) m.flyTo([sel.lat, sel.lng], Math.max(m.getZoom(), 12), { animate: !reduce, duration: 0.8 });
        else if (goMe.current && me) {
          goMe.current = false;
          m.setView(me, Math.max(m.getZoom(), 12), { animate: !reduce });
        } else if (refit && selPtsHere.length) m.fitBounds(L.latLngBounds(selPtsHere), { ...CLEAR_CONTROLS, animate: !reduce, maxZoom: 13 });
        else if (refit && all.length) m.fitBounds(L.latLngBounds(all), { ...CLEAR_CONTROLS, animate: !reduce });
        draw();
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
    };
    // pinsKey captures the filtered places; selected is part of it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, doc.days, f.days, f.seg, pinsKey, reduce, selDate, legsKey, me]);

  useEffect(
    () => () => {
      map.current?.remove();
      map.current = null;
    },
    [],
  );

  /* ---------------------------------------------------------------- render */
  const sug = selected ? suggestDay(doc, selected) : null;

  return (
    <div className="places">
      <div className="places-map map" ref={box} role="region" aria-label="地圖：已排行程與待安排景點">
        {failed && <div className="map-fallback">地圖無法載入（可能離線）。</div>}
      </div>
      <div className="map-ctl" role="toolbar" aria-label="地圖工具">
        <button type="button" aria-label="放大" title="放大" onClick={() => map.current?.zoomIn(1, { animate: !reduce })}>
          <Icon name="plus" size={22} />
        </button>
        <button type="button" aria-label="縮小" title="縮小" onClick={() => map.current?.zoomOut(1, { animate: !reduce })}>
          <Icon name="minus" size={22} />
        </button>
        <button type="button" aria-label="全覽" title="全覽" onClick={fitAll}>
          <Icon name="fit" size={22} />
        </button>
        <button type="button" aria-label="我的位置" title="我的位置" onClick={locate}>
          <Icon name="locate" size={22} />
        </button>
      </div>
      {meMsg && (
        <span className="map-ctl-msg" role="status">
          {meMsg}
        </span>
      )}
      {selected && (
        <div className="place-float">
          <PlaceCard
            key={selected.i.id}
            place={selected}
            suggestion={sug}
            editable={editable}
            onClose={() => patch({ place: null })}
            onSchedule={async (date) => {
              const ok = await runOp({ op: "scheduleItem", key: selected.p.key, itemId: selected.i.id, date });
              if (ok) patch({ place: null });
              return ok;
            }}
          />
        </div>
      )}
    </div>
  );
}

function CardNote({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 50;
  return (
    <div className="note-wrap">
      <p className={`note-text${long && !open ? " clamp" : ""}`}>{text}</p>
      {long && (
        <button type="button" className="more" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? "收起" : "更多"}
        </button>
      )}
    </div>
  );
}

function PlaceCard({
  place,
  suggestion,
  editable,
  onClose,
  onSchedule,
}: {
  place: Place;
  suggestion: { date: string; km: number } | null;
  editable: boolean;
  onClose: () => void;
  onSchedule: (date: string) => Promise<boolean>;
}) {
  const { doc } = useTrip();
  const { i, p } = place;
  const days = doc.days.filter((d) => d.seg === p.seg);
  const [date, setDate] = useState(suggestion?.date ?? days[0]?.date ?? "");
  const meta = i.cat ? CATEGORY_META[i.cat] : null;
  // Move focus into the card when it opens (the list row that opened it is no longer shown).
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => closeRef.current?.focus({ preventScroll: true }), []);
  return (
    <article className="place-card" aria-label={`景點：${i.name}`}>
      <button type="button" className="close" ref={closeRef} onClick={onClose} aria-label="關閉景點卡片">
        <Icon name="close" size={18} />
      </button>
      <PlaceGallery item={i} className="place-card-photo" />
      <h3>{i.name}</h3>
      {i.en && <div className="en">{i.en}</div>}
      <p className="tags">
        {meta && (
          <span className="tag">
            <Icon name={meta.icon} size={14} /> {meta.t}
          </span>
        )}
        <span className="tag">{p.title.replace(/（Google 地圖收藏）/, "")}</span>
      </p>
      {i.note && <CardNote text={i.note} />}
      <p>
        <a href={mapsUrl(i.en || i.name, i.lat, i.lng)} target="_blank" rel="noopener noreferrer">
          在 Google 地圖開啟
        </a>
      </p>
      {editable && days.length > 0 && (
        <div className="sched">
          <label>
            排進哪一天
            <select value={date} onChange={(e) => setDate(e.target.value)}>
              {days.map((d) => (
                <option key={d.date} value={d.date}>
                  {fmtDay(d.date)} {dayTitle(d)}
                  {d.date === suggestion?.date ? "（建議）" : ""}
                </option>
              ))}
            </select>
          </label>
          <PendingButton className="btn small" disabled={!date} pendingLabel="排入中…" onAction={() => onSchedule(date)}>
            排入
          </PendingButton>
          {suggestion && (
            <p className="muted small">
              建議 {fmtDay(suggestion.date)}：離當天行程最近（直線約 {Math.round(suggestion.km)} 公里）。
            </p>
          )}
        </div>
      )}
    </article>
  );
}
