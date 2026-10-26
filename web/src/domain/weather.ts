import type { Day, Item, TripDoc } from "./schema";
import { nightStay } from "./stay";
import { km, OVERNIGHT_TOWNS } from "./quiz";
import { isLogistics } from "./day-title";

/*
 * Weather and rain-day backups (Kai 2026-10-26). Forecasts come from Open-Meteo (server/weather.ts); this
 * file decides where each day is, reads the forecast, and finds indoor alternatives. Pure functions.
 * Places are city-level only: the home base is reported as 荷巴特, never the residence.
 */

export type DayWx = {
  date: string;
  code: number;
  pop: number | null; // precipitation probability max, %
  rain: number | null; // precipitation sum, mm
  tMax: number | null;
  tMin: number | null;
  wind: number | null; // max wind, km/h
  uv: number | null;
  sunrise?: string;
  sunset?: string;
};

export type WxPlace = { name: string; lat: number; lng: number };

/** A trip day's forecast: `wx` null with `unavailable` when the source could not be reached for a date in range. */
export type WxDay = { date: string; place: string; wx: DayWx | null; unavailable?: boolean };

export const SYDNEY: WxPlace = { name: "雪梨", lat: -33.87, lng: 151.21 };
export const HOBART: WxPlace = { name: "荷巴特", lat: -42.88, lng: 147.33 };

/** Towns used to name a day's area (centres, city-level). */
const TOWNS: WxPlace[] = [
  HOBART,
  { name: "Richmond", lat: -42.735, lng: 147.44 },
  { name: "亞瑟港", lat: -43.14, lng: 147.85 },
  { name: "布魯尼島", lat: -43.3, lng: 147.33 },
  { name: "Huonville", lat: -43.03, lng: 147.05 },
  { name: "Mount Field", lat: -42.68, lng: 146.62 },
  { name: "Triabunna／瑪麗亞島", lat: -42.51, lng: 147.92 },
  ...OVERNIGHT_TOWNS.map((t) => ({ name: t.name, lat: t.at[0], lng: t.at[1] })),
];
const nearestTown = (lat: number, lng: number) => [...TOWNS].sort((a, b) => km([lat, lng], [a.lat, a.lng]) - km([lat, lng], [b.lat, b.lng]))[0];

/**
 * Where a day happens, for its forecast: Sydney for the Sydney part; in Tasmania the night's town when away
 * from home, else the farthest stop's town when the day goes more than 50 km out, else Hobart.
 */
export function dayPlace(doc: Pick<TripDoc, "stays" | "days" | "tripOptions">, d: Day): WxPlace {
  if (d.seg !== "tas") return SYDNEY;
  const stay = doc.stays[nightStay(doc, d)] as { home?: boolean; lat?: number; lng?: number } | undefined;
  if (stay && !stay.home && stay.lat != null && stay.lng != null) return nearestTown(stay.lat, stay.lng);
  const far = d.items
    .filter((i) => i.lat != null && i.lng != null && i.lat < -40 && !isLogistics(i))
    .map((i) => ({ i, d: km([HOBART.lat, HOBART.lng], [i.lat!, i.lng!]) }))
    .sort((a, b) => b.d - a.d)[0];
  return far && far.d > 50 ? nearestTown(far.i.lat!, far.i.lng!) : HOBART;
}

/** WMO weather codes as a short label and a line-icon name. */
export function wxLabel(code: number): { t: string; icon: "sun" | "partly" | "cloud" | "fog" | "drizzle" | "rain" | "storm" | "snow" } {
  if (code === 0) return { t: "晴", icon: "sun" };
  if (code <= 2) return { t: "晴時多雲", icon: "partly" };
  if (code === 3) return { t: "陰", icon: "cloud" };
  if (code <= 48) return { t: "霧", icon: "fog" };
  if (code <= 57) return { t: "毛毛雨", icon: "drizzle" };
  if (code <= 67 || (code >= 80 && code <= 82)) return { t: code === 65 || code === 82 ? "大雨" : "雨", icon: "rain" };
  if (code <= 77 || code === 85 || code === 86) return { t: "雪", icon: "snow" };
  return { t: "雷雨", icon: "storm" };
}

