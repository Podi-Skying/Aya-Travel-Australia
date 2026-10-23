"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type * as Leaflet from "leaflet";
import { useTrip } from "./TripApp";
import { Icon, iconSvg } from "./Icon";
import { useReducedMotion } from "./ui";
import { esc, loadLeaflet, segColor, tiles } from "./MapViews";
import { PhotoCredit } from "./Photos";
import { project, rubber, spring } from "./motion";
import { Pool } from "./Pool";
import { effectiveDay } from "@/domain/effective-day";
import { fmtDay } from "@/domain/format";
import type { Category, Item, Package, TripDoc } from "@/domain/schema";

/*
 * Map and unscheduled places in one view (DESIGN.md「地圖與待安排景點」), Apple Maps style:
 * the map fills the screen; a side panel (desktop) or a bottom sheet with detents (phone) holds a
 * searchable, categorised list that stays in sync with the markers.
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
const CAT_KEYS = Object.keys(CATEGORY_META) as Category[];
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

/* ---- URL state: ?tab=map&mapLayers=days,pool&mapSeg=tas&mapCat=food&place=g12 ---- */
type Filters = { days: boolean; pool: boolean; seg: string; cat: string; place: string | null };
function readUrl(): Filters {
  const q = typeof location === "undefined" ? new URLSearchParams() : new URLSearchParams(location.search);
  const ls = (q.get("mapLayers") ?? "days,pool").split(",");
  return { days: ls.includes("days"), pool: ls.includes("pool"), seg: q.get("mapSeg") ?? "all", cat: q.get("mapCat") ?? "all", place: q.get("place") };
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
  q.delete("mapGroup");
  history.replaceState(history.state, "", `${location.pathname}?${q.toString()}${location.hash}`);
}

const CLUSTER_PX = 44;
const CLUSTER_UNTIL_ZOOM = 11;

function useNarrow() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = matchMedia("(max-width: 720px)");
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}

