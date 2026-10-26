import type { Item, TripDoc } from "./schema";
import { isLogistics } from "./day-title";
import { lineAmount } from "./budget";

/*
 * 旅遊規劃小測驗 (Kai, 2026-10-26): plan a one-day Tasmania outing from the home base. Regions are
 * fixed areas around Hobart; places come from the trip's own activities and pool. Pure functions.
 */

export type Region = { key: string; name: string; center: [number, number]; km: number; car: boolean; far?: string };

export const REGIONS: Region[] = [
  { key: "hobart", name: "荷巴特市區", center: [-42.8826, 147.329], km: 5, car: false },
  { key: "kunanyi", name: "kunanyi／威靈頓山", center: [-42.896, 147.237], km: 4, car: true },
  { key: "south", name: "Kingston 與南邊海灘", center: [-42.98, 147.31], km: 9, car: false },
  { key: "richmond", name: "Richmond／Coal Valley", center: [-42.735, 147.44], km: 14, car: true },
  { key: "tasman", name: "塔斯曼半島", center: [-43.08, 147.85], km: 32, car: true },
  { key: "bruny", name: "布魯尼島", center: [-43.3, 147.32], km: 30, car: true },
  { key: "huon", name: "Huon Valley", center: [-43.05, 146.95], km: 28, car: true },
  { key: "mtfield", name: "Mount Field", center: [-42.68, 146.62], km: 16, car: true },
  { key: "maria", name: "瑪麗亞島", center: [-42.6, 148.05], km: 16, car: true },
  { key: "east", name: "東海岸", center: [-42.1, 148.2], km: 55, car: true, far: "單程約 2.5 小時以上，比較適合過夜" },
  { key: "north", name: "朗塞斯頓與北部", center: [-41.4, 147.15], km: 45, car: true, far: "單程約 2.5 小時，比較適合過夜" },
  { key: "northwest", name: "搖籃山與西北", center: [-41.4, 145.9], km: 90, car: true, far: "單程 4 小時以上，請用跨日行程方案" },
];

export function km(a: [number, number], b: [number, number]): number {
  const r = Math.PI / 180;
  const x = (b[1] - a[1]) * r * Math.cos(((a[0] + b[0]) / 2) * r);
  return 6371 * Math.hypot(x, (b[0] - a[0]) * r);
}

export type QuizPlace = { item: Item; region: string; pkg?: string; date?: string };

/** Places to choose from: activities with a position in Tasmania (pool and days), not logistics, stays or work. */
export function quizPlaces(doc: Pick<TripDoc, "days" | "attractionPool">): QuizPlace[] {
  const out = new Map<string, QuizPlace>();
  const add = (item: Item, extra: { pkg?: string; date?: string }) => {
    if (item.lat == null || item.lng == null || item.lat > -40 || item.mode === "flight" || isLogistics(item) || item.name.startsWith("住宿：") || /^Kai 有工作/.test(item.name)) return;
    const near = REGIONS.map((r) => ({ r, d: km(r.center, [item.lat!, item.lng!]) })).filter((x) => x.d <= x.r.km).sort((a, b) => a.d - b.d)[0];
    if (!near || out.has(item.id)) return;
    out.set(item.id, { item, region: near.r.key, ...extra });
  };
  for (const p of doc.attractionPool) for (const i of p.items) add(i, { pkg: p.key });
  for (const d of doc.days) for (const i of d.items) add(i, { date: d.date });
  return [...out.values()];
}

/** Nearest-neighbour order from home (returning home), straight-line distances. */
export function orderStops<T extends { item: { lat?: number; lng?: number } }>(home: [number, number], stops: T[]): T[] {
  const left = [...stops];
  const out: T[] = [];
  let at = home;
  while (left.length) {
    let best = 0;
    left.forEach((s, k) => {
      if (km(at, [s.item.lat!, s.item.lng!]) < km(at, [left[best].item.lat!, left[best].item.lng!])) best = k;
    });
    const [s] = left.splice(best, 1);
    out.push(s);
    at = [s.item.lat!, s.item.lng!];
  }
  return out;
}

/** Rough road minutes from straight-line km (same rule of thumb as the map: ×1.3 at 70 km/h). */
export const driveMinutes = (straightKm: number) => Math.max(5, Math.round((straightKm * 1.3 * 60) / 70 / 5) * 5);

export function quizCost(items: Item[], party: number): number {
  return items.reduce((a, i) => a + (i.cost ? lineAmount(i.cost, party) : 0), 0);
}
