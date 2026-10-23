"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import { useTrip } from "./TripApp";
import { PRI, useReducedMotion } from "./ui";
import { effectiveDay, type EffectiveDay } from "@/domain/effective-day";
import { fmtDay } from "@/domain/format";

/*
 * Leaflet is loaded only in the browser. If it or the tiles fail, the itinerary
 * and the text route list remain usable (NFR-01, NFR-06).
 */

type L = typeof Leaflet;
let leafletPromise: Promise<L> | null = null;
function loadLeaflet(): Promise<L> {
  leafletPromise ??= import("leaflet").then((m) => (m.default ?? m) as L);
  return leafletPromise;
}

function tiles(L: L) {
  // OpenStreetMap standard tiles. Their usage policy requires a Referer header, which the
  // site's Referrer-Policy (strict-origin-when-cross-origin) now sends as the origin only.
  return L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    referrerPolicy: "strict-origin-when-cross-origin",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  });
}

function segColor(seg: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(seg === "syd" ? "--syd" : "--tas").trim() || "#1f7a6d";
}

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const BASE: Record<string, [number, number]> = { syd: [-33.87, 151.21], tas: [-42.88, 147.33] };

export function DayMap({ day, active, focusId }: { day: EffectiveDay; active: boolean; focusId: string | null }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const layer = useRef<Leaflet.LayerGroup | null>(null);
  const markers = useRef(new Map<string, Leaflet.Marker>());
  const [failed, setFailed] = useState(false);
  const reduce = useReducedMotion();
  const dayRef = useRef(day);
  useEffect(() => {
    dayRef.current = day;
  });
  const sig = `${day.date}|${day.seg}|${day.items.map((i) => `${i.id}:${i.lat}:${i.lng}:${i.time}:${i.name}:${i.pri}`).join(",")}`;

  useEffect(() => {
    if (!active || !box.current) return;
    let cancelled = false;
    const day = dayRef.current;
    loadLeaflet()
      .then((L) => {
        if (cancelled || !box.current) return;
        if (!map.current) {
          map.current = L.map(box.current, { scrollWheelZoom: false, zoomAnimation: !reduce }).setView(BASE.tas, 9);
          tiles(L).addTo(map.current);
        }
        layer.current?.remove();
        layer.current = L.layerGroup().addTo(map.current);
        markers.current.clear();
        const pts: [number, number][] = [];
        day.items.forEach((i, k) => {
          if (i.lat == null || i.lng == null) return;
          pts.push([i.lat, i.lng]);
          const m = L.marker([i.lat, i.lng], {
            icon: L.divIcon({ className: `num-marker ${day.seg}`, html: String(k + 1), iconSize: [26, 26] }),
            keyboard: true,
            title: i.name,
          })
            .addTo(layer.current!)
            .bindPopup(`<strong>${esc(i.time)} ${esc(i.name)}</strong><br>${esc(i.en ?? "")}<br>${PRI[i.pri].t}`);
          markers.current.set(i.id, m);
        });
        if (pts.length > 1) L.polyline(pts, { color: segColor(day.seg), weight: 4, opacity: 0.85, className: "route-anim" }).addTo(layer.current).bringToBack();
        map.current.invalidateSize();
        if (pts.length) map.current.flyToBounds(L.latLngBounds(pts).pad(0.25), { maxZoom: 13, animate: !reduce, duration: 1.2 });
        else map.current.setView(BASE[day.seg] ?? BASE.tas, 11);
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [sig, active, reduce]);

  useEffect(() => {
    if (!focusId || !map.current) return;
    const m = markers.current.get(focusId);
    if (m) {
      map.current.flyTo(m.getLatLng(), 14, { animate: !reduce });
      m.openPopup();
    }
  }, [focusId, reduce]);

  useEffect(
    () => () => {
      map.current?.remove();
      map.current = null;
    },
    [],
  );

  return (
    <div className="map day-map" role="region" aria-label="當日路線地圖" ref={box}>
      {failed && (
        <div className="map-fallback">
          地圖無法載入（可能離線）。
          <br />
          行程內容不受影響。
        </div>
      )}
    </div>
  );
}

type Layers = { days: boolean; pool: boolean };

/** Map filters live in the URL (?mapLayers=days,pool&mapSeg=tas&mapGroup=key) so a reload or a shared link keeps them. */
function readMapUrl() {
  const q = typeof location === "undefined" ? new URLSearchParams() : new URLSearchParams(location.search);
  const ls = (q.get("mapLayers") ?? "days,pool").split(",");
  return { layers: { days: ls.includes("days"), pool: ls.includes("pool") }, seg: q.get("mapSeg") ?? "all", group: q.get("mapGroup") ?? "all" };
}
function writeMapUrl(layers: Layers, seg: string, group: string) {
  const q = new URLSearchParams(location.search);
  const ls = [layers.days && "days", layers.pool && "pool"].filter(Boolean).join(",");
  if (ls === "days,pool") q.delete("mapLayers");
  else q.set("mapLayers", ls || "none");
  if (seg === "all") q.delete("mapSeg");
  else q.set("mapSeg", seg);
  if (group === "all") q.delete("mapGroup");
  else q.set("mapGroup", group);
  history.replaceState(history.state, "", `${location.pathname}?${q.toString()}${location.hash}`);
}

export const mapsUrl = (name: string, lat?: number, lng?: number) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lat != null && lng != null ? `${name} ${lat},${lng}` : name)}`;

const CLUSTER_PX = 44;
const CLUSTER_UNTIL_ZOOM = 11;

export function TripMapTab({ active }: { active: boolean }) {
  const { doc, gotoDay, mode, online, runOp } = useTrip();
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const layer = useRef<Leaflet.LayerGroup | null>(null);
  const poolLayer = useRef<Leaflet.LayerGroup | null>(null);
  const onZoom = useRef<(() => void) | null>(null);
  const [init] = useState(readMapUrl);
  const [seg, setSeg] = useState<string>(init.seg);
  const [layers, setLayers] = useState<Layers>(init.layers);
  const [group, setGroup] = useState<string>(init.group);
  const [failed, setFailed] = useState(false);
  const reduce = useReducedMotion();
  const segKeys = Object.keys(doc.segments).filter((k) => doc.days.some((d) => d.seg === k));
  const editable = mode === "owner" && online;
  // Popup buttons are plain HTML; they call the latest handlers through refs.
  const handlers = useRef({ gotoDay, runOp, editable });
  useEffect(() => {
    handlers.current = { gotoDay, runOp, editable };
  });

  const pkgs = doc.attractionPool.filter((p) => p.items.length && (seg === "all" || p.seg === seg));
  const shownPkgs = pkgs.filter((p) => group === "all" || p.key === group);
  const poolItems = layers.pool ? shownPkgs.flatMap((p) => p.items.map((i) => ({ i, p }))) : [];
  const noCoords = poolItems.filter(({ i }) => i.lat == null || i.lng == null);

  useEffect(() => writeMapUrl(layers, seg, group), [layers, seg, group]);

  useEffect(() => {
    if (!active || !box.current) return;
    let cancelled = false;
    loadLeaflet()
      .then((L) => {
        if (cancelled || !box.current) return;
        if (!map.current) {
          map.current = L.map(box.current, { zoomAnimation: !reduce }).setView([-38, 147], 5);
          tiles(L).addTo(map.current);
          map.current.on("popupopen", (e) => {
            const el = e.popup.getElement() as HTMLElement | undefined;
            el?.querySelector<HTMLAnchorElement>("[data-goto]")?.addEventListener("click", (ev) => {
              ev.preventDefault();
              map.current?.closePopup();
              handlers.current.gotoDay(Number((ev.currentTarget as HTMLElement).dataset.goto));
            });
            el?.querySelector<HTMLButtonElement>("[data-sched]")?.addEventListener("click", (ev) => {
              const [key, itemId] = (ev.currentTarget as HTMLElement).dataset.sched!.split("|");
              const date = el.querySelector<HTMLSelectElement>("[data-sched-date]")?.value;
              if (!date || !handlers.current.editable) return;
              map.current?.closePopup();
              void handlers.current.runOp({ op: "scheduleItem", key, itemId, date });
            });
          });
        }
        const m = map.current;
        layer.current?.remove();
        layer.current = L.layerGroup().addTo(m);
        poolLayer.current?.remove();
        poolLayer.current = L.layerGroup().addTo(m);
        const all: [number, number][] = [];
        if (layers.days)
          doc.days.forEach((raw, idx) => {
            if (seg !== "all" && raw.seg !== seg) return;
            const d = effectiveDay(raw);
            // Only points in the day's destination (the far end of a flight is not joined).
            const inSeg = (i: { lat?: number }) => i.lat != null && i.lat > -40 === (d.seg === "syd");
            const pts = d.items.filter(inSeg).map((i) => [i.lat!, i.lng!] as [number, number]);
            if (pts.length > 1) L.polyline(pts, { color: segColor(d.seg), weight: 3, opacity: 0.7, className: "route-anim" }).addTo(layer.current!);
            d.items.forEach((i) => {
              if (!inSeg(i)) return;
              all.push([i.lat!, i.lng!]);
              L.circleMarker([i.lat!, i.lng!], { radius: i.pri === "must" ? 7 : 5, color: "#fff", weight: 2, fillColor: segColor(d.seg), fillOpacity: 1 })
                .addTo(layer.current!)
                .bindPopup(`<strong>${fmtDay(d.date)}</strong> ${esc(d.title)}<br>${esc(i.name)}<br><a href="#" data-goto="${idx}">查看當天 →</a>`);
            });
          });

        // Unscheduled places: hollow vermilion rings, grouped into counted clusters while zoomed out.
        const pins = poolItems.filter(({ i }) => i.lat != null && i.lng != null);
        pins.forEach(({ i }) => all.push([i.lat!, i.lng!]));
        const vermilion = getComputedStyle(document.documentElement).getPropertyValue("--vermilion").trim() || "#b83a2e";
        const popup = ({ i, p }: (typeof pins)[number]) => {
          const days = doc.days.filter((d) => d.seg === p.seg);
          const sched = handlers.current.editable
            ? `<div class="pop-sched"><label>排進<select data-sched-date>${days.map((d) => `<option value="${d.date}">${esc(fmtDay(d.date))} ${esc(d.title)}</option>`).join("")}</select></label><button type="button" class="btn small" data-sched="${esc(p.key)}|${esc(i.id)}">排入</button></div>`
            : "";
          const photo = i.photo ? `<img class="pop-photo" src="${esc(i.photo.url)}" alt="" referrerpolicy="no-referrer" loading="lazy">` : "";
          return `<div class="pool-pop">${photo}<strong>${esc(i.name)}</strong>${i.en ? `<div class="en">${esc(i.en)}</div>` : ""}<div class="grp">待安排・${esc(p.title)}</div>${i.note ? `<p>${esc(i.note)}</p>` : ""}<a href="${mapsUrl(i.en || i.name, i.lat, i.lng)}" target="_blank" rel="noopener noreferrer">在 Google 地圖開啟</a>${sched}</div>`;
        };
        const drawPool = () => {
          const pl = poolLayer.current;
          if (!pl) return;
          pl.clearLayers();
          const z = m.getZoom();
          const cells = new Map<string, (typeof pins)[number][]>();
          pins.forEach((x) => {
            const pt = m.project([x.i.lat!, x.i.lng!], z);
            const key = z >= CLUSTER_UNTIL_ZOOM ? x.i.id : `${Math.floor(pt.x / CLUSTER_PX)}:${Math.floor(pt.y / CLUSTER_PX)}`;
            cells.set(key, [...(cells.get(key) ?? []), x]);
          });
          cells.forEach((xs) => {
            if (xs.length === 1) {
              const x = xs[0];
              L.circleMarker([x.i.lat!, x.i.lng!], { radius: 6, color: vermilion, weight: 2, fillColor: "#faf7f0", fillOpacity: 1 }).addTo(pl).bindPopup(popup(x), { maxWidth: 280 });
              return;
            }
            const b = L.latLngBounds(xs.map((x) => [x.i.lat!, x.i.lng!] as [number, number]));
            L.marker(b.getCenter(), {
              icon: L.divIcon({ className: "pool-cluster", html: String(xs.length), iconSize: [32, 32] }),
              keyboard: true,
              title: `${xs.length} 個待安排景點，點一下放大`,
            })
              .addTo(pl)
              .on("click", () => m.flyToBounds(b.pad(0.3), { animate: !reduce, maxZoom: CLUSTER_UNTIL_ZOOM + 1 }));
          });
        };
        if (onZoom.current) m.off("zoomend", onZoom.current);
        onZoom.current = drawPool;
        m.on("zoomend", drawPool);
        m.invalidateSize();
        if (all.length) m.fitBounds(L.latLngBounds(all).pad(0.1), { animate: false });
        drawPool();
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
    };
    // poolItems is derived from doc, seg, group and layers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, doc, seg, group, layers, reduce]);

  useEffect(
    () => () => {
      map.current?.remove();
      map.current = null;
    },
    [],
  );

  return (
    <>
      <div className="map-head">
        <h2>全程地圖</h2>
        <div className="map-legend">
          {["all", ...segKeys].map((k) => (
            <button key={k} type="button" className={`btn small ${seg === k ? "" : "ghost"}`} aria-pressed={seg === k} onClick={() => (setSeg(k), setGroup("all"))}>
              {k === "all" ? "全部" : doc.segments[k].name}
            </button>
          ))}
        </div>
      </div>
      <div className="map-filters">
        <button type="button" className={`chip ${layers.days ? "on" : ""}`} aria-pressed={layers.days} onClick={() => setLayers((l) => ({ ...l, days: !l.days }))}>
          <i className="lg-days" aria-hidden="true" /> 已排行程
        </button>
        <button type="button" className={`chip ${layers.pool ? "on" : ""}`} aria-pressed={layers.pool} onClick={() => setLayers((l) => ({ ...l, pool: !l.pool }))}>
          <i className="lg-pool" aria-hidden="true" /> 待安排景點
        </button>
        {layers.pool && (
          <label className="map-group">
            <span className="sr-only">待安排景點分組</span>
            <select value={group} onChange={(e) => setGroup(e.target.value)}>
              <option value="all">全部分組（{pkgs.reduce((a, p) => a + p.items.length, 0)}）</option>
              {pkgs.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.title}（{p.items.length}）
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="map trip-map" role="region" aria-label="全程地圖" ref={box}>
        {failed && (
          <div className="map-fallback">
            地圖無法載入（可能離線）。
            <br />
            請展開下方「文字版路線」。
          </div>
        )}
      </div>
      <p className="map-note">實心點是已排進行程的地點（點一下可跳到當天），空心紅圈是待安排景點；數字圓圈是聚在一起的待安排景點，點一下會放大。路線為直線示意。</p>
      {layers.pool && poolItems.length > 0 && (
        <details className="map-alt">
          <summary>待安排景點清單（不需地圖，{poolItems.length} 個）</summary>
          <ul className="pool-list">
            {poolItems.map(({ i, p }) => (
              <li key={i.id}>
                <a href={mapsUrl(i.en || i.name, i.lat, i.lng)} target="_blank" rel="noopener noreferrer">
                  {i.name}
                </a>
                <span className="muted small">
                  {" "}
                  {p.title}
                  {i.lat == null || i.lng == null ? "・沒有座標，地圖上不顯示" : ""}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {noCoords.length > 0 && (
        <p className="map-note">
          沒有座標、地圖上沒畫出來：{noCoords.map(({ i }) => i.name).join("、")}
        </p>
      )}
      <details className="map-alt" open={failed}>
        <summary>文字版路線（不需地圖）</summary>
        <ol>
          {doc.days.map((d, i) => (
            <li key={d.date}>
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  gotoDay(i);
                }}
              >
                {fmtDay(d.date)} {d.title}
              </a>
              {d.items.length ? "：" + d.items.map((x) => x.name).join(" → ") : ""}
            </li>
          ))}
        </ol>
      </details>
    </>
  );
}
