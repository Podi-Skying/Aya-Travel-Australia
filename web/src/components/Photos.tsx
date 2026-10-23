"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
import { useReducedMotion } from "./ui";
import { project, rubber, spring } from "./motion";
import type { Photo } from "@/domain/schema";

/*
 * Attraction photos (DESIGN.md「景點照片」). Photos are hotlinked from the page they were found on and
 * always carry a visible source link. The viewer opens from the tapped thumbnail and returns to it,
 * tracks drags 1:1, projects momentum to choose the slide and settles with a critically damped spring.
 */

export type DayPhoto = { id: string; name: string; photo: Photo };

const COMMONS_WIDTHS = [640, 1280, 1920];

/** Commons thumbnails come in any width, so phones can take a smaller file. */
function srcSet(p: Photo): string | undefined {
  if (p.kind !== "commons" || !/\/thumb\/.+\/\d+px-[^/]+$/.test(p.url)) return undefined;
  return COMMONS_WIDTHS.filter((w) => !p.w || w <= p.w)
    .map((w) => `${p.url.replace(/\/\d+px-([^/]+)$/, `/${w}px-$1`)} ${w}w`)
    .join(", ");
}

export function PhotoCredit({ photo }: { photo: Photo }) {
  return (
    <>
      圖片來源：
      <a href={photo.page} target="_blank" rel="noopener noreferrer">
        {photo.site}
      </a>
      {photo.credit ? `・${photo.credit}` : ""}
      {photo.license ? `（${photo.license}）` : ""}
    </>
  );
}

export function ActPhoto({ id, name, photo, onOpen }: { id: string; name: string; photo: Photo; onOpen: () => void }) {
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const ratio = photo.w && photo.h ? `${photo.w} / ${photo.h}` : "3 / 2";
  return (
    <figure className="act-photo">
      {state === "error" ? (
        <div className="ph ph-error" style={{ aspectRatio: "3 / 1" }}>
          <Icon name="image" size={20} /> 照片載入不了（可能離線或來源網站擋住）
        </div>
      ) : (
        <button type="button" className={`ph ${state === "ok" ? "is-loaded" : ""}`} style={{ aspectRatio: ratio }} onClick={onOpen} aria-label={`放大看照片：${name}`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- hotlinked from many hosts; next/image would re-host them */}
          <img
            src={photo.url}
            srcSet={srcSet(photo)}
            sizes="(max-width: 720px) 100vw, 560px"
            alt={name}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            data-photo-id={id}
            width={photo.w}
            height={photo.h}
            onLoad={() => setState("ok")}
            onError={() => setState("error")}
          />
        </button>
      )}
      <figcaption>
        <PhotoCredit photo={photo} />
      </figcaption>
    </figure>
  );
}

