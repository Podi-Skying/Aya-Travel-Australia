"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import { PRI, useReducedMotion } from "./ui";
import type { EffectiveDay } from "@/domain/effective-day";
import { iconSvg } from "./Icon";
import { ROUTE_CREDIT, stopsOf, useLegs } from "./useLegs";

/*
 * Leaflet is loaded only in the browser. If it or the tiles fail, the itinerary
 * and the text route list remain usable (NFR-01, NFR-06).
 */

export type L = typeof Leaflet;
let leafletPromise: Promise<L> | null = null;
export function loadLeaflet(): Promise<L> {
  leafletPromise ??= import("leaflet").then((m) => (m.default ?? m) as L);
  return leafletPromise;
}

export function tiles(L: L) {
  // OpenStreetMap standard tiles. Their usage policy requires a Referer header, which the
  // site's Referrer-Policy (strict-origin-when-cross-origin) now sends as the origin only.
  return L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    referrerPolicy: "strict-origin-when-cross-origin",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  });
}

export function segColor(seg: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(seg === "syd" ? "--syd" : "--tas").trim() || "#1f7a6d";
}

/** Design tokens for map lines (paper/ink/one vermilion, chictrip review: only the selected day is red). */
export function cssVar(name: string, fallback: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const BASE: Record<string, [number, number]> = { syd: [-33.87, 151.21], tas: [-42.88, 147.33] };

/** An unscheduled place drawn on the day map as a hollow ring; owners can add it to the day from its popup. */
export type MapExtra = { id: string; key: string; lat: number; lng: number; name: string; sub: string; photo?: string; icon?: string };

export function DayMap({
  day,
  active,
  focusId,
  nearby = [],
  onAdd,
}: {
  day: EffectiveDay;
  active: boolean;
  focusId: string | null;
  nearby?: MapExtra[];
  onAdd?: (key: string, id: string) => unknown;
}) {
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
  const nearbyRef = useRef(nearby);
  const addRef = useRef(onAdd);
  useEffect(() => {
    nearbyRef.current = nearby;
    addRef.current = onAdd;
  });
  // Road legs from the route cache (drive legs only); straight segments otherwise.
  const legs = useLegs(stopsOf(day.items));
  const legsRef = useRef(legs);
  useEffect(() => {
    legsRef.current = legs;
  });
  const legsKey = legs ? legs.map((l) => (l ? l.durationS : "-")).join(",") : "";
  const sig = `${legsKey}|${day.date}|${day.seg}|${day.items.map((i) => `${i.id}:${i.lat}:${i.lng}:${i.time}:${i.name}:${i.pri}`).join(",")}|${nearby.map((n) => [n.id, n.key, n.lat, n.lng, n.name, n.sub, n.photo ?? "", n.icon ?? ""].join("~")).join(",")}|${onAdd ? 1 : 0}`;

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
          map.current.on("popupopen", (e) => {
            (e.popup.getElement() as HTMLElement | undefined)?.querySelector<HTMLButtonElement>("[data-add-id]")?.addEventListener("click", (ev) => {
              const b = ev.currentTarget as HTMLButtonElement;
              // Popups are plain HTML: show the pending state by hand, then close once the save finishes.
              b.disabled = true;
              b.setAttribute("aria-busy", "true");
              b.innerHTML = '<span class="pbtn-spin"></span> 加入中…';
              void Promise.resolve(addRef.current?.(b.dataset.addKey!, b.dataset.addId!)).finally(() => map.current?.closePopup());
            });
          });
        }
        layer.current?.remove();
        layer.current = L.layerGroup().addTo(map.current);
        markers.current.clear();
        const pts: [number, number][] = [];
        day.items.forEach((i, k) => {
          if (i.lat == null || i.lng == null) return;
          pts.push([i.lat, i.lng]);
          const m = L.marker([i.lat, i.lng], {
            // 44px hit area around the 28px numbered pin.
            icon: L.divIcon({ className: "num-hit", html: `<span class="num-marker sel-day ${day.seg}">${k + 1}</span>`, iconSize: [44, 44] }),
            keyboard: true,
            title: i.name,
          })
            .addTo(layer.current!)
            .bindPopup(`<strong>${esc(i.time)} ${esc(i.name)}</strong><br>${esc(i.en ?? "")}<br>${PRI[i.pri].t}`);
          markers.current.set(i.id, m);
        });
        const path: [number, number][] = [];
        pts.forEach((p, k) => {
          const leg = k ? legsRef.current?.[k - 1] : null;
          if (leg?.geometry.length) path.push(...leg.geometry);
          else path.push(p);
        });
        if (path.length > 1) L.polyline(path, { color: cssVar("--vermilion", "#b83a2e"), weight: 4, opacity: 0.9, className: legsRef.current?.some(Boolean) ? "" : "route-anim" }).addTo(layer.current).bringToBack();
        nearbyRef.current.forEach((n) => {
          const add = addRef.current ? `<button type="button" class="btn small" data-add-key="${esc(n.key)}" data-add-id="${esc(n.id)}">加入這天</button>` : "";
          // 44px hit area around a 26px ring.
          L.marker([n.lat, n.lng], {
            icon: L.divIcon({ className: "place-pin-hit", html: `<span class="place-pin">${n.icon ? iconSvg(n.icon) : ""}</span>`, iconSize: [44, 44] }),
            keyboard: true,
            title: `待安排：${n.name}`,
          })
            .addTo(layer.current!)
            .bindPopup(
              `<div class="stop-pop">${n.photo ? `<img src="${esc(n.photo)}" alt="" referrerpolicy="no-referrer" loading="lazy">` : ""}<div><div class="d">待安排景點</div><strong>${esc(n.name)}</strong><div class="d">${esc(n.sub)}</div>${add}</div></div>`,
              { maxWidth: 300, minWidth: 240 },
            );
        });
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
    <>
      <div className="map day-map" role="region" aria-label="當日路線地圖" ref={box}>
        {failed && (
          <div className="map-fallback">
            地圖無法載入（可能離線）。
            <br />
            行程內容不受影響。
          </div>
        )}
      </div>
      {legs?.some((l) => l && l.source !== "same-place") && <p className="route-credit">{ROUTE_CREDIT}</p>}
    </>
  );
}
