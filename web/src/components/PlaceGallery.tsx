"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useTrip } from "./TripApp";
import { Icon } from "./Icon";
import { project, rubber, spring } from "./motion";
import { commonsFor, googleFor } from "@/client/photos";
import { galleryPhotos, type GalleryPhoto, type GoogleShot } from "@/domain/gallery";
import { isLogistics } from "@/domain/day-title";
import type { Item, Photo } from "@/domain/schema";

/*
 * A place's photos, switched in place (Kai 2026-10-26: no pop-up). Tap or click shows the next photo with a
 * short crossfade; a drag moves the photo with the finger and a throw (projected from its speed) changes it,
 * otherwise it springs back (rubber-banding past a single photo); arrow keys work when focused; 「2 / 9」 counts them. The
 * current photo's credit sits under the card as plain text (Google photos keep their author and Maps links,
 * as Google requires). While photos load, a drawn camera pulses; a place with none shows its category icon.
 */

const CAT_ICON: Record<string, string> = {
  nature: "cat-nature",
  beach: "cat-beach",
  lookout: "cat-lookout",
  wildlife: "cat-wildlife",
  food: "cat-food",
  market: "cat-market",
  town: "cat-town",
  history: "cat-history",
  art: "cat-art",
  activity: "cat-activity",
};

/** Commons serves fixed thumbnail widths; 500 px is plenty for a card. */
export const cardSrc = (src: string) => src.replace(/(upload\.wikimedia\.org\/.+\/thumb\/.+\/)\d+px-([^/]+)$/, "$1500px-$2");

