"use client";

import { useEffect, useState, type ReactNode } from "react";
import { googleFor } from "@/client/photos";
import { useTrip } from "./TripApp";

/*
 * Google place photo for an activity without its own photo (owner and share links; docs/PLAN-2026-10-26-google.md).
 * It shares one request per activity with the gallery (client/photos.ts), and shows the attribution
 * Google requires: the photo's authors and a Google Maps link.
 */

type Ref = { id: string; name: string; lat?: number; lng?: number };

export function GooglePhoto({ item, alt, className, bare = false, fallback = null }: { item: Ref; alt: string; className?: string; bare?: boolean; fallback?: ReactNode }) {
  const key = `${item.id}|${item.name}|${item.lat}|${item.lng}`;
  const [g, setG] = useState<{ key: string; v: Awaited<ReturnType<typeof googleFor>>[number] | null } | null>(null);
  const [broken, setBroken] = useState(false);
  const { token } = useTrip();
  useEffect(() => {
    let live = true;
    void googleFor({ id: item.id, name: item.name, lat: item.lat, lng: item.lng }, token).then((v) => live && setG({ key, v: v[0] ?? null }));
    return () => {
      live = false;
    };
  }, [key, item.id, item.name, item.lat, item.lng, token]);
  const v = g?.key === key ? g.v : null;
  if (!v || broken) return <>{fallback}</>;
  // Inside a gallery button: the opened gallery shows the full attribution, which Google allows for thumbnails.
  // eslint-disable-next-line @next/next/no-img-element -- Google photo media URI, resolved per view
  if (bare) return <img className={className} src={v.photoUri} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
  return (
    <figure className={`g-photo ${className ?? ""}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- Google photo media URI, resolved per view */}
      <img src={v.photoUri} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
      <figcaption>
        照片：
        {v.attributions.length
          ? v.attributions.map((a, i) => (
              <span key={i}>
                {i ? "、" : ""}
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
        <a href={v.mapsUri} target="_blank" rel="noopener noreferrer">
          Google 地圖
        </a>
      </figcaption>
    </figure>
  );
}
