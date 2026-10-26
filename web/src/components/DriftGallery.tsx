"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTrip } from "./TripApp";
import { useReducedMotion } from "./ui";
import { commonsFor } from "@/client/photos";
import { fmtDay } from "@/domain/format";
import { isLogistics } from "@/domain/day-title";
import type { Item, Photo } from "@/domain/schema";

/*
 * 畫廊 (Kai 2026-10-26): an endless field of the trip's place photos drifting past in 3D. Our own build in the
 * spirit of React Bits Pro "Infinite Gallery" (Pro is not available): CSS 3D transforms moved by one
 * requestAnimationFrame loop, a fixed pool of planes recycled as they pass the camera, fog by depth.
 * Wheel, drag, touch and arrow keys push the camera with inertia. Reduced motion gets a still grid.
 * Owner and share links only (public visitors have no photos).
 */

export type Shot = { key: string; src: string; name: string; date?: string; dayIndex?: number; credit: string };

const PLANES = 36;
const GAP = 260; // depth between planes (px)
const DEPTH = PLANES * GAP;
const FRICTION = 2.2; // velocity decay per second (exponential)

/** Commons thumbnails come in fixed widths; 500 px is plenty for a drifting card. */
const small = (p: Photo) => (p.kind === "commons" ? p.url.replace(/\/(\d+)px-([^/]+)$/, "/500px-$2") : p.url);
const credit = (p: Photo) => [p.site, p.credit, p.license].filter(Boolean).join("・");

/** Every photo of the trip's places, once each: own photo, gallery, then cached Commons photos. */
export function tripShots(days: { date: string; items: Item[] }[], pool: { items: Item[] }[], commons: Record<string, Photo[]>): Shot[] {
  const seen = new Set<string>();
  const out: Shot[] = [];
  const add = (i: Item, p: Photo, date?: string, dayIndex?: number) => {
    if (seen.has(p.url)) return;
    seen.add(p.url);
    out.push({ key: `${i.id}:${out.length}`, src: small(p), name: i.name, date, dayIndex, credit: credit(p) });
  };
  const each = (i: Item, date?: string, dayIndex?: number) => {
    if (isLogistics(i) || i.name.startsWith("住宿：")) return;
    for (const p of [i.photo, ...(i.gallery ?? []), ...(commons[i.id] ?? [])]) if (p) add(i, p, date, dayIndex);
  };
  days.forEach((d, k) => d.items.forEach((i) => each(i, d.date, k)));
  pool.forEach((p) => p.items.forEach((i) => each(i)));
  return out;
}

