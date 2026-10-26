import type { TripDoc } from "./schema";
import { nightStay } from "./stay";

/*
 * Stays to mark on the map (Kai, 2026-10-26): the home base and any other stay used for a night.
 * Positions exist only in the owner document (exact) and share links (≈300 m); public visitors have none.
 */
export type StayPin = { key: string; name: string; lat: number; lng: number; home: boolean };

type Stay = { name: string; lat?: number; lng?: number; home?: boolean };

export function stayPin(doc: Pick<TripDoc, "stays">, key: string): StayPin | null {
  const s = doc.stays[key] as Stay | undefined;
  return s && s.lat != null && s.lng != null ? { key, name: s.home ? "住處" : s.name, lat: s.lat, lng: s.lng, home: !!s.home } : null;
}

/** Every stay that is some night's stay (plus the home base), once each. */
export function stayPins(doc: Pick<TripDoc, "stays" | "days" | "tripOptions">): StayPin[] {
  const keys = new Set(doc.days.map((d) => nightStay(doc, d)));
  for (const [k, s] of Object.entries(doc.stays)) if ((s as Stay).home) keys.add(k);
  return [...keys].map((k) => stayPin(doc, k)).filter((p): p is StayPin => !!p);
}

/** Where a day starts (the previous night's stay) and ends (this night's stay). */
export function dayEnds(doc: Pick<TripDoc, "stays" | "days" | "tripOptions">, date: string): { start: StayPin | null; end: StayPin | null } {
  const i = doc.days.findIndex((d) => d.date === date);
  if (i < 0) return { start: null, end: null };
  const end = stayPin(doc, nightStay(doc, doc.days[i]));
  const start = i > 0 ? stayPin(doc, nightStay(doc, doc.days[i - 1])) : null;
  return { start, end };
}

export const HOUSE_SVG =
  '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 11.5 12 4.5l8 7M6.5 9.8V19.5h11V9.8M10 19.5v-5h4v5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
