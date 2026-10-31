"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useTrip } from "./TripApp";
import { LoadingTile, cardSrc } from "./PlaceGallery";
import { project, rubber, spring } from "./motion";
import { useOnceHint, useReducedMotion } from "./ui";
import { Icon } from "./Icon";
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

const IDLE_SPEED = 40;
const IDLE_AFTER_MS = 1500; // the drift comes back this long after the last touch, in the same direction

/** The axis of a drag, chosen once after DRAG_START px; null until then. It stays locked, so a diagonal swipe never jitters. */
export function lockAxis(dx: number, dy: number): "x" | "y" | null {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < DRAG_START) return null;
  return Math.abs(dx) > Math.abs(dy) ? "x" : "y";
}

/** What a plane shows: its photo stays while it stays in the same lap, whatever happens to the list. */
export function planeShot<T>(prev: { n: number; shot: T } | undefined, n: number, list: T[]): { n: number; shot: T } {
  if (prev && prev.n === n) return prev;
  return { n, shot: list[((n % list.length) + list.length) % list.length] };
}

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
  const [picked, setPicked] = useState<{ shot: Shot; from: DOMRect | null } | null>(null);

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

  const [hint, doneHint] = useOnceHint("aya-hint-gallery");
  const shots = useMemo(() => tripShots(doc.days, doc.attractionPool, commons), [doc, commons]);

  return (
    <div className="drift" onPointerDown={hint ? doneHint : undefined} onWheel={hint ? doneHint : undefined} onKeyDown={hint ? doneHint : undefined}>
      <h2 className="sr-only">畫廊</h2>
      {!loading && shots.length > 0 && (
        <span className="drift-count" role="img" aria-label={`共 ${shots.length} 張`}>
          <Icon name="image" size={14} /> {shots.length}
        </span>
      )}
      {!reduce && hint && shots.length > 0 && (
        <p className="drift-hint" onClick={doneHint} role="note">
          滑動漂流・點照片看是哪裡
        </p>
      )}
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
              <button type="button" onClick={() => setPicked({ shot: s, from: null })} aria-label={`${s.name}${s.date ? `，${fmtDay(s.date)}` : ""}`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- photos from several hosts */}
                <img src={s.src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <Field shots={shots} active={active} paused={!!picked} onPick={(shot, from) => setPicked({ shot, from })} />
      )}
      {picked && (
        <DetailSheet
          key={picked.shot.key}
          shot={picked.shot}
          from={picked.from}
          reduce={reduce}
          onClose={() => setPicked(null)}
          onGoto={picked.shot.dayIndex != null ? () => gotoDay(picked.shot.dayIndex!) : undefined}
        />
      )}
    </div>
  );
}

/**
 * A picked photo: it grows from where it was in the field into a sheet (and returns the same way). The sheet
 * follows a finger down and closes on a throw, carrying the finger's speed. Reduced motion cross-fades instead.
 */
