import type { Day, TripDoc } from "./schema";
import { km } from "./quiz";
import { isLogistics } from "./day-title";
import { isStayItem } from "./privacy";

/*
 * Tasmania-wide weather (Kai 2026-11-08, docs/PLAN-2026-11-08-weather.md). Thirty fixed public places in
 * eight regions, one Open-Meteo request for all of them (server/tas-weather.ts). Pure functions only.
 */

export type RegionKey = "nw" | "west" | "central" | "north" | "ne" | "east" | "se" | "south";

export const REGIONS: { key: RegionKey; name: string; en: string }[] = [
  { key: "nw", name: "西北", en: "North-west" },
  { key: "west", name: "西部", en: "West" },
  { key: "central", name: "中部高地", en: "Central" },
  { key: "north", name: "北部", en: "North" },
  { key: "ne", name: "東北", en: "North-east" },
  { key: "east", name: "東岸", en: "East coast" },
  { key: "se", name: "東南", en: "South-east" },
  { key: "south", name: "南部", en: "South" },
];

export type TasPoint = { id: string; name: string; en: string; region: RegionKey; lat: number; lng: number; tier: 1 | 2 };

/** Town or landmark level only. Tier 1 shows at the island-fit zoom (no two closer than 50 km); tier 2 from zoom 8.3. */
export const TAS_POINTS: TasPoint[] = [
  { id: "stanley", name: "史丹利", en: "Stanley", region: "nw", lat: -40.76, lng: 145.3, tier: 1 },
  { id: "burnie", name: "伯尼／Table Cape", en: "Burnie", region: "nw", lat: -41.0, lng: 145.8, tier: 2 },
  { id: "arthur", name: "亞瑟河", en: "Arthur River", region: "nw", lat: -41.05, lng: 144.66, tier: 1 },
  { id: "strahan", name: "斯特拉恩", en: "Strahan", region: "west", lat: -42.15, lng: 145.33, tier: 1 },
  { id: "queenstown", name: "皇后鎮", en: "Queenstown", region: "west", lat: -42.08, lng: 145.56, tier: 2 },
  { id: "cradle", name: "搖籃山", en: "Cradle Mountain", region: "central", lat: -41.65, lng: 145.95, tier: 1 },
  { id: "stclair", name: "聖克萊爾湖", en: "Lake St Clair", region: "central", lat: -42.12, lng: 146.17, tier: 2 },
  { id: "miena", name: "大湖／Miena", en: "Great Lake", region: "central", lat: -41.99, lng: 146.73, tier: 1 },
  { id: "campbell", name: "坎貝爾鎮／Ross", en: "Campbell Town", region: "central", lat: -41.93, lng: 147.49, tier: 2 },
  { id: "launceston", name: "朗塞斯頓", en: "Launceston", region: "north", lat: -41.44, lng: 147.14, tier: 1 },
  { id: "tamar", name: "塔瑪河谷", en: "Tamar Valley", region: "north", lat: -41.2, lng: 146.85, tier: 2 },
  { id: "devonport", name: "德文港", en: "Devonport", region: "north", lat: -41.18, lng: 146.36, tier: 1 },
  { id: "deloraine", name: "德洛蘭／Mole Creek", en: "Deloraine", region: "north", lat: -41.55, lng: 146.4, tier: 2 },
  { id: "bridport", name: "布里德波特", en: "Bridport", region: "ne", lat: -41.0, lng: 147.39, tier: 1 },
  { id: "derby", name: "德比", en: "Derby", region: "ne", lat: -41.15, lng: 147.8, tier: 2 },
  { id: "sthelens", name: "聖海倫斯", en: "St Helens", region: "ne", lat: -41.32, lng: 148.25, tier: 1 },
  { id: "bayoffires", name: "火焰灣／The Gardens", en: "Bay of Fires", region: "ne", lat: -41.17, lng: 148.3, tier: 2 },
  { id: "blue", name: "小藍湖", en: "Little Blue Lake", region: "ne", lat: -40.94, lng: 148.0, tier: 2 },
  { id: "benlomond", name: "本洛蒙山", en: "Ben Lomond", region: "ne", lat: -41.53, lng: 147.66, tier: 2 },
  { id: "bicheno", name: "比切諾", en: "Bicheno", region: "east", lat: -41.87, lng: 148.3, tier: 1 },
  { id: "freycinet", name: "酒杯灣／Coles Bay", en: "Freycinet", region: "east", lat: -42.12, lng: 148.29, tier: 2 },
  { id: "swansea", name: "斯旺西", en: "Swansea", region: "east", lat: -42.12, lng: 148.07, tier: 2 },
  { id: "maria", name: "Orford／瑪麗亞島", en: "Maria Island", region: "east", lat: -42.55, lng: 148.05, tier: 1 },
  { id: "hobart", name: "荷巴特", en: "Hobart", region: "se", lat: -42.88, lng: 147.33, tier: 1 },
  { id: "richmond", name: "里奇蒙", en: "Richmond", region: "se", lat: -42.73, lng: 147.44, tier: 2 },
  { id: "portarthur", name: "亞瑟港", en: "Port Arthur", region: "se", lat: -43.15, lng: 147.85, tier: 1 },
  { id: "mtfield", name: "菲爾德山", en: "Mt Field", region: "south", lat: -42.68, lng: 146.7, tier: 2 },
  { id: "huon", name: "休恩谷", en: "Huon Valley", region: "south", lat: -43.16, lng: 146.93, tier: 2 },
  { id: "bruny", name: "布魯尼島", en: "Bruny Island", region: "south", lat: -43.27, lng: 147.35, tier: 2 },
  { id: "cockle", name: "科克爾溪", en: "Cockle Creek", region: "south", lat: -43.58, lng: 146.89, tier: 1 },
];

