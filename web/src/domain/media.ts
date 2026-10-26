import type { TripDoc } from "./schema";

/*
 * Private photos (Kai's own) are served by /api/media and need the owner session or the share token.
 * Share-link pages add their token to those URLs; everything else is unchanged.
 */
export function withMediaToken<T extends Pick<TripDoc, "days" | "attractionPool">>(doc: T, token: string): T {
  const fix = (u: string) => (u.startsWith("/api/media/") ? `${u}?token=${encodeURIComponent(token)}` : u);
  const photo = <P extends { url: string; page: string }>(p: P): P => ({ ...p, url: fix(p.url), page: fix(p.page) });
  const item = <I extends { photo?: { url: string; page: string }; gallery?: { url: string; page: string }[] }>(i: I): I => ({
    ...i,
    ...(i.photo ? { photo: photo(i.photo) } : {}),
    ...(i.gallery ? { gallery: i.gallery.map(photo) } : {}),
  });
  return { ...doc, days: doc.days.map((d) => ({ ...d, items: d.items.map(item) })), attractionPool: doc.attractionPool.map((p) => ({ ...p, items: p.items.map(item) })) };
}