export function mapsPhotoLink(query: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/* ------------------------------------------------------------------ viewer */

/** Writes a transform to a slide (kept outside the component so the hook-immutability lint sees a plain DOM write). */
function setSlideTransform(track: HTMLElement | null, i: number, transform: string) {
  const el = track?.children[i]?.querySelector("img");
  if (el) el.style.transform = transform;
}

/** Vertical space kept for the top bar and caption (matches .viewer-slide img max-height). */
const CHROME = 128;

type Drag = { id: number; x0: number; y0: number; axis: "x" | "y" | null; hist: { t: number; x: number; y: number }[] };

export function PhotoViewer({ photos, start, onClose }: { photos: DayPhoto[]; start: number; onClose: (lastId: string) => void }) {
  const reduce = useReducedMotion();
  const [index, setIndex] = useState(start);
  const idx = useRef(start);
  const root = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  // x: track offset in px; y: vertical dismiss offset; o: open progress (0 = at thumbnail, 1 = full screen).
  const st = useRef({ x: 0, y: 0, o: 0 });
  const anims = useRef<Record<string, (() => void) | undefined>>({});
  const drag = useRef<Drag | null>(null);
  const closing = useRef(false);

  const width = () => root.current?.clientWidth ?? window.innerWidth;

  /** Offset and scale that put the current photo exactly over its thumbnail (computed from the untransformed slide). */
  const thumbDelta = useCallback(() => {
    const p = photos[idx.current];
    const thumb = document.querySelector<HTMLElement>(`[data-photo-id="${p.id}"]`)?.getBoundingClientRect();
    const slide = track.current?.children[idx.current] as HTMLElement | undefined;
    const img = slide?.querySelector("img");
    if (!thumb?.width || !slide || !img) return null;
    const r = slide.getBoundingClientRect();
    const iw = img.naturalWidth || p.photo.w || thumb.width;
    const ih = img.naturalHeight || p.photo.h || thumb.height;
    const fit = Math.min(1, r.width / iw, (r.height - CHROME) / ih);
    return { dx: thumb.left + thumb.width / 2 - (r.left + r.width / 2), dy: thumb.top + thumb.height / 2 - (r.top + r.height / 2), s: thumb.width / (iw * fit) };
  }, [photos]);

  const apply = useCallback(() => {
    const { x, y, o } = st.current;
    const w = width();
    if (track.current) track.current.style.transform = `translate3d(${x - idx.current * w}px, 0, 0)`;
    const fade = 1 - Math.min(1, Math.abs(y) / 400);
    if (root.current) root.current.style.setProperty("--scrim", String(Math.max(0, o) * fade));
    const shrink = 1 - Math.min(0.15, Math.abs(y) / 2000);
    const d = o < 1 ? thumbDelta() : null;
    const k = 1 - o;
    setSlideTransform(
      track.current,
      idx.current,
      d ? `translate3d(${k * d.dx}px, ${k * d.dy + y}px, 0) scale(${(1 + k * (d.s - 1)) * shrink})` : `translate3d(0, ${y}px, 0) scale(${shrink})`,
    );
  }, [thumbDelta]);

  const run = useCallback(
    (key: "x" | "y" | "o", to: number, v0: number, response: number, done?: () => void) => {
      anims.current[key]?.();
      if (reduce) {
        st.current[key] = to;
        apply();
        done?.();
        return;
      }
      anims.current[key] = spring(st.current[key], v0, to, response, (v) => {
        st.current[key] = v;
        apply();
      }, done);
    },
    [apply, reduce],
  );

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    const id = photos[idx.current].id;
    run("y", 0, 0, 0.35);
    run("o", 0, 0, 0.35, () => onClose(id));
  }, [photos, run, onClose]);

  const go = useCallback(
    (n: number, v0 = 0) => {
      const to = Math.max(0, Math.min(photos.length - 1, n));
      const w = width();
      // Re-base the track on the new slide so x animates from where it is now to 0.
      st.current.x += (to - idx.current) * w;
      idx.current = to;
      setIndex(to);
      run("x", 0, v0, 0.3);
    },
    [photos.length, run],
  );

  useLayoutEffect(() => {
    apply();
    run("o", 1, 0, 0.35);
    closeBtn.current?.focus({ preventScroll: true });
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onResize = () => apply();
    window.addEventListener("resize", onResize);
    const current = anims.current;
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("resize", onResize);
      Object.values(current).forEach((c) => c?.());
    };
    // Open once; later changes animate through go()/close().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") go(idx.current + 1);
      else if (e.key === "ArrowLeft") go(idx.current - 1);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [close, go]);

  function down(e: ReactPointerEvent) {
    if (e.button !== 0 || closing.current) return;
    anims.current.x?.();
    anims.current.y?.();
    drag.current = { id: e.pointerId, x0: e.clientX - st.current.x, y0: e.clientY - st.current.y, axis: null, hist: [{ t: e.timeStamp, x: e.clientX, y: e.clientY }] };
  }
  function move(e: ReactPointerEvent) {
    const g = drag.current;
    if (!g || g.id !== e.pointerId) return;
    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;
    if (!g.axis) {
      if (Math.hypot(dx - st.current.x, dy - st.current.y) < 10) return;
      g.axis = Math.abs(dy - st.current.y) > Math.abs(dx - st.current.x) ? "y" : "x";
      root.current?.setPointerCapture(e.pointerId);
    }
    g.hist.push({ t: e.timeStamp, x: e.clientX, y: e.clientY });
    if (g.hist.length > 6) g.hist.shift();
    if (g.axis === "x") {
      const w = width();
      const edge = (idx.current === 0 && dx > 0) || (idx.current === photos.length - 1 && dx < 0);
      st.current.x = edge ? rubber(dx, w) : dx;
    } else {
      st.current.y = dy < 0 ? rubber(dy, 400) : dy;
    }
    apply();
  }
  function up(e: ReactPointerEvent) {
    const g = drag.current;
    drag.current = null;
    if (!g || g.id !== e.pointerId || !g.axis) return;
    const a = g.hist[0];
    const b = g.hist[g.hist.length - 1];
    const dt = Math.max(1, b.t - a.t) / 1000;
    const vx = (b.x - a.x) / dt;
    const vy = (b.y - a.y) / dt;
    if (g.axis === "y") {
      if (st.current.y + project(vy) > 160) close();
      else run("y", 0, vy, 0.35);
      return;
    }
    const w = width();
    const projected = st.current.x + project(vx);
    const step = projected < -w / 2 ? 1 : projected > w / 2 ? -1 : 0;
    if (step) go(idx.current + step, vx);
    else run("x", 0, vx, 0.3);
  }

  const p = photos[index];
  return createPortal(
    <div className={`viewer${reduce ? " reduce" : ""}`} ref={root} role="dialog" aria-modal="true" aria-label={`照片：${p.name}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <div className="viewer-track" ref={track}>
        {photos.map((x) => (
          <div className="viewer-slide" key={x.id}>
            {/* eslint-disable-next-line @next/next/no-img-element -- hotlinked full-size photo */}
            <img src={x.photo.url} alt={x.name} referrerPolicy="no-referrer" draggable={false} />
          </div>
        ))}
      </div>
      <div className="viewer-bar">
        <button type="button" ref={closeBtn} className="viewer-btn" onClick={close} aria-label="關閉照片">
          <Icon name="close" size={20} />
        </button>
        <span className="viewer-count" aria-live="polite">
          {index + 1} / {photos.length}
        </span>
      </div>
      {photos.length > 1 && (
        <>
          <button type="button" className="viewer-btn viewer-prev" onClick={() => go(index - 1)} disabled={index === 0} aria-label="上一張">
            <Icon name="chevron-left" size={22} />
          </button>
          <button type="button" className="viewer-btn viewer-next" onClick={() => go(index + 1)} disabled={index === photos.length - 1} aria-label="下一張">
            <Icon name="chevron-right" size={22} />
          </button>
        </>
      )}
      <p className="viewer-caption">
        <strong>{p.name}</strong>
        <span>
          <PhotoCredit photo={p.photo} />
        </span>
      </p>
    </div>,
    document.body,
  );
}
