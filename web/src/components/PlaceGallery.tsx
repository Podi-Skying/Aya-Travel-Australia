"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useTrip } from "./TripApp";
import { Icon } from "./Icon";
import { commonsFor, googleFor } from "@/client/photos";
import {
  galleryPhotos,
  type GalleryPhoto,
  type GoogleShot,
} from "@/domain/gallery";
import type { Item, Photo } from "@/domain/schema";
import FlexCarousel from "./flex-carousel/FlexCarousel";

/*
 * Photo gallery for an activity (docs/PLAN-2026-10-26-galleries.md) with React Bits FlexCarousel in
 * Kai's configuration. It mounts only when opened (each one is a WebGL canvas). Every photo's source
 * is a link icon below; Google photos keep their authors' names as Google requires.
 */

/** FlexCarousel needs WebGL2; without it the gallery is a plain scrolling strip. */
let webgl2: boolean | null = null;
const hasWebGL2 = () =>
  (webgl2 ??= !!document.createElement("canvas").getContext("webgl2"));

export function Carousel({
  photos,
  label,
}: {
  photos: GalleryPhoto[];
  label: string;
}) {
  const gl = useSyncExternalStore(
    () => () => {},
    hasWebGL2,
    () => true,
  );
  return (
    <div className="gallery">
      {!gl ? (
        <ul className="gallery-strip" aria-label={label} role="region" tabIndex={0}>
          {photos.map((p) => (
            <li key={p.src}>
              {/* eslint-disable-next-line @next/next/no-img-element -- photos from several hosts */}
              <img
                src={p.src}
                alt={p.alt}
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            </li>
          ))}
        </ul>
      ) : (
        <div className="gallery-stage" role="group" aria-label={label}>
          <FlexCarousel
            key={photos.map((p) => p.src).join("|")}
            items={photos.map(({ src, alt, title, subtitle }) => ({
              src,
              alt,
              title,
              subtitle,
            }))}
            preset="liquid"
            intro="rise"
            cardHeight={0.5}
            gap={12}
            squeeze={0.2}
            focusOnClick
            captions
          />
        </div>
      )}
      <ol className="gallery-credits">
        {photos.map((p, i) => (
          <li key={p.src}>
            <span className="small muted">{i + 1}</span>
            {p.credit.authors?.length ? (
              <span className="small">
                {p.credit.authors.map((a, k) => (
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
                ))}
              </span>
            ) : null}
            <a
              className="credit-link"
              href={p.credit.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`第 ${i + 1} 張圖片來源：${p.credit.label}`}
              title={p.credit.label}
            >
              <Icon name="link" size={16} />
            </a>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** 「看照片」 button that opens the activity's gallery. */
export function PlaceGallery({ item }: { item: Item }) {
  const { mode, token } = useTrip();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{
    id: string;
    commons: Photo[];
    google: GoogleShot[];
  } | null>(null);
  const owner = mode === "owner";
  // Name and position are part of the key: a renamed or moved activity asks the server again.
  const ref = `${item.id}|${item.name}|${item.lat}|${item.lng}`;
  useEffect(() => {
    if (!open) return;
    let live = true;
    const r = { id: item.id, name: item.name, lat: item.lat, lng: item.lng };
    void Promise.all([commonsFor(r, token), owner || token ? googleFor(r, token) : Promise.resolve([])]).then(([commons, google]) => live && setData({ id: ref, commons, google }));
    return () => {
      live = false;
    };
  }, [open, ref, item.id, item.name, item.lat, item.lng, owner, token]);
  const ready = data?.id === ref ? data : null;
  const photos = galleryPhotos(item, ready?.commons, ready?.google);
  return (
    <div className="place-gallery">
      <button
        type="button"
        className="btn ghost small"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon name="image" size={16} /> {open ? "收起照片" : "看照片"}
      </button>
      {open &&
        (ready ? (
          photos.length ? (
            <Carousel photos={photos} label={`${item.name} 的照片`} />
          ) : (
            <p className="small muted">這個景點還沒有照片。</p>
          )
        ) : (
          <p className="small muted">載入照片中…</p>
        ))}
    </div>
  );
}
