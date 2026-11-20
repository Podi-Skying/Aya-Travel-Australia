"use client";

import { useCallback, useEffect, useState } from "react";
import type { DayPhoto } from "@/components/Photos";
import { fmtDay } from "@/domain/format";
import type { Photo, TripDoc } from "@/domain/schema";

/*
 * Kai's own photos on the client (docs/PHOTOS-PLAN.md). Pages pass `access` from the server; without it
 * nothing is fetched, so guests never ask for (or learn about) private photos.
 */

export type PhotoAccessKind = "owner" | "viewer";

export type MyPhoto = { id: string; w: number; h: number; dayDate: string | null; itemId: string | null; takenLocal: string | null; caption: string | null; category: string | null; lat?: number | null; lng?: number | null; fileName?: string; manual?: boolean };

export type MyPhotosData = { configured: boolean; photos: MyPhoto[]; usedBytes?: number; quotaBytes?: number; viewersEnabled?: boolean };

export const thumbUrl = (id: string) => `/api/my-photos/${id}/thumb`;
export const fullUrl = (id: string) => `/api/my-photos/${id}/full`;

export function useMyPhotos(access: PhotoAccessKind | null | undefined) {
  const [data, setData] = useState<MyPhotosData | null>(null);
  const [error, setError] = useState(false);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    if (!access) return;
    let live = true;
    fetch("/api/my-photos", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<MyPhotosData>) : Promise.reject(new Error(String(r.status)))))
      .then((d) => live && (setData(d), setError(false)))
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [access, tick]);
  return { data, error, reload, setData };
}

/** Photos of one day, in time order (photos without a time last). */
export function photosOfDay(photos: MyPhoto[], date: string): MyPhoto[] {
  return photos.filter((p) => p.dayDate === date).sort((a, b) => (a.takenLocal ?? "~").localeCompare(b.takenLocal ?? "~"));
}

/** The shape the shared viewer expects; the caption takes the credit line's place. */
export function viewerPhotos(list: MyPhoto[], nameOf: (p: MyPhoto) => string): DayPhoto[] {
  return list.map((p) => ({ id: `my-${p.id}`, name: nameOf(p), photo: { url: fullUrl(p.id), page: fullUrl(p.id), w: p.w, h: p.h, site: p.caption ?? "", kind: "custom" } as Photo }));
}

export function itemName(doc: Pick<TripDoc, "days">, p: MyPhoto): string {
  const day = doc.days.find((d) => d.date === p.dayDate);
  const it = day?.items.find((i) => i.id === p.itemId);
  return it?.name ?? (p.dayDate ? fmtDay(p.dayDate) : "未分類");
}