/** Loading: a drawn camera that pulses (static under reduced motion). */
export function LoadingTile({ label = "載入照片中" }: { label?: string }) {
  return (
    <span className="ph-tile is-loading" role="status" aria-label={label}>
      <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true">
        <path className="cam" d="M4 8h3l1.5-2h7L17 8h3v11H4z M12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

/** No photo at all: the place's category icon and name on a tint. */
export function EmptyTile({ item }: { item: Pick<Item, "name" | "cat"> }) {
  return (
    <span className="ph-tile is-empty" aria-hidden="true">
      <Icon name={(item.cat && CAT_ICON[item.cat]) || "pin"} size={28} />
      <span className="n">{item.name}</span>
    </span>
  );
}

function Credit({ p }: { p: GalleryPhoto }) {
  if (p.credit.authors)
    // Google requires the authors' names with their profile links and a way to see the photo on Google Maps.
    return (
      <span className="pg-credit">
        {p.credit.authors.length
          ? p.credit.authors.map((a, k) => (
              <span key={k}>
                {k ? "、" : ""}
                {a.uri ? (
                  <a href={a.uri} target="_blank" rel="noopener noreferrer">
                    {a.name}
                  </a>
                ) : (
                  a.name
                )}
              </span>
            ))
          : "Google 使用者"}
        ・
        <a href={p.credit.href} target="_blank" rel="noopener noreferrer">
          Google 地圖
        </a>
      </span>
    );
  return <span className="pg-credit">{p.credit.label}</span>;
}

/**
 * Photos of one place in its card. Cached Commons photos load once the card is on screen; Google photos
 * (billed) load on screen only when the place has no other photo, else when the viewer reaches the last one.
 * `empty="hide"` renders nothing for a place without photos (每日行程 rows stay text-only).
 */
export function PlaceGallery(props: { item: Item; className?: string; empty?: "tile" | "hide" }) {
  // A renamed or moved place starts fresh (photo position, Google request), as if newly mounted.
  const { item } = props;
  return <PlaceGalleryInner key={`${item.id}|${item.name}|${item.lat}|${item.lng}`} {...props} />;
}

function PlaceGalleryInner({ item, className = "", empty = "hide" }: { item: Item; className?: string; empty?: "tile" | "hide" }) {
  const { token } = useTrip();
  // Photos for everyone (Kai 2026-10-27); the server caps Google calls per audience.
  const privateView = true;
  const googleOk = privateView && item.lat != null && !isLogistics(item) && !item.name.startsWith("住宿：") && item.photoSources !== "own";
  const commonsOk = privateView && !item.photoSources;
  const ref = `${item.id}|${item.name}|${item.lat}|${item.lng}`;
  const r = useMemo(() => ({ id: item.id, name: item.name, lat: item.lat, lng: item.lng }), [item.id, item.name, item.lat, item.lng]);
  const [commons, setCommons] = useState<{ id: string; list: Photo[] } | null>(null);
  const [google, setGoogle] = useState<{ id: string; list: GoogleShot[] } | null>(null);
  const [wantGoogle, setWantGoogle] = useState(false);
  const [idx, setIdx] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const boxRef = useRef<HTMLDivElement>(null);
  // Nothing is requested before the card is near the screen (hidden tabs stay mounted).
  const [seen, setSeen] = useState(false);
  const [broken, setBroken] = useState<Set<string>>(() => new Set());
  const [loaded, setLoaded] = useState<Set<string>>(() => new Set());
  const swipe = useRef<{ x: number; y: number; used: boolean; axis: "x" | "y" | null; dx: number; v: number; t: number } | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const settle = useRef<(() => void) | null>(null);
  const shift = (x: number) => {
    if (imgRef.current) imgRef.current.style.transform = x ? `translateX(${x}px)` : "";
  };

  const own = galleryPhotos(item, undefined, undefined).length;
  // Curated places skip the Wikimedia list entirely.
  const c = !commonsOk && privateView ? [] : commons?.id === ref ? commons.list : undefined;
  const g = google?.id === ref ? google.list : undefined;

  useEffect(() => {
    const el = boxRef.current;
    if (seen || !el) return;
    const io = new IntersectionObserver(
      (es) => {
        if (!es.some((e) => e.isIntersecting)) return;
        io.disconnect();
        setSeen(true);
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  useEffect(() => {
    if (!seen || !commonsOk) return;
    let live = true;
    void commonsFor(r, token).then((list) => {
      if (!live) return;
      setCommons({ id: ref, list });
      if (!own && !list.length) setWantGoogle(true);
    });
    return () => {
      live = false;
    };
  }, [seen, privateView, commonsOk, ref, r, token, own]);
  // A curated place with no photo of its own asks Google as soon as it is on screen.
  const wantG = wantGoogle || (seen && privateView && !commonsOk && !own);
  useEffect(() => {
    if (!wantG || !googleOk) return;
    let live = true;
    void googleFor(r, token).then((list) => live && setGoogle({ id: ref, list }));
    return () => {
      live = false;
    };
  }, [wantG, googleOk, ref, r, token]);

  // Photos that failed to load drop out; when none is left the category tile shows.
  const photos = galleryPhotos(item, c, g).filter((x) => !broken.has(x.src));
  const commonsPending = privateView && c === undefined;
  const googlePending = googleOk && wantG && g === undefined;
  const more = googleOk && g === undefined && !wantG; // Google may add photos at the end
  const cur = photos.length ? Math.min(idx, photos.length - 1) : 0;
  const p = photos[cur];

  // Preload the next photo so the switch is instant (only for a card on screen).
  const nextSrc = photos.length > 1 ? photos[(cur + 1) % photos.length].src : null;
  useEffect(() => {
    if (!seen || !nextSrc) return;
    const im = new Image();
    im.referrerPolicy = "no-referrer";
    im.src = cardSrc(nextSrc);
  }, [seen, nextSrc]);

  if (!seen) return <div ref={boxRef} className={`pg-card ${className}`}>{empty === "hide" && !own ? null : <LoadingTile />}</div>;
  if (!p) {
    if (commonsPending || googlePending) return <div ref={boxRef} className={`pg-card ${className}`}><LoadingTile /></div>;
    return empty === "hide" ? <div ref={boxRef} className="pg-probe" /> : <div ref={boxRef} className={`pg-card ${className}`}><EmptyTile item={item} /></div>;
  }

  const total = photos.length;
  const go = (step: 1 | -1) => {
    setDir(step);
    if (step === 1 && cur === total - 1 && more) {
      setWantGoogle(true); // reaching the end asks Google for more, once; the next tap moves on
      return;
    }
    setIdx((cur + step + total) % total);
  };
  const onKey = (e: KeyboardEvent) => {
    const step = ({ ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Enter: 1, " ": 1 } as Record<string, 1 | -1>)[e.key];
    if (!step || total + (more ? 1 : 0) < 2) return;
    e.preventDefault();
    go(step);
  };
  const multi = total > 1 || more;
  const onDown = (e: ReactPointerEvent) => {
    settle.current?.(); // grab a photo that is still springing back
    swipe.current = { x: e.clientX, y: e.clientY, used: false, axis: null, dx: 0, v: 0, t: e.timeStamp };
  };
  const onMove = (e: ReactPointerEvent) => {
    const s = swipe.current;
    if (!s) return;
    if (e.pointerType === "mouse" && e.buttons === 0 && !s.axis) {
      swipe.current = null; // released outside before any drag began
      return;
    }
    const dx = e.clientX - s.x;
    if (!s.axis) {
      // ~10px before choosing: a vertical move stays a page scroll.
      if (Math.max(Math.abs(dx), Math.abs(e.clientY - s.y)) < 10) return;
      s.axis = Math.abs(dx) > Math.abs(e.clientY - s.y) ? "x" : "y";
      if (s.axis === "x") (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    }
    if (s.axis !== "x") return;
    const dt = Math.max(1, e.timeStamp - s.t);
    s.v = ((dx - s.dx) / dt) * 1000;
    s.dx = dx;
    s.t = e.timeStamp;
    const w = (e.currentTarget as HTMLElement).clientWidth;
    shift(multi ? dx : rubber(dx, w)); // one photo: resists instead of moving freely
  };
  const onUp = (e: ReactPointerEvent) => {
    const s = swipe.current;
    if (!s || s.axis !== "x") return;
    s.used = true;
    const w = (e.currentTarget as HTMLElement).clientWidth;
    const end = s.dx + project(s.v);
    if (multi && Math.abs(end) > w * 0.3) {
      shift(0);
      go(end < 0 ? 1 : -1);
      return;
    }
    const from = multi ? s.dx : rubber(s.dx, w);
    settle.current = spring(from, s.v, 0, 0.3, shift, () => (settle.current = null));
  };
  const onCancel = () => {
    const s = swipe.current;
    swipe.current = null;
    if (s?.axis === "x") settle.current = spring(s.dx, 0, 0, 0.3, shift, () => (settle.current = null));
  };
  return (
    <figure ref={boxRef as never} className={`pg-card ${className}`}>
      <div
        className={`pg-frame${multi ? " is-multi" : ""}`}
        role={multi ? "button" : undefined}
        tabIndex={multi ? 0 : undefined}
        aria-label={multi ? `${item.name} 的照片，第 ${cur + 1} 張，共 ${total}${more ? " 張以上" : " 張"}；按一下、左右滑或用方向鍵換照片` : undefined}
        onClick={() => {
          if (swipe.current?.used) {
            swipe.current = null;
            return;
          }
          if (multi) go(1);
        }}
        onKeyDown={onKey}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onCancel}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- photos from several hosts */}
        <img
          key={p.src}
          className={`pg-img in-${dir > 0 ? "next" : "prev"}${loaded.has(p.src) ? "" : " is-loading"}`}
          src={cardSrc(p.src)}
          alt={p.alt}
          referrerPolicy="no-referrer"
          draggable={false}
          decoding="async"
          loading="lazy"
          style={p.pos ? { objectPosition: p.pos } : undefined}
          onLoad={() => setLoaded((s) => new Set(s).add(p.src))}
          ref={(el) => {
            imgRef.current = el;
            // A request that never answers counts as failed after 20 s, so no card stays loading.
            if (!el || el.complete) return;
            const src = p.src;
            window.setTimeout(() => {
              if (!el.complete || el.naturalWidth === 0) setBroken((s) => (s.has(src) ? s : new Set(s).add(src)));
            }, 20_000);
          }}
          onError={() => setBroken((s) => new Set(s).add(p.src))}
        />
        {!loaded.has(p.src) && <LoadingTile />}
        {multi && (
          <span className="pg-chip" aria-hidden="true">
            <Icon name="image" size={12} /> {cur + 1} / {total}
            {more ? "+" : ""}
          </span>
        )}
        {googlePending && <span className="pg-more" aria-hidden="true" />}
      </div>
      <figcaption>
        <Credit p={p} />
      </figcaption>
    </figure>
  );
}

export type { GalleryPhoto };
