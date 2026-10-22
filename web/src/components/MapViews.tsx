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

export function TripMapTab({ active }: { active: boolean }) {
  const { doc, gotoDay } = useTrip();
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const layer = useRef<Leaflet.LayerGroup | null>(null);
  const [seg, setSeg] = useState<string>("all");
  const [failed, setFailed] = useState(false);
  const reduce = useReducedMotion();
  const segKeys = Object.keys(doc.segments).filter((k) => doc.days.some((d) => d.seg === k));

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
            const a = (e.popup.getElement() as HTMLElement | undefined)?.querySelector<HTMLAnchorElement>("[data-goto]");
            a?.addEventListener("click", (ev) => {
              ev.preventDefault();
              map.current?.closePopup();
              gotoDay(Number(a.dataset.goto));
            });
          });
        }
        layer.current?.remove();
        layer.current = L.layerGroup().addTo(map.current);
        const all: [number, number][] = [];
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
        map.current.invalidateSize();
        if (all.length) map.current.flyToBounds(L.latLngBounds(all).pad(0.1), { animate: !reduce, duration: 1.4 });
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [active, doc, seg, reduce, gotoDay]);

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
            <button key={k} type="button" className={`btn small ${seg === k ? "" : "ghost"}`} onClick={() => setSeg(k)}>
              {k === "all" ? "全部" : doc.segments[k].name}
            </button>
          ))}
        </div>
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
      <p className="map-note">點地圖上的地點可跳到當天行程。路線為直線示意。</p>
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
