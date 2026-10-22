import type { TripDoc } from "./schema";
import { fmtMD } from "./format";

/* Data for the 3D journey page (PLAN.md 4.11): stops by item id, stats from the current document. */

export type JourneyStop = { itemId: string; name: string; date: string; label: string };
export type JourneyChapter = { key: string; title: string; stops: JourneyStop[] };

type DocLike = Pick<TripDoc, "days" | "segments"> & { journey?: TripDoc["journey"] };

export function journeyChapters(doc: DocLike): JourneyChapter[] {
  const where = new Map<string, { name: string; date: string }>();
  doc.days.forEach((d) => d.items.forEach((i) => where.set(i.id, { name: i.name, date: d.date })));
  return (doc.journey?.chapters ?? []).map((c) => ({
    key: c.key,
    title: c.title,
    stops: c.itemIds
      .filter((id) => where.has(id))
      .map((id) => ({ itemId: id, ...where.get(id)!, label: fmtMD(where.get(id)!.date) }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  }));
}

export function journeyStats(doc: DocLike) {
  const items = doc.days.flatMap((d) => d.items);
  const segOrder: string[] = [];
  doc.days.forEach((d) => {
    if (!segOrder.includes(d.seg)) segOrder.push(d.seg);
  });
  return {
    days: doc.days.length,
    destinations: segOrder.length,
    must: items.filter((i) => i.pri === "must" && i.major).length,
    majors: items.filter((i) => i.major).length,
    segOrder: segOrder.map((k) => doc.segments[k]?.name ?? k),
  };
}

export function heroLead(doc: DocLike): string {
  const s = journeyStats(doc);
  const route = s.segOrder.length > 1 ? `先到${s.segOrder[0]}，再往${s.segOrder.slice(1).join("、")}` : `在${s.segOrder[0] ?? "澳洲"}`;
  return `${s.days} 天的旅程：${route}，從港灣走到山與湖的深處。`;
}

/** True when each non-empty chapter ends on or before the next non-empty chapter starts. */
export function chaptersChronological(chapters: JourneyChapter[]): boolean {
  const ne = chapters.filter((c) => c.stops.length);
  for (let i = 1; i < ne.length; i++) if (ne[i - 1].stops.at(-1)!.date > ne[i].stops[0].date) return false;
  return true;
}
