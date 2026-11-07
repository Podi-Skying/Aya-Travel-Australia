import { listLookups } from "./cache";
import { sameRef, type PlaceRef } from "./google";
import { isStayItem } from "@/domain/privacy";
import type { HoursInfo } from "@/domain/hours";
import type { TripDoc } from "@/domain/schema";

type Doc = Pick<TripDoc, "days" | "attractionPool" | "stays">;

/**
 * Cached opening hours for the activities in a document, by activity id. Cache only: never calls Google.
 * Guests get no hours for the places where they sleep, and only places matched at the shown position.
 */
export async function hoursForDoc(doc: Doc, owner: boolean, now = new Date()): Promise<Record<string, HoursInfo>> {
  const refs = new Map((await listLookups("place-id")).map((r) => [r.key, r.value as PlaceRef]));
  const hours = new Map((await listLookups("place-hours")).filter((r) => !r.expiresAt || r.expiresAt > now).map((r) => [r.key, r.value as HoursInfo]));
  const out: Record<string, HoursInfo> = {};
  for (const it of [...doc.days.flatMap((d) => d.items), ...doc.attractionPool.flatMap((p) => p.items)]) {
    const ref = refs.get(it.id);
    if (!ref?.placeId || it.lat == null || it.lng == null || (!owner && isStayItem(it, doc))) continue;
    // Guests see redacted names, so only the position is compared for them.
    if (!sameRef(ref, owner ? it.name : (ref.name ?? ""), it.lat, it.lng)) continue;
    const h = hours.get(ref.placeId);
    if (h && (h.week?.length || h.periods?.length || h.status)) out[it.id] = { week: h.week ?? [], periods: h.periods ?? [], ...(h.status ? { status: h.status } : {}) };
  }
  return out;
}
