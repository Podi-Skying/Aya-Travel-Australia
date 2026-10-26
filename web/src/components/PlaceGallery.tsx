"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { isLogistics } from "@/domain/day-title";
import { useTrip } from "./TripApp";
import { Icon } from "./Icon";
import { commonsFor, googleFor } from "@/client/photos";
import {
  galleryPhotos,
  type GalleryPhoto,
  type GoogleShot,
} from "@/domain/gallery";
import type { Item, Photo } from "@/domain/schema";
import Stack from "./stack/Stack";

/*
 * Photo gallery for an activity (docs/PLAN-2026-10-26-galleries.md): React Bits Stack (replaced the
 * FlexCarousel on 2026-10-26, Kai's choice) in a sheet opened from the place's photo. Credits are plain text;
 * Google photos keep their authors' links and a Google Maps link, as Google requires.
 */

/**
 * Stack of photo cards (React Bits Stack, fan layout, 230×230): click, Enter or Space sends the front
 * card to the back. The counter and the credit follow the front card.
 */
export function Carousel({ photos, label }: { photos: GalleryPhoto[]; label: string }) {
  // Keyed by the sources so the counter resets with the Stack when the list changes.
  return <PhotoStack key={photos.map((p) => p.src).join("|")} photos={photos} label={label} />;
}

function PhotoStack({ photos, label }: { photos: GalleryPhoto[]; label: string }) {
  const [top, setTop] = useState(0);
  const front = photos[top] ?? photos[0];
  return (
    <div className="gallery">
      <div className="gallery-stack" role="group" aria-label={`${label}：按一下、Enter 或空白鍵換下一張`}>
        <Stack
          layout="fan"
          sendToBackOnClick
          onChange={setTop}
          cards={photos.map((p) => (
            // eslint-disable-next-line @next/next/no-img-element -- photos from several hosts
            <img key={p.src} src={p.src} alt={p.alt} draggable={false} referrerPolicy="no-referrer" />
          ))}
        />
      </div>
      <p className="gallery-meta">
        <span aria-live="polite">
          {Math.min(top + 1, photos.length)} / {photos.length}
        </span>
        {front?.credit.authors ? (
          // Google requires the authors' names with their profile links and a way to see the photo on Google Maps.
          <span className="small">
            {front.credit.authors.length
              ? front.credit.authors.map((a, k) => (
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
            <a href={front.credit.href} target="_blank" rel="noopener noreferrer">
              Google 地圖
            </a>
          </span>
        ) : front ? (
          // Other photos: the author and licence as plain text (no link, Kai 2026-10-26).
          <span className="small muted">{front.credit.label}</span>
        ) : null}
      </p>
    </div>
  );
}

/**
 * The place's photo is the gallery button (Kai 2026-10-26: no separate 「看照片」 button). Clicking it opens
 * the Stack in a sheet. A count chip shows how many photos wait; with no photos at all the thumbnail is
 * plain (or `fallback` shows when there is no thumbnail either).
 */
export function PlaceGallery({ item, thumb, fallback = null, className = "" }: { item: Item; thumb?: ReactNode; fallback?: ReactNode; className?: string }) {
  const { mode, token } = useTrip();
  const [open, setOpen] = useState(false);
  const [commons, setCommons] = useState<{ id: string; list: Photo[] } | null>(null);
  const [google, setGoogle] = useState<{ id: string; list: GoogleShot[] } | null>(null);
  const boxRef = useRef<HTMLSpanElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const privateView = mode === "owner" || !!token;
  const googleOk = privateView && item.lat != null && !isLogistics(item) && !item.name.startsWith("住宿：");
  // Name and position are part of the key: a renamed or moved activity asks the server again.
  const ref = `${item.id}|${item.name}|${item.lat}|${item.lng}`;
  const r = useMemo(() => ({ id: item.id, name: item.name, lat: item.lat, lng: item.lng }), [item.id, item.name, item.lat, item.lng]);

  // Cached Commons lists cost nothing outside the site, so they load once the thumbnail is on screen (for the count).
  useEffect(() => {
    const el = boxRef.current;
    if (!privateView || !el) return;
    let live = true;
    const io = new IntersectionObserver((es) => {
      if (!es.some((e) => e.isIntersecting)) return;
      io.disconnect();
      void commonsFor(r, token).then((list) => live && setCommons({ id: ref, list }));
    });
    io.observe(el);
    return () => {
      live = false;
      io.disconnect();
    };
  }, [privateView, ref, r, token]);
  // Google photos are billed, so they load only when the gallery opens (Commons too, if not loaded yet).
  useEffect(() => {
    if (!open) return;
    let live = true;
    if (privateView) void commonsFor(r, token).then((list) => live && setCommons({ id: ref, list }));
    if (googleOk) void googleFor(r, token).then((list) => live && setGoogle({ id: ref, list }));
    return () => {
      live = false;
    };
  }, [open, googleOk, privateView, ref, r, token]);
  useEffect(() => {
    const d = dialogRef.current;
    if (open && d && !d.open) d.showModal();
  }, [open]);

  const c = commons?.id === ref ? commons.list : undefined;
  const g = google?.id === ref ? google.list : undefined;
  const known = galleryPhotos(item, c, undefined).length;
  const interactive = known > 0 || googleOk;
  if (!thumb && !interactive) return <>{fallback}</>;
  if (!interactive) return <span ref={boxRef} className={`pg-thumb is-static ${className}`}>{thumb}</span>;
  const ready = c !== undefined || !privateView ? (googleOk ? g !== undefined : true) : false;
  const photos = galleryPhotos(item, c, g);
  return (
    <>
      <button type="button" className={`pg-thumb ${className}`} aria-label={`看 ${item.name} 的照片`} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <span ref={boxRef} className="pg-media">
          {thumb ?? <span className="pg-placeholder" aria-hidden="true" />}
        </span>
        <span className="pg-chip" aria-hidden="true">
          <Icon name="image" size={12} /> {known || ""}
          {googleOk ? "+" : ""}
        </span>
      </button>
      {open && (
        <dialog ref={dialogRef} className="pg-sheet" aria-label={`${item.name} 的照片`} onClose={() => setOpen(false)} onClick={(e) => e.target === e.currentTarget && dialogRef.current?.close()}>
          <div className="pg-sheet-body">
            <header>
              <strong>{item.name}</strong>
              <button type="button" className="btn ghost small" onClick={() => dialogRef.current?.close()} aria-label="關閉照片">
                <Icon name="close" size={18} />
              </button>
            </header>
            {ready ? (
              photos.length ? <Carousel photos={photos} label={`${item.name} 的照片`} /> : <p className="small muted">這個景點還沒有照片。</p>
            ) : (
              <div className="pg-loading" role="status" aria-label="載入照片中" />
            )}
          </div>
        </dialog>
      )}
    </>
  );
}
