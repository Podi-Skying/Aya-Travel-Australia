import type { Package, TripDoc } from "../src/domain/schema";
import type { LegacyData } from "./legacy";

/*
 * Builds seed version 1 from the prototype data (PLAN.md 4.9, D7, D8):
 * Sydney 11/03–11/06, then Tasmania 11/06–11/27. Days before 11/03 are removed;
 * their activities (a03–a24) become unscheduled attraction-pool packages.
 */

export const TRIP_START = "2026-11-03";
export const TRIP_END = "2026-11-27";

const POOL: { key: string; from: string; ids: string[]; title?: string; suggestion: { date?: string; reason: string } }[] = [
  { key: "waterfront", from: "2026-10-25", ids: ["a03"], title: "荷巴特海濱散步晚餐", suggestion: { date: "2026-11-07", reason: "週六市集當天傍晚，步行可達" } },
  { key: "kunanyi", from: "2026-10-26", ids: ["a04", "a05", "a06"], suggestion: { date: "2026-11-23", reason: "週一，Zayden 可能可開車；當天目前空白" } },
  { key: "richmond", from: "2026-10-27", ids: ["a07", "a08", "a09"], suggestion: { date: "2026-11-24", reason: "週二，Zayden 可能可開車；當天目前空白" } },
  { key: "mtfield", from: "2026-10-28", ids: ["a10", "a11", "a12"], suggestion: { date: "2026-11-25", reason: "週三，Zayden 可能可開車；當天目前空白" } },
  { key: "citywalk", from: "2026-10-29", ids: ["a13", "a14"], suggestion: { date: "2026-11-12", reason: "不需開車；當天目前空白" } },
  { key: "mona", from: "2026-10-30", ids: ["a15", "a16"], suggestion: { date: "2026-11-13", reason: "搭渡輪，不需開車；當天目前空白" } },
  { key: "portarthur", from: "2026-10-31", ids: ["a17", "a18", "a19"], suggestion: { reason: "需要 JJ 週末開車，但週末都已排滿；要排入請取代一個週末行程" } },
  { key: "bruny", from: "2026-11-01", ids: ["a20", "a21", "a22", "a23"], suggestion: { reason: "需要 JJ 週末開車，但週末都已排滿；要排入請取代一個週末行程" } },
  { key: "northhobart", from: "2026-11-02", ids: ["a24"], suggestion: { date: "2026-11-20", reason: "公車可達；當天目前空白" } },
];

export const JOURNEY_CHAPTERS = [
  { key: "sydney", title: "雪梨", itemIds: ["a27", "a28", "a29", "a31"] },
  { key: "hobart", title: "荷巴特", itemIds: ["a04", "a35", "a37", "a16", "a18", "a22"] },
  { key: "coast", title: "東海岸", itemIds: ["a39", "a41", "a43", "a47"] },
  { key: "wild", title: "荒野", itemIds: ["a11", "a51", "a52"] },
];

function pick<T extends object>(o: T, keys: (keyof T)[]): Partial<T> {
  const out: Partial<T> = {};
  for (const k of keys) if (o[k] !== undefined) out[k] = o[k];
  return out;
}

export function buildSeed(legacy: LegacyData): TripDoc {
  const L = JSON.parse(JSON.stringify(legacy));
  const byDate = new Map<string, LegacyData>(L.days.map((d: LegacyData) => [d.date, d]));
  const allItems = new Map<string, LegacyData>(L.days.flatMap((d: LegacyData) => d.items.map((i: LegacyData) => [i.id, i])));

  const days: LegacyData[] = L.days.filter((d: LegacyData) => d.date >= TRIP_START && d.date <= "2026-11-24");

  const d1103 = days.find((d) => d.date === "2026-11-03");
  const a25 = d1103.items.find((i: LegacyData) => i.id === "a25");
  Object.assign(a25, {
    name: "飛抵雪梨",
    en: "Arrival at Sydney Airport",
    mode: "flight",
    lat: -33.9399,
    lng: 151.1753,
    src: { label: "Sydney Airport", url: "https://www.sydneyairport.com.au/" },
    travel: {},
    cost: { cat: "transport", amount: 0, unit: "pp", status: "unknown", note: "出發地與機票費用待填" },
    note: "出發地、航班與時間待填",
    verify: "unverified",
  });
  d1103.title = "抵達雪梨・環形碼頭";

  const d1106 = days.find((d) => d.date === "2026-11-06");
  d1106.title = "飛往荷巴特・入住";
  d1106.items.push({ ...allItems.get("a02"), time: "18:30" });

  days.push({ date: "2026-11-25", seg: "tas", title: "自由日（待規劃）", stay: "utas", driveHrs: 0, items: [], open: true });
  days.push({ ...byDate.get("2026-11-25"), date: "2026-11-26" });
  days.push({ ...byDate.get("2026-11-26"), date: TRIP_END });

  const attractionPool: Package[] = POOL.map((p) => {
    const src = byDate.get(p.from);
    const items = p.ids.map((id) => allItems.get(id));
    return {
      key: p.key,
      title: p.title ?? src.title,
      seg: "tas",
      items,
      costs: p.key === "waterfront" ? [] : (src.costs ?? []),
      driveHrs: p.key === "waterfront" ? 0 : src.driveHrs,
      ...(p.key === "waterfront" ? {} : pick(src, ["needsDriver", "alt", "ferry", "hike", "transfer"])),
      suggestion: p.suggestion,
    } as Package;
  });

  const segments = { ...L.segments };
  segments.syd = { ...segments.syd, range: "11/3–11/6" };
  segments.tas = { ...segments.tas, range: "11/6–11/27" };

  return {
    meta: { ...L.meta, subtitle: "雪梨 × 塔斯馬尼亞｜2026 年 11 月", start: TRIP_START, end: TRIP_END },
    partySize: L.meta.defaultPartySize,
    segments,
    drivers: L.drivers,
    // UTAS Hobart Apartments is the home base (every Tasmania night unless a multi-day trip goes elsewhere).
    stays: Object.fromEntries(Object.entries(L.stays).map(([k, v]) => [k, k === "utas" ? { ...(v as object), home: true } : v])),
    alertsSources: L.alertsSources,
    days,
    attractionPool,
    journey: { chapters: JOURNEY_CHAPTERS },
  } as TripDoc;
}

export const SEED_SUMMARY = "初始行程：雪梨 11/3–11/6、塔斯馬尼亞 11/6–11/27";