export function PlacesMap({ active }: { active: boolean }) {
  const { doc, gotoDay, mode, online, runOp } = useTrip();
  const reduce = useReducedMotion();
  const narrow = useNarrow();
  const [f, setF] = useState<Filters>(readUrl);
  const [q, setQ] = useState("");
  const [inView, setInView] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [bounds, setBounds] = useState<Leaflet.LatLngBounds | null>(null);
  const [failed, setFailed] = useState(false);
  const editable = mode === "owner" && online;
  const patch = (x: Partial<Filters>) => setF((o) => ({ ...o, ...x }));

  useEffect(() => writeUrl(f), [f]);

  const segKeys = Object.keys(doc.segments).filter((k) => doc.days.some((d) => d.seg === k));
  const places: Place[] = useMemo(() => doc.attractionPool.flatMap((p) => p.items.map((i) => ({ i, p }))), [doc.attractionPool]);
  const inSeg = (pl: Place) => f.seg === "all" || pl.p.seg === f.seg;
  const matchQ = (pl: Place) => {
    const s = q.trim().toLowerCase();
    return !s || [pl.i.name, pl.i.en, pl.i.note, pl.p.title].some((x) => x?.toLowerCase().includes(s));
  };
  const catOf = (pl: Place) => pl.i.cat ?? OTHER;
  const base = places.filter((pl) => inSeg(pl) && matchQ(pl));
  const shown = f.pool ? base.filter((pl) => f.cat === "all" || catOf(pl) === f.cat) : [];
  const listed = inView && bounds ? shown.filter((pl) => pl.i.lat != null && bounds.contains([pl.i.lat, pl.i.lng!])) : shown;
  const counts = new Map<string, number>();
  base.forEach((pl) => counts.set(catOf(pl), (counts.get(catOf(pl)) ?? 0) + 1));
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

  useEffect(() => {
    if (!active || !box.current) return;
    let cancelled = false;
    loadLeaflet()
      .then((L) => {
        if (cancelled || !box.current) return;
        if (!map.current) {
          map.current = L.map(box.current, { zoomAnimation: !reduce, zoomControl: !narrow }).setView([-38, 147], 5);
          tiles(L).addTo(map.current);
          map.current.on("moveend", () => setBounds(map.current!.getBounds()));
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
        if (f.days)
          doc.days.forEach((raw, idx) => {
            if (f.seg !== "all" && raw.seg !== f.seg) return;
            const d = effectiveDay(raw);
            const here = (i: { lat?: number }) => i.lat != null && i.lat > -40 === (d.seg === "syd");
            const pts = d.items.filter(here).map((i) => [i.lat!, i.lng!] as [number, number]);
            if (pts.length > 1) L.polyline(pts, { color: segColor(d.seg), weight: 3, opacity: 0.7 }).addTo(dayLayer.current!);
            d.items.forEach((i) => {
              if (!here(i)) return;
              all.push([i.lat!, i.lng!]);
              L.circleMarker([i.lat!, i.lng!], { radius: i.pri === "must" ? 7 : 5, color: "#fff", weight: 2, fillColor: segColor(d.seg), fillOpacity: 1 })
                .addTo(dayLayer.current!)
                .bindPopup(
                  `<div class="stop-pop">${i.photo ? `<img src="${esc(i.photo.url)}" alt="" referrerpolicy="no-referrer" loading="lazy">` : ""}<div><div class="d">${fmtDay(d.date)}・${esc(d.title)}</div><strong>${esc(i.name)}</strong><a href="#" data-goto="${idx}">查看當天行程 →</a>${i.photo ? `<div class="src">圖片來源：${esc(i.photo.site)}</div>` : ""}</div></div>`,
                  { maxWidth: 300, minWidth: 240 },
                );
            });
          });
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
        if (sel?.lat != null && sel.lng != null) m.flyTo([sel.lat, sel.lng], Math.max(m.getZoom(), 12), { animate: !reduce, duration: 0.8 });
        else if (all.length) m.fitBounds(L.latLngBounds(all).pad(0.1), { animate: false });
        draw();
        setBounds(m.getBounds());
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
    };
    // pinsKey captures the filtered places; selected is part of it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, doc.days, f.days, f.seg, pinsKey, reduce, narrow]);

  useEffect(
    () => () => {
      map.current?.remove();
      map.current = null;
    },
    [],
  );

  /* ---------------------------------------------------------------- phone sheet */
  const sheet = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const y = useRef(0); // translateY of the sheet; 0 = full height
  const anim = useRef<(() => void) | null>(null);
  const drag = useRef<{ id: number; y0: number; started: boolean; hist: { t: number; y: number }[] } | null>(null);
  const [detent, setDetent] = useState<"peek" | "half" | "full">("peek");
  const detents = useCallback(() => {
    const H = wrap.current?.clientHeight ?? 600;
    const full = H * 0.06;
    return { peek: H - 132, half: H * 0.48, full, H };
  }, []);
  const place = useCallback(() => {
    if (sheet.current) sheet.current.style.transform = narrow ? `translate3d(0, ${y.current}px, 0)` : "";
  }, [narrow]);
  const goDetent = useCallback(
    (to: "peek" | "half" | "full", v0 = 0) => {
      const target = detents()[to];
      setDetent(to);
      anim.current?.();
      if (reduce) {
        y.current = target;
        place();
        return;
      }
      anim.current = spring(y.current, v0, target, 0.35, (v) => {
        y.current = v;
        place();
      });
    },
    [detents, place, reduce],
  );
  useEffect(() => {
    if (!narrow) return place();
    y.current = detents()[detent];
    place();
    const ro = new ResizeObserver(() => {
      y.current = detents()[detent];
      place();
    });
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
    // Re-measure only when the layout mode changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [narrow, active]);
  // Picking a place (marker or list) opens the sheet to half so the card is visible.
  const selectPlace = useCallback(
    (id: string) => {
      setF((o) => ({ ...o, place: id }));
      if (narrow && detent === "peek") goDetent("half");
    },
    [narrow, detent, goDetent],
  );
  useEffect(() => {
    handlers.current.select = selectPlace;
  });
  const onRow = (e: { currentTarget: HTMLElement }) => selectPlace(e.currentTarget.dataset.id!);

  function down(e: ReactPointerEvent) {
    if (!narrow || e.button !== 0) return;
    anim.current?.();
    drag.current = { id: e.pointerId, y0: e.clientY - y.current, started: false, hist: [{ t: e.timeStamp, y: e.clientY }] };
  }
  function move(e: ReactPointerEvent) {
    const g = drag.current;
    if (!g || g.id !== e.pointerId) return;
    const raw = e.clientY - g.y0;
    if (!g.started) {
      if (Math.abs(raw - y.current) < 6) return;
      g.started = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    g.hist.push({ t: e.timeStamp, y: e.clientY });
    if (g.hist.length > 6) g.hist.shift();
    const { peek, full } = detents();
    y.current = raw < full ? full - rubber(full - raw, 400) : raw > peek ? peek + rubber(raw - peek, 400) : raw;
    place();
  }
  function up(e: ReactPointerEvent) {
    const g = drag.current;
    drag.current = null;
    if (!g || g.id !== e.pointerId) return;
    if (!g.started) return;
    const a = g.hist[0];
    const b = g.hist[g.hist.length - 1];
    const v = (b.y - a.y) / (Math.max(1, b.t - a.t) / 1000);
    const projected = y.current + project(v);
    const d = detents();
    const near = (["full", "half", "peek"] as const).reduce((best, k) => (Math.abs(d[k] - projected) < Math.abs(d[best] - projected) ? k : best), "peek" as "peek" | "half" | "full");
    goDetent(near, v);
  }

  /* ---------------------------------------------------------------- render */
  const groups = CAT_KEYS.filter((c) => listed.some((pl) => catOf(pl) === c)).map((c) => ({ c, xs: listed.filter((pl) => catOf(pl) === c) }));
  const others = listed.filter((pl) => catOf(pl) === OTHER);
  const noCoords = shown.filter((pl) => pl.i.lat == null);
  const sug = selected ? suggestDay(doc, selected) : null;

  return (
    <div className={`places${narrow ? " narrow" : ""}`} ref={wrap}>
      <div className="places-map map" ref={box} role="region" aria-label="地圖：已排行程與待安排景點">
        {failed && <div className="map-fallback">地圖無法載入（可能離線）。右側清單仍可使用。</div>}
      </div>
      <aside className={`places-panel detent-${detent}`} ref={sheet} aria-label="待安排景點">
        <div className="sheet-head" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          {narrow && (
            <button
              type="button"
              className="grabber"
              aria-label={detent === "full" ? "收起清單" : "展開清單"}
              onClick={() => goDetent(detent === "full" ? "peek" : detent === "peek" ? "half" : "full")}
            >
              <span aria-hidden="true" />
            </button>
          )}
          <label className="search">
            <Icon name="search" size={18} />
            <span className="sr-only">搜尋景點</span>
            <input
              type="search"
              value={q}
              placeholder={`搜尋 ${places.length} 個待安排景點`}
              onChange={(e) => setQ(e.target.value)}
              onFocus={() => narrow && detent === "peek" && goDetent("half")}
            />
          </label>
        </div>
        <div className="sheet-body">
          {selected && (
            <PlaceCard
              key={selected.i.id}
              place={selected}
              suggestion={sug}
              editable={editable}
              onClose={() => {
                const id = f.place;
                patch({ place: null });
                requestAnimationFrame(() => wrap.current?.querySelector<HTMLElement>(`.place-row[data-id="${id}"]`)?.focus());
              }}
              onSchedule={async (date) => {
                await runOp({ op: "scheduleItem", key: selected.p.key, itemId: selected.i.id, date });
                patch({ place: null });
              }}
            />
          )}
          <div className="chips" role="group" aria-label="地區">
            {["all", ...segKeys].map((k) => (
              <button key={k} type="button" className={`chip ${f.seg === k ? "on" : ""}`} aria-pressed={f.seg === k} onClick={() => patch({ seg: k })}>
                {k === "all" ? "全部地區" : doc.segments[k].name}
              </button>
            ))}
            <button type="button" className={`chip ${f.days ? "on" : ""}`} aria-pressed={f.days} onClick={() => patch({ days: !f.days })}>
              <i className="lg-days" aria-hidden="true" /> 已排行程
            </button>
            <button type="button" className={`chip ${f.pool ? "on" : ""}`} aria-pressed={f.pool} onClick={() => patch({ pool: !f.pool })}>
              <i className="lg-pool" aria-hidden="true" /> 待安排
            </button>
          </div>
          <button type="button" className={`chip filter-toggle${f.cat !== "all" || inView ? " on" : ""}`} aria-expanded={showFilters} onClick={() => setShowFilters(!showFilters)}>
            篩選{f.cat !== "all" ? `：${CATEGORY_META[f.cat as Category]?.t ?? "未分類"}` : ""}
            {inView ? "・畫面內" : ""}
          </button>
          {showFilters && (
            <>
              <div className="chips cats" role="group" aria-label="分類">
                <button type="button" className={`chip ${f.cat === "all" ? "on" : ""}`} aria-pressed={f.cat === "all"} onClick={() => patch({ cat: "all" })}>
                  全部 {base.length}
                </button>
                {CAT_KEYS.filter((c) => counts.get(c)).map((c) => (
                  <button key={c} type="button" className={`chip ${f.cat === c ? "on" : ""}`} aria-pressed={f.cat === c} onClick={() => patch({ cat: f.cat === c ? "all" : c })}>
                    <Icon name={CATEGORY_META[c].icon} size={16} /> {CATEGORY_META[c].t} {counts.get(c)}
                  </button>
                ))}
              </div>
              <label className="in-view">
                <input type="checkbox" checked={inView} onChange={(e) => setInView(e.target.checked)} /> 只列出地圖畫面內的景點
              </label>
            </>
          )}


          {selected ? (
            <button
              type="button"
              className="back-to-list"
              onClick={() => {
                const id = f.place;
                patch({ place: null });
                requestAnimationFrame(() => wrap.current?.querySelector<HTMLElement>(`.place-row[data-id="${id}"]`)?.focus());
              }}
            >
              ← 返回清單（{listed.length}）
            </button>
          ) : !f.pool ? (
            <p className="muted small">已關閉「待安排」圖層。</p>
          ) : !listed.length ? (
            <p className="muted small">{inView ? "地圖畫面內沒有符合的景點，移動或縮小地圖看看。" : "沒有符合的景點。"}</p>
          ) : (
            [...groups, ...(others.length ? [{ c: OTHER as Category | typeof OTHER, xs: others }] : [])].map(({ c, xs }) => (
              <section key={c} className="place-group">
                <h3>
                  {c !== OTHER && <Icon name={CATEGORY_META[c as Category].icon} size={16} />} {c === OTHER ? "未分類" : CATEGORY_META[c as Category].t}
                  <span className="muted"> {xs.length}</span>
                </h3>
                <ul>
                  {xs.map((pl) => (
                    <li key={pl.i.id}>
                      <button type="button" className={`place-row${pl.i.id === f.place ? " sel" : ""}`} aria-pressed={pl.i.id === f.place} data-id={pl.i.id} onClick={onRow}>
                        <span className="nm">{pl.i.name}</span>
                        <span className="sub">
                          {pl.p.title.replace(/（Google 地圖收藏）/, "")}
                          {pl.i.lat == null ? "・沒有座標" : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
          {noCoords.length > 0 && <p className="muted small">沒有座標、地圖上沒畫出來：{noCoords.map((pl) => pl.i.name).join("、")}</p>}
          <p className="muted small">實心點是已排行程（點一下可跳到當天），空心紅圈是待安排景點；數字圓圈是聚在一起的景點，點一下會放大。</p>
          <details className="map-alt">
            <summary>依分組檢視（可整組排入）</summary>
            <Pool />
          </details>
        </div>
      </aside>
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
  onSchedule: (date: string) => Promise<void>;
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
      {i.photo && (
        <figure>
          {/* eslint-disable-next-line @next/next/no-img-element -- hotlinked photo, see Photos.tsx */}
          <img src={i.photo.url} alt={i.name} referrerPolicy="no-referrer" loading="lazy" />
          <figcaption>
            <PhotoCredit photo={i.photo} />
          </figcaption>
        </figure>
      )}
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
                  {fmtDay(d.date)} {d.title}
                  {d.date === suggestion?.date ? "（建議）" : ""}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn small" disabled={!date} onClick={() => void onSchedule(date)}>
            排入
          </button>
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