function DetailSheet({ shot, from, reduce, onClose, onGoto }: { shot: Shot; from: DOMRect | null; reduce: boolean; onClose: () => void; onGoto?: () => void }) {
  const sheet = useRef<HTMLDivElement>(null);
  const bg = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const photo = useRef<HTMLImageElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  // p: 0 at the photo in the field, 1 open. y: the finger's offset.
  const state = useRef({ p: 0, y: 0, fromX: 0, fromY: 0, scale: 1, grow: false });
  const stop = useRef<(() => void)[]>([]);
  const closing = useRef(false);
  const drag = useRef<{ id: number; y0: number; moved: boolean; samples: Sample[] } | null>(null);

  const paint = () => {
    const st = state.current;
    const k = 1 - st.p;
    if (sheet.current) {
      sheet.current.style.transform = st.grow ? `translate3d(${st.fromX * k}px, ${st.fromY * k + st.y}px, 0) scale(${st.scale + (1 - st.scale) * st.p})` : `translate3d(0, ${st.y}px, 0)`;
      sheet.current.style.opacity = st.grow ? "1" : String(st.p);
    }
    if (bg.current) bg.current.style.opacity = String(st.p);
    if (body.current) body.current.style.opacity = String(st.p);
    if (scrim.current) scrim.current.style.opacity = String(st.p);
  };
  const run = (to: number, v0: number, done?: () => void) => {
    stop.current.forEach((f) => f());
    const st = state.current;
    if (reduce) {
      st.p = to;
      st.y = 0;
      paint();
      done?.();
      return;
    }
    stop.current = [
      spring(st.p, 0, to, 0.3, (x) => {
        st.p = x;
        paint();
      }, done),
      spring(st.y, v0, 0, 0.3, (x) => {
        st.y = x;
        paint();
      }),
    ];
  };
  const close = (v0 = 0) => {
    if (closing.current) return;
    closing.current = true;
    run(0, v0, onClose);
  };

  useLayoutEffect(() => {
    const st = state.current;
    const r = photo.current?.getBoundingClientRect();
    const box = sheet.current?.getBoundingClientRect();
    if (!reduce && from && r && box && r.width) {
      st.grow = true;
      st.scale = from.width / r.width;
      // The sheet scales from the photo's top left corner, so that corner is what travels.
      if (sheet.current) sheet.current.style.transformOrigin = `${r.left - box.left}px ${r.top - box.top}px`;
      st.fromX = from.left - r.left;
      st.fromY = from.top - r.top;
    }
    paint();
    run(1, 0);
    closeBtn.current?.focus({ preventScroll: true });
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    const stops = stop;
    return () => {
      window.removeEventListener("keydown", onKey);
      stops.current.forEach((f) => f());
      // Back to the field the sheet came from.
      document.querySelector<HTMLElement>(".drift-field")?.focus({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onDown = (e: ReactPointerEvent) => {
    if (drag.current || closing.current || (e.target as Element).closest("button")) return;
    stop.current.forEach((f) => f());
    // A grab mid-opening finishes opening under the finger.
    state.current.p = 1;
    drag.current = { id: e.pointerId, y0: e.clientY - state.current.y, moved: false, samples: [{ t: e.timeStamp, pos: state.current.y }] };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    paint();
  };
  const onMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    const raw = e.clientY - d.y0;
    if (!d.moved && Math.abs(raw) < DRAG_START) return;
    d.moved = true;
    state.current.y = raw >= 0 ? raw : rubber(raw, 300);
    d.samples.push({ t: e.timeStamp, pos: state.current.y });
    if (d.samples.length > 12) d.samples.shift();
    paint();
  };
  const onUp = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    drag.current = null;
    const v = releaseVelocity(d.samples, e.timeStamp);
    if (e.type !== "pointercancel" && state.current.y + project(v) > 140) close(v);
    else run(1, v);
  };

  return (
    <>
      <div ref={scrim} className="drift-scrim" onClick={() => close()} aria-hidden="true" />
      <div ref={sheet} className="drift-sheet" role="dialog" aria-modal="true" aria-label={shot.name} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <div ref={bg} className="drift-sheet-bg" />
        {/* eslint-disable-next-line @next/next/no-img-element -- photos from several hosts */}
        <img ref={photo} className="drift-info-img" src={shot.src} alt="" referrerPolicy="no-referrer" draggable={false} />
        <div ref={body} className="drift-sheet-body">
          <strong>{shot.name}</strong>
          <span className="small muted">{shot.date ? fmtDay(shot.date) : "還沒排進行程"}</span>
          <span className="small muted">{shot.credit}</span>
          <span className="drift-info-actions">
            {onGoto && (
              <button type="button" className="btn small" onClick={onGoto}>
                看那天的行程
              </button>
            )}
            <button ref={closeBtn} type="button" className="btn ghost small" onClick={() => close()}>
              關閉
            </button>
          </span>
        </div>
      </div>
    </>
  );
}

function Field({ shots, active, paused, onPick }: { shots: Shot[]; active: boolean; paused: boolean; onPick: (s: Shot, from: DOMRect) => void }) {
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
    let lastTouch = -Infinity;
    let dir = 1;
    let press: { id: number; x0: number; y0: number; axis: "x" | "y" | null; x: number; y: number; samples: Sample[] } | null = null;
    const wanted = new Set<string>();
    /** Fetch and decode ahead, so a photo is ready when its plane comes into view. */
    const preload = (src: string) => {
      if (wanted.has(src)) return;
      wanted.add(src);
      const im = new Image();
      im.referrerPolicy = "no-referrer";
      im.src = src;
    };
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
      if (!press?.axis) {
        cam.current += vel.current * dt;
        if (Math.abs(vel.current) > IDLE_SPEED) vel.current *= Math.exp(-FRICTION * dt);
        else {
          // Below drift speed: settle, then the drift eases back in the direction of the last motion, never reversing.
          const idle = !press && !pausedRef.current && now - lastTouch > IDLE_AFTER_MS ? IDLE_SPEED * dir : 0;
          vel.current += (idle - vel.current) * Math.min(1, dt);
        }
        if (Math.abs(vel.current) > 1) dir = Math.sign(vel.current);
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
        const idx = ((n % list.length) + list.length) % list.length; // for reading ahead
        if (shown.current[i]?.n !== n) {
          const next = planeShot(shown.current[i], n, list);
          shown.current[i] = next;
          const img = el.firstElementChild as HTMLImageElement;
          // The plane is out of sight here. It stays empty until the new photo is decoded, then eases in; never the old photo.
          img.style.opacity = "0";
          img.dataset.pending = "1";
          const im = new Image();
          im.referrerPolicy = "no-referrer";
          im.src = next.shot.src;
          void im.decode().then(
            () => {
              if (shown.current[i] !== next) return;
              img.src = next.shot.src;
              delete img.dataset.pending;
              img.style.opacity = "1";
            },
            () => undefined, // a broken photo leaves its plane empty
          );
          el.setAttribute("aria-label", next.shot.name);
          for (let k = 1; k <= 12; k++) preload(list[(((idx + k * dir) % list.length) + list.length) % list.length].src);
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
      lastTouch = performance.now();
    };
    // One finger, one axis (locked after DRAG_START), 1:1 from there: swipe up or left goes forward.
    const onDown = (e: PointerEvent) => {
      if (press) return;
      // Pressing stops the drift at once (interruptible).
      vel.current = 0;
      lastTouch = performance.now();
      delete box.dataset.dragged;
      press = { id: e.pointerId, x0: e.clientX, y0: e.clientY, axis: null, x: e.clientX, y: e.clientY, samples: [] };
    };
    const onMove = (e: PointerEvent) => {
      if (!press || e.pointerId !== press.id) return;
      if (!press.axis) {
        press.axis = lockAxis(e.clientX - press.x0, e.clientY - press.y0);
        if (!press.axis) return;
        box.dataset.dragged = "1";
        box.setPointerCapture?.(e.pointerId);
        press.samples.push({ t: e.timeStamp, pos: cam.current });
      } else {
        cam.current += (press.axis === "x" ? press.x - e.clientX : press.y - e.clientY) * DRAG_DEPTH;
        press.samples.push({ t: e.timeStamp, pos: cam.current });
        if (press.samples.length > 12) press.samples.shift();
      }
      press.x = e.clientX;
      press.y = e.clientY;
    };
    const onUp = (e: PointerEvent) => {
      if (!press || e.pointerId !== press.id) return;
      // The camera carries on at the finger's speed: no seam between dragging and gliding. A cancelled touch just stops.
      vel.current = e.type === "pointercancel" ? 0 : releaseVelocity(press.samples, e.timeStamp);
      lastTouch = performance.now();
      press = null;
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
    vel.current = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, vel.current + dir * 900));
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
            onClick={(e) => {
              const shot = shown.current[i]?.shot;
              if (shot) onPick(shot, e.currentTarget.getBoundingClientRect());
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
