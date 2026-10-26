import { getLookup, putLookup } from "./cache";
import { noteGoogleHit, takeGoogleCall, type GoogleApi } from "./usage";

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

async function call<T>(api: GoogleApi, url: string, init: Parameters<GFetch>[1], f: GFetch): Promise<T> {
  if (!(await takeGoogleCall(api))) throw new Error("google quota");
  const res = await f(url, { ...init, signal: AbortSignal.timeout(8_000) });
  if (!res.ok) throw new Error(`google http ${res.status}`);
  return (await res.json()) as T;
}

/* ---------------------------------------------------------------- Places */

/** Finds the Google place id for an activity (IDs-only Text Search) and stores it; null if none. */
export async function findPlaceId(itemId: string, name: string, lat: number, lng: number, f: GFetch = defaultFetch): Promise<string | null> {
  const hit = await getLookup<{ placeId: string | null; name?: string }>("place-id", itemId).catch(() => null);
  // A renamed activity is looked up again, so its photo is never another place's.
  if (hit && hit.value.name === name) {
    await noteGoogleHit("places_search");
    return hit.value.placeId;
  }
  const key = googleKey();
  if (!key) return null;
  const body = await call<{ places?: { id?: string }[] }>(
    "places_search",
    "https://places.googleapis.com/v1/places:searchText",
    {
      method: "POST",
      headers: { "content-type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": "places.id" },
      body: JSON.stringify({ textQuery: name, maxResultCount: 1, locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: 2000 } } }),
    },
    f,
  );
  const placeId = body.places?.[0]?.id ?? null;
  await putLookup("place-id", itemId, { placeId, name }, "Google Places Text Search (IDs only)", null);
  return placeId;
}

/** Google returns some links protocol-relative (`//maps.google.com/...`); show them as https. */
const httpsUri = (u?: string) => (u?.startsWith("//") ? `https:${u}` : u?.startsWith("https://") ? u : undefined);

export type PlacePhoto = { photoUri: string; attributions: { name: string; uri?: string }[]; mapsUri?: string };

/** A live photo for a place: Place Details (photos) then the photo media URI. Not cached server side. */
export async function placePhoto(placeId: string, maxWidthPx = 1200, f: GFetch = defaultFetch): Promise<PlacePhoto | null> {
  const key = googleKey();
  if (!key || !/^[A-Za-z0-9_-]{10,300}$/.test(placeId)) return null;
  // Field mask `photos` only (Essentials); each photo carries its own Google Maps link.
  const det = await call<{ photos?: { name: string; googleMapsUri?: string; authorAttributions?: { displayName?: string; uri?: string }[] }[] }>(
    "place_details",
    `https://places.googleapis.com/v1/places/${placeId}`,
    { headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": "photos" } },
    f,
  );
  const p = det.photos?.[0];
  if (!p?.name) return null;
  const media = await call<{ photoUri?: string }>(
    "place_photo",
    `https://places.googleapis.com/v1/${p.name}/media?maxWidthPx=${maxWidthPx}&skipHttpRedirect=true`,
    { headers: { "X-Goog-Api-Key": key } },
    f,
  );
  if (!media.photoUri?.startsWith("https://")) return null;
  return {
    photoUri: media.photoUri,
    attributions: (p.authorAttributions ?? []).filter((a) => a.displayName).map((a) => ({ name: a.displayName!, uri: httpsUri(a.uri) })),
    mapsUri: httpsUri(p.googleMapsUri),
  };
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

/** Driving legs for consecutive points via Routes API computeRoutes (one call per point list). */
export async function googleLegs(points: Pt[], f: GFetch = defaultFetch): Promise<{ distanceM: number; durationS: number; geometry: Pt[]; source: string }[]> {
  const key = googleKey();
  if (!key) throw new Error("no google key");
  const wp = (p: Pt) => ({ location: { latLng: { latitude: p[0], longitude: p[1] } } });
  const body = await call<{ routes?: { legs?: { distanceMeters?: number; duration?: string; polyline?: { encodedPolyline?: string } }[] }[] }>(
    "routes",
    "https://routes.googleapis.com/directions/v2:computeRoutes",
    {
      method: "POST",
      headers: { "content-type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": "routes.legs.distanceMeters,routes.legs.duration,routes.legs.polyline.encodedPolyline" },
      body: JSON.stringify({ origin: wp(points[0]), destination: wp(points.at(-1)!), intermediates: points.slice(1, -1).map(wp), travelMode: "DRIVE" }),
    },
    f,
  );
  const legs = body.routes?.[0]?.legs;
  if (!legs || legs.length !== points.length - 1) throw new Error("google routes body");
  return legs.map((l) => ({
    distanceM: Math.round(l.distanceMeters ?? 0),
    durationS: Math.round(Number(String(l.duration ?? "0s").replace(/s$/, "")) || 0),
    geometry: l.polyline?.encodedPolyline ? decodePolyline(l.polyline.encodedPolyline) : [],
    source: "google-routes",
  }));
}

/** Route rows from Google are treated as missing after 30 days (Maps Platform caching limits). */
export const GOOGLE_ROUTE_TTL_MS = 30 * 86_400_000;
