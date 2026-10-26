import type { Day, TripDoc } from "./schema";

/*
 * Where Kai and Aya sleep each night (Kai, 2026-10-26): in Tasmania it is always the home base
 * (UTAS Hobart Apartments, the stay marked `home`) unless a multi-day trip takes them away, i.e. an
 * applied 跨日行程方案 covers the night or the day carries a 「住宿：…」 stay note for its own stay.
 * Derived per night, so applying or clearing a multi-day trip switches it back automatically.
 */

const addDays = (date: string, n: number) => new Date(Date.parse(date + "T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);

export function homeStayKey(doc: Pick<TripDoc, "stays">): string | null {
  return Object.entries(doc.stays).find(([, s]) => (s as { home?: boolean }).home)?.[0] ?? null;
}

export function nightStay(doc: Pick<TripDoc, "stays" | "tripOptions">, day: Pick<Day, "date" | "seg" | "stay" | "items">): string {
  if (day.stay === "none" || day.seg !== "tas") return day.stay;
  const home = homeStayKey(doc);
  if (!home || day.stay === home) return day.stay;
  for (const o of doc.tripOptions ?? []) {
    if (!o.chosen) continue;
    const i = o.days.findIndex((_, k) => addDays(o.start, k) === day.date);
    if (i >= 0) return o.days[i].stay;
  }
  if (day.items.some((it) => it.name.startsWith("住宿：")) && doc.stays[day.stay]) return day.stay;
  return home;
}
