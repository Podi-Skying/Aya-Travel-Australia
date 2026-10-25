import type { TripDoc } from "./schema";
import { effectiveDay } from "./effective-day";

/*
 * 途經地區 chips for the top banner (chictrip review P1-b; moved from 總覽 on 2026-10-26). Region names are public;
 * each region links to the first day whose title or activities mention it.
 */

const REGIONS: { name: string; words: string[] }[] = [
  { name: "雪梨", words: ["雪梨", "Sydney", "Manly", "Bondi", "達令港"] },
  { name: "藍山", words: ["藍山", "Blue Mountains", "Katoomba"] },
  { name: "荷巴特", words: ["荷巴特", "Hobart", "Salamanca", "MONA", "kunanyi"] },
  { name: "布魯尼島", words: ["布魯尼", "Bruny"] },
  { name: "塔斯曼半島", words: ["塔斯曼", "Tasman", "亞瑟港", "Port Arthur"] },
  { name: "東海岸", words: ["東海岸", "Freycinet", "酒杯灣", "Bicheno", "火焰灣", "Bay of Fires", "Swansea"] },
  { name: "朗塞斯頓", words: ["朗塞斯頓", "Launceston", "卡塔拉克特", "Cataract"] },
  { name: "搖籃山", words: ["搖籃山", "Cradle", "鴿子湖", "Dove Lake"] },
  { name: "西北海岸", words: ["Stanley", "Penguin", "西北海岸"] },
  { name: "Huon Valley", words: ["Huon", "Tahune", "Hastings"] },
  { name: "Mount Field", words: ["Mount Field", "Mt Field"] },
  { name: "瑪麗亞島", words: ["瑪麗亞島", "Maria Island"] },
];

export function regionsOf(doc: Pick<TripDoc, "days">): { name: string; dayIdx: number }[] {
  const out: { name: string; dayIdx: number }[] = [];
  for (const r of REGIONS) {
    const idx = doc.days.findIndex((d) => [d.title, ...d.items.flatMap((i) => [i.name, i.en ?? ""])].some((t) => r.words.some((w) => t.toLowerCase().includes(w.toLowerCase()))));
    if (idx >= 0) out.push({ name: r.name, dayIdx: idx });
  }
  return out.sort((a, b) => a.dayIdx - b.dayIdx);
}

export function tripTags(doc: Pick<TripDoc, "days">): string[] {
  const tags: string[] = [];
  if (doc.days.some((d) => effectiveDay(d).needsDriver)) tags.push("朋友開車自駕");
  if (doc.days.some((d) => d.seg === "tas")) tags.push("塔州公車免費", "極光季（11 月仍可能）");
  return tags;
}
