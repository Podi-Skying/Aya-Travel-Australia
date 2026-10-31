"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTrip } from "./TripApp";
import { LoadingTile, cardSrc } from "./PlaceGallery";
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
 * A plane keeps its photo until it is recycled out of sight, and a new photo fades in once loaded, so nothing
 * on screen ever changes at once (Kai 2026-10-31: on phones photos changed in an instant).
 */

export type Shot = { key: string; src: string; name: string; date?: string; dayIndex?: number; credit: string };

const MAX_PLANES = 24; // each plane is a composited layer: more made phones stutter
const GAP = 260; // depth between planes (px)
const FRICTION = 2.2; // velocity decay per second (exponential)
const MAX_SPEED = 3000; // px of depth per second: a flick travels at most about 5 planes
const DRAG_DEPTH = 1.6; // px of depth per px of finger
const DRAG_START = 10; // px before a press counts as a drag (a tap stays a tap)

type Sample = { t: number; pos: number };
/** Release speed from the last ~100 ms of the drag, not one noisy sample; 0 if the finger had stopped before letting go. */
export function releaseVelocity(samples: Sample[], now: number): number {
  const last = samples.at(-1);
  if (!last || now - last.t > 80) return 0;
  const first = samples.find((x) => last.t - x.t <= 100) ?? last;
  if (last.t === first.t) return 0;
  const v = ((last.pos - first.pos) / (last.t - first.t)) * 1000;
  return Math.max(-MAX_SPEED, Math.min(MAX_SPEED, v));
}

/** 500 px is plenty for a drifting card (full-size Commons files reach 1.6 MB and made photos pop in late). */
const small = (p: Photo) => (p.kind === "commons" ? cardSrc(p.url) : p.url);
const credit = (p: Photo) => [p.site, p.credit, p.license].filter(Boolean).join("・");

/**
 * One key per image whatever its size or source: Commons thumbnails and originals reduce to the file name,
 * other URLs drop their query and fragment (Kai 2026-10-26: no identical photos twice).
 */
