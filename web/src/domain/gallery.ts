import type { Item, Photo } from "./schema";

/*
 * Photos for one activity's gallery (docs/PLAN-2026-10-26-galleries.md), in order: its own photo,
 * owner-supplied gallery photos, cached Wikimedia Commons photos, then live Google photos (owner).
 * Duplicates (same URL) are dropped.
 */

export type GoogleShot = { photoUri: string; attributions: { name: string; uri?: string }[]; mapsUri: string };
export type GalleryPhoto = { src: string; alt: string; title: string; subtitle?: string; credit: { label: string; href: string; authors?: { name: string; uri?: string }[] } };

export function galleryPhotos(item: Pick<Item, "name" | "photo" | "gallery">, commons: Photo[] = [], google: GoogleShot[] = []): GalleryPhoto[] {
  const out: GalleryPhoto[] = [];
  const seen = new Set<string>();
  const add = (g: GalleryPhoto) => {
    if (seen.has(g.src)) return;
    seen.add(g.src);
    out.push(g);
  };
  for (const p of [item.photo, ...(item.gallery ?? []), ...commons].filter((x): x is Photo => !!x))
    add({ src: p.url, alt: item.name, title: item.name, subtitle: p.credit ? `${p.credit}${p.license ? `・${p.license}` : ""}` : p.site, credit: { label: [p.site, p.credit, p.license].filter(Boolean).join("・"), href: p.page } });
  for (const g of google)
    add({ src: g.photoUri, alt: item.name, title: item.name, subtitle: g.attributions.map((a) => a.name).join("、") || "Google 地圖", credit: { label: "Google 地圖", href: g.mapsUri, authors: g.attributions } });
  return out;
}
