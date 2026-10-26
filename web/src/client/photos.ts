import { api } from "./api";
import type { Photo } from "@/domain/schema";
import type { GoogleShot } from "@/domain/gallery";

/*
 * Gallery photo requests shared by every component (docs/PLAN-2026-10-26-galleries.md): one request
 * per activity for cached Commons photos, and one (owner only) for live Google photos, reused for
 * 20 minutes. The key includes the name and position, so a renamed or moved activity asks again.
 */

type Ref = { id: string; name: string; lat?: number; lng?: number };
const TTL = 20 * 60_000;
const commonsMemo = new Map<string, { at: number; p: Promise<Photo[]> }>();
const googleMemo = new Map<string, { at: number; p: Promise<GoogleShot[]> }>();

const keyOf = (r: Ref, extra = "") => `${r.id}|${r.name}|${r.lat}|${r.lng}|${extra}`;

function cachedCall<T>(memo: Map<string, { at: number; p: Promise<T[]> }>, key: string, run: () => Promise<T[]>): Promise<T[]> {
  const m = memo.get(key);
  if (m && Date.now() - m.at < TTL) return m.p;
  const p = run();
  memo.set(key, { at: Date.now(), p });
  void p.then((v) => !v.length && memo.delete(key)); // empty or failed answers are not kept
  return p;
}

export function commonsFor(r: Ref, token?: string): Promise<Photo[]> {
  const qs = `item=${encodeURIComponent(r.id)}${token ? `&token=${encodeURIComponent(token)}` : ""}`;
  return cachedCall(commonsMemo, keyOf(r, token), () => api<{ commons: Photo[] }>(`/api/photos?${qs}`).then((x) => (x.ok ? x.data.commons : [])));
}

/** Owner only: up to 6 live Google photos (one Place Details + one media call each). */
export function googleFor(r: Ref): Promise<GoogleShot[]> {
  return cachedCall(googleMemo, keyOf(r), () => api<{ photos: GoogleShot[] }>(`/api/place-photos?item=${encodeURIComponent(r.id)}`).then((x) => (x.ok ? x.data.photos : [])));
}
