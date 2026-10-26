"use client";

import { useEffect, useState } from "react";
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
 * FlexCarousel on 2026-10-26, Kai's choice). It mounts only when opened. The front photo's source is a
 * link icon; Google photos keep their authors' names as Google requires.
 */

/**
 * Stack of photo cards (React Bits Stack, fan layout, 230×230): click, Enter or Space sends the front
 * card to the back. The counter and the credit follow the front card.
 */
export function Carousel({ photos, label }: { photos: GalleryPhoto[]; label: string }) {
  const [top, setTop] = useState(0);
  const front = photos[top] ?? photos[0];
  return (
    <div className="gallery">
      <div className="gallery-stack" role="group" aria-label={`${label}：按一下、Enter 或空白鍵換下一張`}>
        <Stack
          key={photos.map((p) => p.src).join("|")}
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
        {front?.credit.authors?.length ? (
          <span className="small">
            {front.credit.authors.map((a, k) => (
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
        {front && (
          <a className="credit-link" href={front.credit.href} target="_blank" rel="noopener noreferrer" aria-label={`圖片來源：${front.credit.label}`} title={front.credit.label}>
            <Icon name="link" size={16} />
          </a>
        )}
      </p>
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