export function sameImage(url: string): string {
  const commons = /upload\.wikimedia\.org\/wikipedia\/commons\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/?#]+)/i.exec(url);
  // Commons titles are case-sensitive except the first letter.
  if (commons) {
    const name = decodeURIComponent(commons[1]);
    return "commons:" + name.charAt(0).toUpperCase() + name.slice(1);
  }
  return url.replace(/[?#].*$/, "");
}

/** Every photo of the trip's places, once each: own photo, gallery, then cached Commons photos. */
export function tripShots(days: { date: string; items: Item[] }[], pool: { items: Item[] }[], commons: Record<string, Photo[]>): Shot[] {
  const seen = new Set<string>();
  const out: Shot[] = [];
  const add = (i: Item, p: Photo, date?: string, dayIndex?: number) => {
    const k = sameImage(p.url);
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ key: `${i.id}:${out.length}`, src: small(p), name: i.name, date, dayIndex, credit: credit(p) });
  };
  const each = (i: Item, date?: string, dayIndex?: number) => {
    if (isLogistics(i) || i.name.startsWith("住宿：")) return;
    for (const p of [i.photo, ...(i.gallery ?? []), ...(i.photoSources ? [] : (commons[i.id] ?? []))]) if (p) add(i, p, date, dayIndex);
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
    if (!active) return;
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
      ) : !reduce && loading && shots.length < MAX_PLANES ? (
        // The field's depth depends on how many planes it has: it starts once that number is settled.
        <div className="drift-wait">
          <LoadingTile />
        </div>
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
        <Field shots={shots} active={active} paused={!!picked} onPick={setPicked} />
      )}
      {picked && (
        <div className="drift-info card" role="status" key={picked.key}>
          {/* eslint-disable-next-line @next/next/no-img-element -- photos from several hosts */}
          <img className="drift-info-img" src={picked.src} alt="" referrerPolicy="no-referrer" />
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

function Field({ shots, active, paused, onPick }: { shots: Shot[]; active: boolean; paused: boolean; onPick: (s: Shot) => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const planes = useRef<(HTMLButtonElement | null)[]>([]);
  const cam = useRef(0);
  const vel = useRef(0);
  const shotsRef = useRef(shots);
  // Never more planes than distinct photos, so one photo is never on screen twice.
  const planeCount = Math.min(MAX_PLANES, shots.length);
  const planesRef = useRef(planeCount);
  // What each plane shows: its lap id and photo. Decided only when the plane recycles, so a longer photo list
  // (photos arrive in batches) never swaps photos that are on screen.
  const shown = useRef<{ n: number; shot: Shot }[]>([]);
  const pausedRef = useRef(paused);
  useEffect(() => {
    shotsRef.current = shots;
    planesRef.current = planeCount;
    pausedRef.current = paused;
  }, [shots, planeCount, paused]);

  useEffect(() => {
    const box = boxRef.current;
    if (!box || !active) return;
    let raf = 0;
    let last = performance.now();
    let w = box.clientWidth;
    let h = box.clientHeight;
    const sizes = new ResizeObserver(() => {
      w = box.clientWidth;
      h = box.clientHeight;
    });
    sizes.observe(box);
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      // While a finger holds the field it alone moves the camera.
      if (!dragging) {
        cam.current += vel.current * dt;
        vel.current *= Math.exp(-FRICTION * dt);
        // A slow idle drift keeps the field alive; it rests while a photo's details are open.
        const idle = pausedRef.current ? 0 : 40;
        if (Math.abs(vel.current) < 40) vel.current += (idle - vel.current) * Math.min(1, dt * 0.8);
      }
      const list = shotsRef.current;
      const PLANES = planesRef.current;
      const DEPTH = PLANES * GAP;
      for (let i = 0; i < PLANES; i++) {
        const el = planes.current[i];
        if (!el) continue;
        // Depth ahead of the camera, wrapping so planes recycle endlessly in both directions.
        const raw = i * GAP - cam.current;
        const lap = Math.floor(raw / DEPTH);
        const d = raw - lap * DEPTH; // 0 … DEPTH
        const n = i - lap * PLANES; // stable id for this plane in this lap
        const idx = ((n % list.length) + list.length) % list.length;
        if (shown.current[i]?.n !== n) {
          const shot = list[idx];
          shown.current[i] = { n, shot };
          const img = el.firstElementChild as HTMLImageElement;
          // The new photo fades in once it has loaded; until then the plane is empty, never the old photo.
          img.style.opacity = "0";
          img.onload = () => {
            img.style.opacity = "1";
          };
          img.src = shot.src;
          if (img.complete && img.naturalWidth) img.style.opacity = "1";
          el.setAttribute("aria-label", shot.name);
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
      vel.current = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, vel.current + (e.deltaY + e.deltaX) * 6));
    };
    // Drag moves the camera along the dominant axis, so diagonals never cancel out. One finger only.
    let press: { id: number; x: number; y: number; samples: Sample[] } | null = null;
    let dragging = false;
    const onDown = (e: PointerEvent) => {
      if (press) return;
      // Pressing stops the drift at once (interruptible).
      vel.current = 0;
      delete box.dataset.dragged;
      dragging = true;
      press = { id: e.pointerId, x: e.clientX, y: e.clientY, samples: [{ t: e.timeStamp, pos: cam.current }] };
    };
    const onMove = (e: PointerEvent) => {
      if (!press || e.pointerId !== press.id) return;
      const dx = press.x - e.clientX;
      const dy = press.y - e.clientY;
      const delta = Math.abs(dx) > Math.abs(dy) ? dx : dy;
      if (!box.dataset.dragged) {
        if (Math.abs(delta) < DRAG_START) return;
        box.dataset.dragged = "1";
        press.x = e.clientX;
        press.y = e.clientY;
        return;
      }
      cam.current += delta * DRAG_DEPTH;
      press.x = e.clientX;
      press.y = e.clientY;
      press.samples.push({ t: e.timeStamp, pos: cam.current });
      if (press.samples.length > 12) press.samples.shift();
    };
    const onUp = (e: PointerEvent) => {
      if (!press || e.pointerId !== press.id) return;
      // The camera carries on at the finger's speed: no seam between dragging and gliding.
      vel.current = releaseVelocity(press.samples, e.timeStamp);
      press = null;
      dragging = false;
    };
    box.addEventListener("wheel", onWheel, { passive: false });
    box.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    document.addEventListener("visibilitychange", onVis);
    start();
    return () => {
      cancelAnimationFrame(raf);
      box.removeEventListener("wheel", onWheel);
      box.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      sizes.disconnect();
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
        {Array.from({ length: planeCount }, (_, i) => (
          <button
            key={i}
            type="button"
            tabIndex={-1}
            className="drift-plane"
            ref={(el) => {
              planes.current[i] = el;
            }}
            onClick={() => {
              const shot = shown.current[i]?.shot;
              if (shot) onPick(shot);
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