// Heavy rain, freezing rain, any snow and thunder (the codes wxLabel shows as 大雨, 雪 or 雷雨).
const SEVERE = new Set([65, 67, 71, 73, 75, 77, 82, 85, 86, 95, 96, 99]);

/** A day that wants its rain plan: rain likely (≥60 %) or a severe code. */
export const isWet = (w: DayWx | undefined) => !!w && ((w.pop ?? 0) >= 60 || SEVERE.has(w.code));
/** Strong wind worth a warning (coastal walks, boats, flights). */
export const isWindy = (w: DayWx | undefined) => !!w && (w.wind ?? 0) >= 45;

/* ---------------------------------------------------------------- indoor / outdoor */

const INDOOR_CATS = new Set(["history", "art", "market", "food"]);
const INDOOR_WORDS = /博物館|美術館|藝術|museum|gallery|art|酒廠|brewery|distillery|巧克力|chocolate|市場|market|購物|商場|QVB|水族館|SEA LIFE|aquarium|監獄|penitentiary|劇院|遊客中心|visitor centre|保育中心|餐|café|cafe|pizza|晚餐|午餐/i;
const OUTDOOR_WORDS = /步道|健行|walk|海灘|beach|觀景|lookout|山頂|summit|湖|lake|瀑布|falls|國家公園|national park|遊船|cruise|熱氣球|balloon|觀光飛行|島|island|花園|garden|沙丘|dune|海岸|coast|燈塔|lighthouse/i;

/** Indoor or sheltered? The owner's choice wins; otherwise inferred from the category and the name. */
export function isIndoor(i: Pick<Item, "name" | "cat"> & { indoor?: boolean }): boolean {
  if (i.indoor != null) return i.indoor;
  if (OUTDOOR_WORDS.test(i.name) && !/遊客中心|visitor centre|保育中心/i.test(i.name)) return false;
  if (i.cat && INDOOR_CATS.has(i.cat)) return true;
  return INDOOR_WORDS.test(i.name);
}

/** Activities that the weather can cancel, with what to check. */
export function weatherNote(i: Pick<Item, "name">): string | null {
  if (/熱氣球|balloon/i.test(i.name)) return "熱氣球看清晨的風：業者會在前一晚或當天清晨決定是否起飛，取消會改期或退款，請看業者的規定。";
  if (/遊船|cruise|渡輪|ferry/i.test(i.name)) return "遊船遇到大浪或強風可能取消或改期，請看業者的規定；出發前一天確認。";
  if (/觀光飛行|scenic flight/i.test(i.name)) return "觀光飛行看雲和風，業者可能延後或取消，請看業者的規定。";
  return null;
}

export type Backup = { key: string; item: Item; minutes: number };

/**
 * Indoor alternatives for an outdoor activity: indoor pool places in the same part of the trip within about
 * 30 minutes' drive (straight line ×1.3 at 70 km/h), nearest first, at most `n`.
 */
export function backupsFor(doc: Pick<TripDoc, "attractionPool">, act: Item, seg: string, n = 2): Backup[] {
  if (act.lat == null || act.lng == null) return [];
  return doc.attractionPool
    .filter((p) => p.seg === seg)
    .flatMap((p) => p.items.map((item) => ({ key: p.key, item })))
    .filter(({ item }) => item.id !== act.id && item.lat != null && item.lng != null && isIndoor(item) && !isLogistics(item))
    .map((b) => ({ ...b, minutes: Math.round((km([act.lat!, act.lng!], [b.item.lat!, b.item.lng!]) * 1.3 * 60) / 70) }))
    .filter((b) => b.minutes <= 30)
    .sort((a, b) => a.minutes - b.minutes)
    .slice(0, n);
}

/** The day's outdoor plans that a rainy forecast affects (logistics and stay notes left out). */
export const outdoorPlans = (d: Pick<Day, "items">) => d.items.filter((i) => !isLogistics(i) && !i.name.startsWith("住宿：") && !/^Kai 有工作/.test(i.name) && !isIndoor(i as Item & { indoor?: boolean }));
