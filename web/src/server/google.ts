import { getLookup, putLookup } from "./cache";
import { noteGoogleHit, takeGoogleCall, type GoogleApi, type GoogleScope } from "./usage";

/*
 * Google Maps Platform, server side only (docs/PLAN-2026-10-26-google.md). The key comes from
 * GOOGLE_MAPS_API_KEY (alias GOOGLE_PLACES_API_KEY); it is never sent to the browser and never
 * appears in image URLs. Every call is logged in google_usage and refused past the daily cap.
 *
 * Terms (checked 2026-10-26): place IDs may be stored indefinitely; photo names must not be
 * cached, so photos are resolved live (Place Details → photo media) and shown with the author
 * attributions and a Google Maps link. Route results are kept for at most 30 days.
 */

export function googleKey(): string | null {
  return process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY || null;
}

export type GFetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
const defaultFetch: GFetch = (url, init) => (fetch as unknown as GFetch)(url, init);

async function call<T>(api: GoogleApi, url: string, init: Parameters<GFetch>[1], f: GFetch, scope: GoogleScope = "owner"): Promise<T> {
  if (!(await takeGoogleCall(api, new Date(), scope))) throw new Error("google quota");
  const res = await f(url, { ...init, signal: AbortSignal.timeout(8_000) });
  if (!res.ok) throw new Error(`google http ${res.status}`);
  return (await res.json()) as T;
}

/* ---------------------------------------------------------------- Places */

export type PlaceRef = { placeId: string | null; name?: string; lat?: number; lng?: number; checked?: boolean; googleName?: string; km?: number };
const round4 = (n: number) => Math.round(n * 1e4) / 1e4;
/** The stored mapping still describes this activity (same name and position, to ~10 m) and was location-checked. */
export const sameRef = (r: PlaceRef, name: string, lat?: number, lng?: number) => !!r.checked && r.name === name && lat != null && lng != null && r.lat === round4(lat) && r.lng === round4(lng);

/** A Google match must lie within this distance of the activity; farther ones stay unmapped for review. */
export const MATCH_KM = 1.5;
const kmBetween = (a: [number, number], b: [number, number]) => {
  const r = Math.PI / 180;
  const x = (b[1] - a[1]) * r * Math.cos(((a[0] + b[0]) / 2) * r);
  return 6371 * Math.hypot(x, (b[0] - a[0]) * r);
};

/**
 * Finds the Google place id for an activity and stores it; null if none. The search returns the
 * place's location too (Text Search Pro, within the free monthly calls) so a match farther than
 * MATCH_KM from the activity is not used.
 */
export async function findPlaceId(itemId: string, name: string, lat: number, lng: number, f: GFetch = defaultFetch): Promise<string | null> {
  const hit = await getLookup<PlaceRef>("place-id", itemId).catch(() => null);
  // A renamed or moved activity is looked up again, so its photo is never another place's.
  if (hit && sameRef(hit.value, name, lat, lng)) {
    await noteGoogleHit("places_search");
    return hit.value.placeId;
  }
  const key = googleKey();
  if (!key) return null;
  const body = await call<{ places?: { id?: string; location?: { latitude?: number; longitude?: number }; displayName?: { text?: string } }[] }>(
    "places_search",
    "https://places.googleapis.com/v1/places:searchText",
    {
      method: "POST",
      headers: { "content-type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": "places.id,places.location,places.displayName" },
      body: JSON.stringify({ textQuery: name, maxResultCount: 1, locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: 2000 } } }),
    },
    f,
  );
  const top = body.places?.[0];
  const loc = top?.location;
  const km = loc?.latitude != null && loc.longitude != null ? Math.round(kmBetween([lat, lng], [loc.latitude, loc.longitude]) * 100) / 100 : undefined;
  const placeId = top?.id && km != null && km <= MATCH_KM ? top.id : null;
  await putLookup("place-id", itemId, { placeId, name, lat: round4(lat), lng: round4(lng), checked: true, googleName: top?.displayName?.text?.slice(0, 120), km } satisfies PlaceRef, "Google Places Text Search (location-checked)", null);
  return placeId;
}

/** Google returns some links protocol-relative (`//maps.google.com/...`); show them as https. */
const httpsUri = (u?: string) => (u?.startsWith("//") ? `https:${u}` : u?.startsWith("https://") ? u : undefined);

export type PlacePhoto = { photoUri: string; attributions: { name: string; uri?: string }[]; mapsUri: string };

/** A live photo for a place: Place Details (photos) then the photo media URI. Not cached server side. */
export async function placePhoto(placeId: string, maxWidthPx = 1200, f: GFetch = defaultFetch): Promise<PlacePhoto | null> {
  return (await placePhotos(placeId, 1, maxWidthPx, f))[0] ?? null;
}

/** Up to `n` live photos for a place: one Place Details call plus one media call per photo. */
type PhotoRefs = { photos?: { name: string; googleMapsUri?: string; authorAttributions?: { displayName?: string; uri?: string }[] }[] };
/** Photo references (names and authors, never image bytes) are kept a few days so a gallery skips Place Details. */
const REFS_TTL_MS = 3 * 24 * 3600_000;