export type TasDay = {
  date: string;
  code: number;
  tMax: number | null;
  tMin: number | null;
  pop: number | null;
  rain: number | null;
  gust: number | null;
  cloudDay: number | null;
  sunrise: string | null;
  sunset: string | null;
  /** Mean cloud 22:00–03:00 Hobart time; null when the window is incomplete (the last forecast date). */
  nightCloud: number | null;
  nightLow: number | null;
  /** Daylight only (sunrise–sunset): the most severe hourly code, the highest rain chance, the rain sum. */
  dayCode: number;
  dayPop: number | null;
  dayRain: number | null;
  /** Rain that falls only outside daylight, as runs of consecutive wet Hobart hours ("02–05"); empty when daylight is wet too. */
  nightRain: string[];
};

/**
 * One hour at one point, covering [u, u + 1 h): Hobart civil hour `h` of instant `u` (Unix seconds; two rows share
 * an `h` when clocks go back). The code, temperature, cloud and `d` (is_day) are the values at `u`; rain chance, rain
 * and gusts describe the hour that follows, which Open-Meteo reports on the next sample ("preceding hour"). `w` is
 * `wetHour` on the unrounded rain (`mm` is rounded to 0.1 for display).
 */
export type HourRow = { u: number; h: number; code: number; t: number | null; f: number | null; pop: number | null; mm: number | null; cl: number | null; lo: number | null; g: number | null; d: 0 | 1; w: 0 | 1 };
/** `sr`/`ss`: sunrise and sunset as fractional Hobart hours, for shading the night. */
export type HourDay = { date: string; sunrise: string | null; sunset: string | null; sr: number | null; ss: number | null; hours: HourRow[] };

/** Days of hourly detail kept per point (the summary still covers all 16). */
export const HOURLY_DAYS = 10;

/**
 * Several points' night-rain runs as at most two spans, one before dawn and one in the evening: "rain possible
 * sometime in 00–05" on a region card, not "00–04 00–05 01–04".
 */
