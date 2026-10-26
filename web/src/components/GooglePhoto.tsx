"use client";

import { useEffect, useState } from "react";
import { api } from "@/client/api";

/*
 * Google place photo for an activity without its own photo (owner only; docs/PLAN-2026-10-26-google.md).
 * The server resolves it live (photo names may not be cached) and the attribution Google requires is
 * shown under it: the photo's authors and a Google Maps link.
 */
type G = { photoUri: string; attributions: { name: string; uri?: string }[]; mapsUri: string };

/** Photo URIs are temporary: answers are reused for 25 minutes, failures are not kept. */
const memo = new Map<string, { at: number; p: Promise<G | null> }>();
const TTL = 25 * 60_000;

export function GooglePhoto({ itemId, alt, className }: { itemId: string; alt: string; className?: string }) {
  const [g, setG] = useState<{ id: string; v: G | null } | null>(null);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    let live = true;
    const m = memo.get(itemId);
    let p = m && Date.now() - m.at < TTL ? m.p : undefined;
    if (!p) {
      p = api<G>(`/api/place-photo?item=${encodeURIComponent(itemId)}`).then((r) => (r.ok ? r.data : null));
      memo.set(itemId, { at: Date.now(), p });
      void p.then((v) => !v && memo.delete(itemId));
    }
    void p.then((v) => live && setG({ id: itemId, v }));
    return () => {
      live = false;
    };
  }, [itemId]);
  const v = g?.id === itemId ? g.v : null;
  if (!v || broken) return null;
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
