import type { Photo } from "@/domain/schema";
import { getLookup, putLookup } from "./cache";

/*
 * Wikimedia Commons photos near an activity (docs/PLAN-2026-10-26-galleries.md): freely licensed,
 * CORS-enabled, so they work in the WebGL gallery. Found once by the backfill and kept in
 * lookup_cache ("commons-photos"); page views only read the cache.
 */

const API = "https://commons.wikimedia.org/w/api.php";
const UA = "AyaTripPlanner/1.0 (private trip site; one-off photo lookup)";

type Info = { mime?: string; width?: number; height?: number; thumburl?: string; thumbwidth?: number; thumbheight?: number; descriptionurl?: string; extmetadata?: Record<string, { value?: string }> };

const plain = (html = "") => html.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim().slice(0, 120);

/** Commons geosearch response → Photo list (JPEG/PNG of at least 800px, with artist and licence). */
export function parseCommons(body: unknown, max = 8): Photo[] {
  const pages = Object.values((body as { query?: { pages?: Record<string, { index?: number; imageinfo?: Info[] }> } })?.query?.pages ?? {});
  pages.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const out: Photo[] = [];
  for (const p of pages) {
    const i = p.imageinfo?.[0];
    if (!i?.thumburl?.startsWith("https://") || !i.descriptionurl?.startsWith("https://")) continue;
    if (!/^image\/(jpeg|png)$/.test(i.mime ?? "") || (i.width ?? 0) < 800) continue;
    out.push({
      url: i.thumburl,
      w: i.thumbwidth,
      h: i.thumbheight,
      page: i.descriptionurl,
      site: "commons.wikimedia.org",
      kind: "commons",
      credit: plain(i.extmetadata?.Artist?.value) || undefined,
      license: plain(i.extmetadata?.LicenseShortName?.value).slice(0, 60) || undefined,
    });
    if (out.length >= max) break;
  }
  return out;
}

type Fetch = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

export type CommonsEntry = { name: string; lat: number; lng: number; photos: Photo[] };

/** Cached Commons photos for an activity, searching once (radius 400 m) when missing or moved. */
export async function commonsPhotos(itemId: string, name: string, lat: number, lng: number, opts: { search: boolean; fetch?: Fetch } = { search: false }): Promise<Photo[] | null> {
  const hit = await getLookup<CommonsEntry>("commons-photos", itemId).catch(() => null);
  // A renamed or moved activity searches again; stale photos are never served for it.
  const fresh = hit && hit.value.name === name && hit.value.lat === lat && hit.value.lng === lng;
  if (fresh) return hit.value.photos;
  if (!opts.search) return null;
  const q = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "geosearch",
    ggscoord: `${lat}|${lng}`,
    ggsradius: "400",
    ggsnamespace: "6",
    ggslimit: "20",
    prop: "imageinfo",
    iiprop: "url|extmetadata|size|mime",
    iiurlwidth: "1280",
    iiextmetadatafilter: "Artist|LicenseShortName",
  });
  const f = opts.fetch ?? ((u, i) => fetch(u, i) as unknown as ReturnType<Fetch>);
  const res = await f(`${API}?${q}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error("commons http");
  const photos = parseCommons(await res.json());
  await putLookup("commons-photos", itemId, { name, lat, lng, photos } satisfies CommonsEntry, "Wikimedia Commons geosearch (400 m)", null);
  return photos;
}