// Deterministic scatter for a plane in a given lap, so a plane keeps its place while visible.
const rand = (n: number) => {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

export function DriftGallery({ active }: { active: boolean }) {
  const { doc, token, mode, gotoDay } = useTrip();
  const reduce = useReducedMotion();
  const [commons, setCommons] = useState<Record<string, Photo[]>>({});
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<Shot | null>(null);

  // Cached Commons photos for places, a few requests at a time once the page is open (never Google: billed).
  const places = useMemo(
    () => [...doc.days.flatMap((d) => d.items), ...doc.attractionPool.flatMap((p) => p.items)].filter((i) => i.lat != null && !isLogistics(i)),
    [doc],
  );
  useEffect(() => {
    if (!active || (mode !== "owner" && !token)) return;
    let live = true;
    void (async () => {
      for (let k = 0; k < places.length && live; k += 6) {
        const part = places.slice(k, k + 6);
        const lists = await Promise.all(part.map((i) => commonsFor({ id: i.id, name: i.name, lat: i.lat, lng: i.lng }, token)));
        if (live) setCommons((c) => ({ ...c, ...Object.fromEntries(part.map((i, j) => [i.id, lists[j]])) }));
      }
      if (live) setLoading(false);
    })();
    return () => {
      live = false;
    };
  }, [active, places, mode, token]);

  const shots = useMemo(() => tripShots(doc.days, doc.attractionPool, commons), [doc, commons]);

  return (
    <div className="drift">
      <div className="card">
        <h2>畫廊</h2>
        <p className="muted small">
          {reduce ? "這趟旅程景點的照片。" : "滾動、拖曳或用方向鍵在照片之間漂流；點照片看是哪裡、哪一天。"}共 {shots.length} 張。
        </p>
      </div>
      {shots.length === 0 ? (
        <p className="section muted">{loading ? "照片載入中…" : "還沒有照片。景點加上照片之後會出現在這裡。"}</p>
      ) : reduce ? (
        <ul className="drift-grid">
          {shots.map((s) => (
            <li key={s.key}>
              <button type="button" onClick={() => setPicked(s)} aria-label={`${s.name}${s.date ? `，${fmtDay(s.date)}` : ""}`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- photos from several hosts */}
                <img src={s.src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <Field shots={shots} active={active} onPick={setPicked} />
      )}
      {picked && (
        <div className="drift-info card" role="status">
          <strong>{picked.name}</strong>
          <span className="small muted">{picked.date ? fmtDay(picked.date) : "還沒排進行程"}</span>
          <span className="small muted">{picked.credit}</span>
          <span className="drift-info-actions">
            {picked.dayIndex != null && (
              <button type="button" className="btn small" onClick={() => gotoDay(picked.dayIndex!)}>
                看那天的行程
              </button>
            )}
            <button type="button" className="btn ghost small" onClick={() => setPicked(null)}>
              關閉
            </button>
          </span>
        </div>
      )}
    </div>
  );
}

function Field({ shots, active, onPick }: { shots: Shot[]; active: boolean; onPick: (s: Shot) => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const planes = useRef<(HTMLButtonElement | null)[]>([]);
  const cam = useRef(0);
  const vel = useRef(0);
  const shotsRef = useRef(shots);
  const shown = useRef<number[]>([]);
  useEffect(() => {
    shotsRef.current = shots;
    shown.current = [];
  }, [shots]);

  useEffect(() => {
    const box = boxRef.current;
    if (!box || !active) return;
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      cam.current += vel.current * dt;
      vel.current *= Math.exp(-FRICTION * dt);
      // A slow idle drift keeps the field alive.
      if (!drag && Math.abs(vel.current) < 40) vel.current += (40 - vel.current) * Math.min(1, dt * 0.8);
      const w = box.clientWidth;
      const h = box.clientHeight;
      const list = shotsRef.current;
      for (let i = 0; i < PLANES; i++) {
        const el = planes.current[i];
        if (!el) continue;
        // Depth ahead of the camera, wrapping so planes recycle endlessly in both directions.
        const raw = i * GAP - cam.current;
        const lap = Math.floor(raw / DEPTH);
        const d = raw - lap * DEPTH; // 0 … DEPTH
        const n = i - lap * PLANES; // stable id for this plane in this lap
        const idx = ((n % list.length) + list.length) % list.length;
        if (shown.current[i] !== idx) {
          shown.current[i] = idx;
          const img = el.firstElementChild as HTMLImageElement;
          img.src = list[idx].src;
          el.dataset.idx = String(idx);
          el.setAttribute("aria-label", list[idx].name);
        }
        const x = (rand(n) - 0.5) * w * 1.1;
        const y = (rand(n + 0.5) - 0.5) * h * 0.9;
        const z = -d + 200;
        // Fog: fade in from the far end, fade out just before passing the camera.
        const far = Math.min(1, (DEPTH - d) / (DEPTH * 0.35));
        const near = Math.min(1, d / 260);
        el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, ${z.toFixed(1)}px)`;
        el.style.opacity = (far * near).toFixed(3);
        el.style.visibility = far * near < 0.02 ? "hidden" : "visible";
      }
      raf = requestAnimationFrame(frame);
    };
    const start = () => {
      cancelAnimationFrame(raf);
      last = performance.now();
      if (!document.hidden) raf = requestAnimationFrame(frame);
    };
    const onVis = () => (document.hidden ? cancelAnimationFrame(raf) : start());
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      vel.current += (e.deltaY + e.deltaX) * 6;
    };
    // Drag moves the camera along the dominant axis (2 px of depth per px), so diagonals never cancel out.
    let drag: { x: number; y: number; t: number; moved: number } | null = null;
    const onDown = (e: PointerEvent) => {
      // Grabbing stops the drift at once (interruptible), then the field follows the finger 1:1.
      vel.current = 0;
      delete box.dataset.dragged;
      drag = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 };
    };
    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      const now = performance.now();
      const dx = drag.x - e.clientX;
      const dyRaw = drag.y - e.clientY;
      const delta = Math.abs(dx) > Math.abs(dyRaw) ? dx : dyRaw;
      drag.moved += Math.abs(delta);
      cam.current += delta * 2;
      vel.current = (delta * 2 * 1000) / Math.max(8, now - drag.t);
      drag.x = e.clientX;
      drag.y = e.clientY;
      drag.t = now;
    };
    const onUp = () => {
      if (drag && drag.moved > 6) box.dataset.dragged = "1";
      drag = null;
    };
    box.addEventListener("wheel", onWheel, { passive: false });
    box.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    document.addEventListener("visibilitychange", onVis);
    start();
    return () => {
      cancelAnimationFrame(raf);
      box.removeEventListener("wheel", onWheel);
      box.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [active]);

  const onKey = (e: KeyboardEvent) => {
    const dir = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
    if (!dir) return;
    e.preventDefault();
    vel.current += dir * 900;
  };

  return (
    <div
      ref={boxRef}
      className="drift-field"
      tabIndex={0}
      role="region"
      aria-label="照片漂流畫廊：用方向鍵前進或後退"
      onKeyDown={onKey}
      onClickCapture={(e) => {
        // A drag ends in a click wherever the pointer lands; swallow it once, at the field.
        const box = boxRef.current;
        if (box?.dataset.dragged) {
          delete box.dataset.dragged;
          e.stopPropagation();
        }
      }}
    >
      <div className="drift-stage">
        {Array.from({ length: PLANES }, (_, i) => (
          <button
            key={i}
            type="button"
            tabIndex={-1}
            className="drift-plane"
            ref={(el) => {
              planes.current[i] = el;
            }}
            onClick={(e) => {
              const idx = Number(e.currentTarget.dataset.idx);
              if (Number.isFinite(idx) && shotsRef.current[idx]) onPick(shotsRef.current[idx]);
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- photos from several hosts; src set by the drift loop */}
            <img alt="" decoding="async" referrerPolicy="no-referrer" draggable={false} />
          </button>
        ))}
      </div>
    </div>
  );
}