export function mergeNightRain(ranges: string[]): string[] {
  const parts = ranges.map((x) => x.split("–").map(Number)).filter((x) => x.length === 2 && x.every(Number.isFinite));
  const span2 = (xs: number[][]) => (xs.length ? `${pad2(Math.min(...xs.map((x) => x[0])))}–${pad2(Math.max(...xs.map((x) => x[1])))}` : null);
  return [span2(parts.filter((x) => x[0] < 12)), span2(parts.filter((x) => x[0] >= 12))].filter((x): x is string => !!x);
}

/**
 * How bad a WMO code is, for "the worst hour of the day": intensity first (slight < moderate < heavy), then the
 * kind (drizzle < rain < freezing < snow) — numeric order alone would rank slight snow showers (85) above violent
 * rain showers (82). Thunderstorms top everything; fog sits above clouds and below any precipitation.
 */
const SEVERITY: Record<number, number> = {
  45: 10, 48: 11,
  51: 20, 61: 21, 80: 21, 56: 22, 66: 22, 71: 23, 77: 23, 85: 23,
  53: 30, 63: 31, 81: 31, 73: 33,
  55: 40, 65: 41, 82: 41, 57: 42, 67: 42, 75: 43, 86: 43,
  95: 50, 96: 51, 99: 52,
};
export const wxSeverity = (code: number) => SEVERITY[code] ?? code;
export const worstCode = (codes: number[]) => codes.reduce((a, b) => (wxSeverity(b) > wxSeverity(a) ? b : a));

/** Drizzle, rain, snow, showers and storms are WMO 51 and above; fog (45/48) is not wet. */
export const wetHour = (x: { code: number; mm: number | null }) => (x.mm ?? 0) >= 0.1 || x.code >= 51;

