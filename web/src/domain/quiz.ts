import type { Item, TripDoc } from "./schema";
import { isLogistics } from "./day-title";
import { lineAmount } from "./budget";

/*
 * 旅遊規劃小測驗 (Kai, 2026-10-26): plan a one-day Tasmania outing from the home base. Regions are
 * fixed areas around Hobart; places come from the trip's own activities and pool. Pure functions.
 */

export type Area = { center: [number, number]; km: number };
export type Region = { key: string; name: string; areas: Area[]; car: boolean; far?: string; note?: string };

const area = (center: [number, number], km: number): Area[] => [{ center, km }];

export const REGIONS: Region[] = [
  // 荷巴特 covers the city, kunanyi／威靈頓山 and MONA with the northern suburbs (Kai 2026-10-26).
  {
    key: "hobart",
    name: "荷巴特",
    areas: [
      { center: [-42.8826, 147.329], km: 5 },
      { center: [-42.896, 147.237], km: 4 },
      { center: [-42.825, 147.27], km: 7 },
    ],
    car: false,
    note: "威靈頓山可搭接駁車或開車",
  },
  { key: "south", name: "Kingston 與南邊海灘", areas: area([-42.98, 147.31], 9), car: false },
  { key: "richmond", name: "Richmond／Coal Valley", areas: area([-42.735, 147.44], 14), car: true },
  { key: "tasman", name: "塔斯曼半島", areas: area([-43.08, 147.85], 32), car: true },
  { key: "bruny", name: "布魯尼島", areas: area([-43.3, 147.32], 30), car: true },
  // Huon Valley reaches down to Hastings Caves and the thermal springs (Kai 2026-10-27).
  {
    key: "huon",
    name: "Huon Valley",
    areas: [
      { center: [-43.05, 146.95], km: 28 },
      { center: [-43.41, 146.86], km: 10 },
    ],
    car: true,
  },
  { key: "mtfield", name: "Mount Field", areas: area([-42.68, 146.62], 16), car: true },
  // 東海岸 includes 瑪麗亞島 (Kai 2026-10-27): they make one overnight trip together.
  {
    key: "east",
    name: "東海岸與瑪麗亞島",
    // …and the north-east: Bay of Fires, The Gardens, St Helens and Little Blue Lake (Kai 2026-10-30).
    areas: [
      { center: [-42.1, 148.2], km: 55 },
      { center: [-42.6, 148.05], km: 16 },
      { center: [-41.2, 148.12], km: 30 },
    ],
    car: true,
    far: "單程約 2.5 小時以上，比較適合過夜；瑪麗亞島可以排在去東海岸的路上",
  },
  { key: "north", name: "朗塞斯頓與北部", areas: area([-41.4, 147.15], 45), car: true, far: "單程約 2.5 小時，比較適合過夜" },
  { key: "northwest", name: "搖籃山與西北", areas: area([-41.4, 145.9], 90), car: true, far: "單程 4 小時以上，請用行程方案" },
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
    const near = REGIONS.flatMap((r) => r.areas.map((a) => ({ r, a, d: km(a.center, [item.lat!, item.lng!]) })))
      .filter((x) => x.d <= x.a.km)
      .sort((a, b) => a.d - b.d)[0];
    // A place copied into a day (an applied plan) is the same place as its pool entry: list it once.
    if (!near || out.has(item.id) || [...out.values()].some((q) => q.item.name === item.name)) return;
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

/* Long drives (Kai 2026-10-26): more than 3 hours one way from home asks whether to stay overnight. */
export const LONG_DRIVE_MIN = 180;
export const LONG_DAY_DRIVE_MIN = 360;

export const minutesFrom = (from: [number, number], item: { lat?: number; lng?: number }) => driveMinutes(km(from, [item.lat!, item.lng!]));

/** Towns to suggest for a night when no stay of the trip is near (positions are town centres). */
export const OVERNIGHT_TOWNS: { name: string; at: [number, number] }[] = [
  { name: "朗塞斯頓 Launceston", at: [-41.4388, 147.1347] },
  { name: "Bicheno", at: [-41.874, 148.302] },
  { name: "St Helens", at: [-41.32, 148.24] },
  { name: "Swansea", at: [-42.123, 148.074] },
  { name: "Coles Bay", at: [-42.124, 148.287] },
  { name: "搖籃山 Cradle Mountain", at: [-41.596, 145.93] },
  { name: "Stanley", at: [-40.76, 145.295] },
  { name: "Devonport", at: [-41.18, 146.35] },
  { name: "Burnie", at: [-41.055, 145.905] },
  { name: "Strahan", at: [-42.153, 145.327] },
  { name: "Deloraine", at: [-41.524, 146.656] },
];

export type Overnight = { name: string; lat: number; lng: number; stayKey?: string; needsBooking: boolean };

/** Where to sleep near a place: a stay of the trip within 30 km, else the nearest listed town (stay to be found). */
export function overnightNear(doc: Pick<TripDoc, "stays">, near: [number, number]): Overnight {
  const stays = Object.entries(doc.stays)
    .filter(([, s]) => !s.home && s.lat != null && s.lng != null)
    .map(([k, s]) => ({ k, s, d: km(near, [s.lat!, s.lng!]) }))
    .sort((a, b) => a.d - b.d);
  if (stays[0] && stays[0].d <= 30) return { name: stays[0].s.name, lat: stays[0].s.lat!, lng: stays[0].s.lng!, stayKey: stays[0].k, needsBooking: false };
  const t = [...OVERNIGHT_TOWNS].sort((a, b) => km(near, a.at) - km(near, b.at))[0];
  return { name: t.name, lat: t.at[0], lng: t.at[1], needsBooking: true };
}

/**
 * Two-day split of ordered stops: day 1 runs to the farthest stop and sleeps nearby; day 2 visits the rest
 * on the way home.
 */
export function splitTwoDays<T extends { item: { lat?: number; lng?: number } }>(home: [number, number], stops: T[]): [T[], T[]] {
  if (!stops.length) return [[], []];
  let far = 0;
  stops.forEach((s, k) => {
    if (km(home, [s.item.lat!, s.item.lng!]) > km(home, [stops[far].item.lat!, stops[far].item.lng!])) far = k;
  });
  return [stops.slice(0, far + 1), stops.slice(far + 1)];
}