export async function placePhotos(placeId: string, n: number, maxWidthPx = 1200, f: GFetch = defaultFetch, scope: GoogleScope = "owner"): Promise<PlacePhoto[]> {
  const key = googleKey();
  if (!key || !/^[A-Za-z0-9_-]{10,300}$/.test(placeId)) return [];
  // Field mask `photos` only (Essentials); each photo carries its own Google Maps link.
  const cached = await getLookup<PhotoRefs>("place-photo-refs", placeId).catch(() => null);
  const det =
    cached?.value ??
    (await call<PhotoRefs>("place_details", `https://places.googleapis.com/v1/places/${placeId}`, { headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": "photos" } }, f, scope));
  if (cached) await noteGoogleHit("place_details");
  else await putLookup("place-photo-refs", placeId, { photos: (det.photos ?? []).slice(0, 10) }, "Google Place Details (photo names only)", REFS_TTL_MS).catch(() => {});
  const out: PlacePhoto[] = [];
  for (const p of (det.photos ?? []).slice(0, n)) {
    if (!p?.name) continue;
    const media = await call<{ photoUri?: string }>(
      "place_photo",
      `https://places.googleapis.com/v1/${p.name}/media?maxWidthPx=${maxWidthPx}&skipHttpRedirect=true`,
      { headers: { "X-Goog-Api-Key": key } },
      f,
      scope,
    ).catch(() => null);
    if (!media?.photoUri?.startsWith("https://")) continue;
    out.push({
      photoUri: media.photoUri,
      attributions: (p.authorAttributions ?? []).filter((a) => a.displayName).map((a) => ({ name: a.displayName!, uri: httpsUri(a.uri) })),
      // Users must always be able to open the photo on Google Maps; fall back to the place's page.
      mapsUri: httpsUri(p.googleMapsUri) ?? `https://www.google.com/maps/place/?q=place_id:${placeId}`,
    });
  }
  return out;
}

/* ---------------------------------------------------------------- Routes */

type Pt = [number, number];

/** Google encoded polyline → [lat, lng][] (5 decimals). */
export function decodePolyline(s: string): Pt[] {
  const out: Pt[] = [];
  let i = 0,
    lat = 0,
    lng = 0;
  while (i < s.length) {
    for (const which of [0, 1]) {
      let shift = 0,
        result = 0,
        b: number;
      do {
        b = s.charCodeAt(i++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20 && i < s.length);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += d;
      else lng += d;
    }
    out.push([lat / 1e5, lng / 1e5]);
  }
  return out;
}

export type TravelMode = "driving" | "walking" | "transit";
const G_MODE: Record<TravelMode, string> = { driving: "DRIVE", walking: "WALK", transit: "TRANSIT" };

/**
 * Legs for consecutive points via Routes API computeRoutes (one call per point list). Walking and transit
 * legs (Kai 2026-10-27: every leg follows the real way) are asked one pair at a time: transit takes no
 * intermediate stops.
 */
export async function googleLegs(points: Pt[], f: GFetch = defaultFetch, travel: TravelMode = "driving"): Promise<{ distanceM: number; durationS: number; geometry: Pt[]; source: string }[]> {
  if (travel !== "driving" && points.length > 2) {
    const out = [];
    for (let k = 1; k < points.length; k++) out.push(...(await googleLegs([points[k - 1], points[k]], f, travel)));
    return out;
  }
  const key = googleKey();
  if (!key) throw new Error("no google key");
  const wp = (p: Pt) => ({ location: { latLng: { latitude: p[0], longitude: p[1] } } });
  const body = await call<{ routes?: { legs?: { distanceMeters?: number; duration?: string; polyline?: { encodedPolyline?: string } }[] }[] }>(
    "routes",
    "https://routes.googleapis.com/directions/v2:computeRoutes",
    {
      method: "POST",
      headers: { "content-type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": "routes.legs.distanceMeters,routes.legs.duration,routes.legs.polyline.encodedPolyline" },
      body: JSON.stringify({ origin: wp(points[0]), destination: wp(points.at(-1)!), ...(travel === "driving" ? { intermediates: points.slice(1, -1).map(wp) } : {}), travelMode: G_MODE[travel] }),
    },
    f,
  );
  const legs = body.routes?.[0]?.legs;
  if (!legs || legs.length !== points.length - 1) throw new Error("google routes body");
  return legs.map((l) => ({
    distanceM: Math.round(l.distanceMeters ?? 0),
    durationS: Math.round(Number(String(l.duration ?? "0s").replace(/s$/, "")) || 0),
    geometry: l.polyline?.encodedPolyline ? decodePolyline(l.polyline.encodedPolyline) : [],
    source: travel === "driving" ? "google-routes" : `google-routes-${travel}`,
  }));
}

/** Route rows from Google are treated as missing after 30 days (Maps Platform caching limits). */
export const GOOGLE_ROUTE_TTL_MS = 30 * 86_400_000;