const HOBART_TZ = "Australia/Hobart";
const civil = new Intl.DateTimeFormat("en-CA", { timeZone: HOBART_TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** A Unix instant as Hobart civil date and time (DST-aware). */
export function hobartCivil(unix: number): { date: string; hour: number; hm: string } {
  const p = Object.fromEntries(civil.formatToParts(new Date(unix * 1000)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), hm: `${p.hour}:${p.minute}` };
}

export const hobartToday = (now = new Date()) => hobartCivil(Math.floor(now.getTime() / 1000)).date;

const addDays = (date: string, n: number) => new Date(Date.parse(date + "T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);
const r = (v: unknown, k = 0) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10 ** k) / 10 ** k : null);
const mean = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

type Block = { time?: unknown[] } & Record<string, unknown[] | undefined>;
type Loc = { utc_offset_seconds?: number; daily?: Block; hourly?: Block };

/**
 * Open-Meteo multi-location response (one object per point, in request order, `timeformat=unixtime`) → per
 * point, per date. Daily dates use the response's fixed offset (how Open-Meteo encodes the local day);
 * hourly instants and sunrise/sunset are converted with the Hobart time zone.
 */
export function parseTasForecast(body: unknown, points: Pick<TasPoint, "id">[] = TAS_POINTS): Record<string, TasDay[]> {
  return parseTas(body, points).days;
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const frac = (unix: number) => {
  const c = hobartCivil(unix);
  return c.hour + Number(c.hm.slice(3)) / 60;
};

/** Wet hours as runs of consecutive hours, each "HH–HH" (end = the last wet hour + 1); a dry hour splits a run. */
function runs(rows: { unix: number; hour: number }[]): string[] {
  const out: string[] = [];
  let start: (typeof rows)[number] | null = null;
  rows.forEach((x, k) => {
    start ??= x;
    const next = rows[k + 1];
    if (!next || next.unix !== x.unix + 3600) {
      out.push(`${pad2(start.hour)}–${pad2(x.hour + 1)}`);
      start = null;
    }
  });
  return out;
}

/** Summary rows for every point, plus the first `HOURLY_DAYS` dates of hourly detail. */
export function parseTas(body: unknown, points: Pick<TasPoint, "id">[] = TAS_POINTS): { days: Record<string, TasDay[]>; hourly: Record<string, HourDay[]> } {
  const list = (Array.isArray(body) ? body : [body]) as Loc[];
  if (list.length !== points.length) throw new Error("tas weather length");
  const out: Record<string, TasDay[]> = {};
  const hourlyOut: Record<string, HourDay[]> = {};
  list.forEach((loc, k) => {
    const d = loc?.daily;
    const h = loc?.hourly;
    if (!d || !Array.isArray(d.time) || !h || !Array.isArray(h.time)) throw new Error("tas weather shape");
    const off = typeof loc.utc_offset_seconds === "number" ? loc.utc_offset_seconds : 0;
    // Hourly samples bucketed by Hobart civil date and hour.
    const hours = new Map<string, { cloud: number; low: number }[]>();
    const dayCloud = new Map<string, number[]>();
    // Civil dates that have a 03:00 sample: the night before them is not cut off by the horizon.
    const has3 = new Set<string>();
    h.time.forEach((t, i) => {
      if (typeof t !== "number") return;
      const c = hobartCivil(t);
      const cloud = h.cloud_cover?.[i];
      const low = h.cloud_cover_low?.[i];
      if (typeof cloud !== "number" || typeof low !== "number") return;
      if (c.hour === 3) has3.add(c.date);
      if (c.hour >= 9 && c.hour < 18) dayCloud.set(c.date, [...(dayCloud.get(c.date) ?? []), cloud]);
      if (c.hour >= 22 || c.hour < 3) {
        const night = c.hour >= 22 ? c.date : addDays(c.date, -1);
        hours.set(night, [...(hours.get(night) ?? []), { cloud, low }]);
      }
    });
    // Every hour [t, t + 1 h) by Hobart civil date. Open-Meteo reports rain chance, rain and gusts for the hour
    // before each sample, so the hour starting at t takes those from the next sample (t + 1 h); the weather code,
    // like temperature and cloud, is the value at t.
    const byDate = new Map<string, { unix: number; hour: number; raw: number | null; row: HourRow }[]>();
    const num = (key: string, i: number, k2 = 0) => r(h[key]?.[i], k2);
    h.time.forEach((t, i) => {
      const code = h.weather_code?.[i];
      if (typeof t !== "number" || h.time![i + 1] !== t + 3600 || typeof code !== "number") return;
      const c = hobartCivil(t);
      // Classify and sum on the raw amount; only the shown value is rounded (0.06 mm is not a wet hour).
      const pr = h.precipitation?.[i + 1];
      const raw = typeof pr === "number" && Number.isFinite(pr) ? pr : null;
      const row: HourRow = {
        u: t,
        h: c.hour,
        code,
        t: num("temperature_2m", i, 1),
        f: num("apparent_temperature", i, 1),
        pop: num("precipitation_probability", i + 1),
        mm: num("precipitation", i + 1, 1),
        cl: num("cloud_cover", i),
        lo: num("cloud_cover_low", i),
        g: num("wind_gusts_10m", i + 1),
        d: h.is_day?.[i] === 0 ? 0 : 1,
        w: wetHour({ code, mm: raw }) ? 1 : 0,
      };
      byDate.set(c.date, [...(byDate.get(c.date) ?? []), { unix: t, hour: c.hour, raw, row }]);
    });
    /** Daylight = hours overlapping sunrise–sunset; without sun times or hourly codes, the daily values stand. */
    const daylight = (date: string, i: number, code: number, sr: number | null, ss: number | null): Pick<TasDay, "dayCode" | "dayPop" | "dayRain" | "nightRain"> => {
      const all = byDate.get(date) ?? [];
      // Without daylight hours only the code falls back to the daily one; whole-day rain is not daytime rain.
      const fallback = { dayCode: code, dayPop: null, dayRain: null, nightRain: [] };
      if (sr == null || ss == null || !all.length) return fallback;
      const isDay = (x: { unix: number }) => x.unix + 3600 > sr && x.unix < ss;
      const lit = all.filter(isDay);
      if (!lit.length) return fallback;
      const pops = lit.map((x) => x.row.pop).filter((x): x is number => x != null);
      const mms = lit.map((x) => x.raw).filter((x): x is number => x != null);
      const dayWet = lit.some((x) => x.row.w === 1);
      const wetNight = dayWet ? [] : all.filter((x) => !isDay(x) && x.row.w === 1);
      return {
        dayCode: worstCode(lit.map((x) => x.row.code)),
        dayPop: pops.length ? Math.max(...pops) : null,
        dayRain: mms.length ? Math.round(mms.reduce((a, b) => a + b, 0) * 10) / 10 : null,
        nightRain: runs(wetNight),
      };
    };
    const days: TasDay[] = [];
    const hourly: HourDay[] = [];
    d.time.forEach((t, i) => {
      const code = d.weather_code?.[i];
      if (typeof t !== "number" || typeof code !== "number") return;
      const date = new Date((t + off) * 1000).toISOString().slice(0, 10);
      const night = hours.get(date) ?? [];
      // Complete when the data runs on to 03:00 the next morning (4–6 samples: 5, or one fewer/more at a DST change).
      const complete = night.length >= 4 && has3.has(addDays(date, 1));
      const sr = d.sunrise?.[i];
      const ss = d.sunset?.[i];
      days.push({
        date,
        code,
        tMax: r(d.temperature_2m_max?.[i]),
        tMin: r(d.temperature_2m_min?.[i]),
        pop: r(d.precipitation_probability_max?.[i]),
        rain: r(d.precipitation_sum?.[i], 1),
        gust: r(d.wind_gusts_10m_max?.[i]),
        cloudDay: mean(dayCloud.get(date) ?? []),
        sunrise: typeof sr === "number" ? hobartCivil(sr).hm : null,
        sunset: typeof ss === "number" ? hobartCivil(ss).hm : null,
        nightCloud: complete ? mean(night.map((x) => x.cloud)) : null,
        nightLow: complete ? mean(night.map((x) => x.low)) : null,
        ...daylight(date, i, code, typeof sr === "number" ? sr : null, typeof ss === "number" ? ss : null),
      });
      if (days.length <= HOURLY_DAYS)
        hourly.push({
          date,
          sunrise: typeof sr === "number" ? hobartCivil(sr).hm : null,
          sunset: typeof ss === "number" ? hobartCivil(ss).hm : null,
          sr: typeof sr === "number" ? frac(sr) : null,
          ss: typeof ss === "number" ? frac(ss) : null,
          hours: (byDate.get(date) ?? []).map(({ row }) => row),
        });
    });
    if (!days.length) throw new Error("tas weather empty");
    out[points[k].id] = days;
    hourlyOut[points[k].id] = hourly;
  });
  return { days: out, hourly: hourlyOut };
}

export type Sky = "clear" | "some" | "cloudy";
/** Night sky for aurora: low cloud hides the horizon most, so it weighs 70 %. */
export function skyScore(nightCloud: number | null, nightLow: number | null): { score: number; band: Sky } | null {
  if (nightCloud == null || nightLow == null) return null;
  const score = Math.round(0.7 * nightLow + 0.3 * nightCloud);
  return { score, band: score < 25 ? "clear" : score < 55 ? "some" : "cloudy" };
}

export function risks(d: Pick<TasDay, "gust" | "tMin">): { wind: boolean; frost: boolean } {
  return { wind: (d.gust ?? 0) >= 60, frost: d.tMin != null && d.tMin <= 1 };
}

/** Strongest predicted Kp in the night of a Hobart date (22:00–03:00), with the Hobart hours it covers. */
export function kpWindow(rows: { time: string; kp: number; kind: string }[], date: string): { kp: number; from: string; to: string } | null {
  let best: { kp: number; from: string; to: string } | null = null;
  for (const row of rows) {
    // A night's outlook is NOAA's prediction, not an observation from earlier.
    if (row.kind !== "predicted") continue;
    const t = Date.parse(row.time) / 1000;
    if (!Number.isFinite(t)) continue;
    // NOAA rows are 3-hour blocks starting at `time` (UTC); a block counts when it overlaps the night.
    const start = hobartCivil(t);
    const end = hobartCivil(t + 3 * 3600);
    const inNight = (c: { date: string; hour: number }) => (c.date === date && c.hour >= 22) || (c.date === addDays(date, 1) && c.hour < 3);
    const overlaps = inNight(start) || inNight(hobartCivil(t + 3600)) || inNight(hobartCivil(t + 7200));
    if (!overlaps) continue;
    if (!best || row.kp > best.kp) best = { kp: Math.round(row.kp * 10) / 10, from: start.hm, to: end.hm };
  }
  return best;
}

/** Tasmania and its Bass Strait islands; nothing else lies in this box. */
export const inTasmania = (lat: number, lng: number) => lat >= -43.8 && lat <= -39.4 && lng >= 143.5 && lng <= 148.6;

export const nearestPoint = (lat: number, lng: number) => [...TAS_POINTS].sort((a, b) => km([lat, lng], [a.lat, a.lng]) - km([lat, lng], [b.lat, b.lng]))[0];

const HOBART: [number, number] = [-42.88, 147.33];

/**
 * Where the trip is on a day, for the 「我們在這」 badge. Reads only what the public document also carries
 * (item names and positions, `seg`, stay names) and never a stay position, so owner and guests agree.
 */
export function tripPoint(doc: Pick<TripDoc, "stays">, day: Pick<Day, "seg" | "items">): string {
  // Any stay name, however short (isStayItem skips names under four characters).
  const stayNames = (Object.values(doc.stays) as { name?: string }[]).map((s) => (s.name ?? "").replace(/[（(].*$/, "").trim().toLowerCase()).filter(Boolean);
  const aboutStay = (i: { name: string; en?: string }) => stayNames.some((n) => i.name.toLowerCase().includes(n) || (i.en ?? "").toLowerCase().includes(n));
  const cands = day.items.filter(
    (i) => i.lat != null && i.lng != null && inTasmania(i.lat, i.lng) && !isLogistics(i) && !isStayItem(i, doc) && !aboutStay(i) && !i.name.startsWith("住宿：") && !i.name.includes("住處"),
  );
  if (!cands.length) return day.seg === "syd" ? "syd" : "hobart";
  const far = [...cands].sort((a, b) => km(HOBART, [b.lat!, b.lng!]) - km(HOBART, [a.lat!, a.lng!]))[0];
  return nearestPoint(far.lat!, far.lng!).id;
}

/** Screen-space declutter: keep boxes in priority order, hide any whose centre is within `minPx` of a kept one. */
export function declutter<T extends { x: number; y: number; prio: number }>(boxes: T[], minPx = 38): Set<T> {
  const kept: T[] = [];
  for (const b of [...boxes].sort((a, c) => c.prio - a.prio)) if (kept.every((k) => Math.hypot(k.x - b.x, k.y - b.y) >= minPx)) kept.push(b);
  return new Set(kept);
}

/** Seconds until the next Hobart midnight (edge caches must not carry a forecast into the next date). */
export function secondsToHobartMidnight(now = new Date()): number {
  const t = Math.floor(now.getTime() / 1000);
  const c = hobartCivil(t);
  let lo = t;
  let hi = t + 26 * 3600;
  // Binary search for the first second whose Hobart date differs (DST-proof).
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (hobartCivil(mid).date === c.date) lo = mid;
    else hi = mid;
  }
  return hi - t;
}
