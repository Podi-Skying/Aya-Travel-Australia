"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import { PRI, useReducedMotion } from "./ui";
import type { EffectiveDay } from "@/domain/effective-day";

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

export function esc(s: string) {
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
