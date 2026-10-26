/*
 * Google Maps navigation links (Kai 2026-10-26: 導航). Plain Maps URLs (no API cost); on phones they open the
 * Google Maps app when installed. Privacy: a residence is never written as an address. When `origin` is
 * omitted Google starts from the viewer's current location.
 */

export type NavPoint = { lat: number; lng: number } | { query: string } | null;
export type NavMode = "driving" | "walking" | "transit";

const fmt = (p: Exclude<NavPoint, null>) => ("query" in p ? p.query : `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`);

/** Google allows up to 9 waypoints between origin and destination in a Maps URL. */
export const MAX_WAYPOINTS = 9;

export function navUrl(origin: NavPoint, destination: Exclude<NavPoint, null>, mode: NavMode, waypoints: Exclude<NavPoint, null>[] = []): string {
  const q = new URLSearchParams({ api: "1" });
  if (origin) q.set("origin", fmt(origin));
  q.set("destination", fmt(destination));
  q.set("travelmode", mode);
  if (waypoints.length) q.set("waypoints", waypoints.slice(0, MAX_WAYPOINTS).map(fmt).join("|"));
  return `https://www.google.com/maps/dir/?${q.toString()}`;
}

/** A whole day as one or more links: each covers at most 11 points and the next starts where it ended. */
export function dayNavUrls(points: Exclude<NavPoint, null>[], mode: NavMode, firstOrigin: NavPoint): string[] {
  if (!points.length) return [];
  const out: string[] = [];
  let origin: NavPoint = firstOrigin;
  let i = 0;
  while (i < points.length) {
    const chunk = points.slice(i, i + MAX_WAYPOINTS + 1);
    const dest = chunk.at(-1)!;
    out.push(navUrl(origin, dest, mode, chunk.slice(0, -1)));
    origin = dest;
    i += chunk.length;
  }
  return out;
}

/** Leg mode from how the stop is reached; flights get no directions (null). */
export const navMode = (mode: string): NavMode | null => (mode === "flight" ? null : mode === "walk" ? "walking" : mode === "drive" ? "driving" : "transit");

/**
 * Whole-day links split where the way of travelling changes (drive to the ferry, then walk on the island):
 * each run of legs with one mode gets its own links. `legs[k]` is the leg into `points[k + 1]`.
 */
export function daySegments(points: Exclude<NavPoint, null>[], modes: (NavMode | null)[], firstOrigin: NavPoint): { mode: NavMode; urls: string[] }[] {
  const out: { mode: NavMode; urls: string[] }[] = [];
  let k = 0;
  let origin: NavPoint = firstOrigin;
  while (k < modes.length) {
    const mode = modes[k];
    let j = k;
    while (j + 1 < modes.length && modes[j + 1] === mode) j++;
    if (mode) out.push({ mode, urls: dayNavUrls(points.slice(k + 1, j + 2), mode, origin) });
    origin = points[j + 1];
    k = j + 1;
  }
  return out;
}
