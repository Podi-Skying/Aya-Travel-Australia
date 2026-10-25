import type { Item, Person, Photo, TripDoc, TripOption } from "./schema";
import { DEFAULT_PEOPLE, PEOPLE } from "./schema";
import { applyOp } from "./ops";
import { budgetLines, stayOf, sum } from "./budget";

/*
 * Derived numbers for a multi-day option card (PLAN-2026-10-26 §3). Cost is computed by applying
 * the option to a copy of the document and reading the same budget lines the 預算 tab uses, so
 * owner-covered driver costs and stays are counted exactly as they would be after choosing it.
 */

export const HOME_STAYS = new Set(["utas", "none"]);

export type OptionCard = {
  option: TripOption;
  dates: string[];
  /** Days that travel or have activities; a trailing rest day in Hobart does not count. */
  tripDays: number;
  nights: number;
  route: string;
  driveHrs: number;
  stays: { key: string; name: string; nightly: number; nights: number }[];
  cost: number | null;
  items: Item[][];
  people: Person[];
  /** Cover photo with its source (an option's own URL is credited to its site). */
  photo?: Photo;
};

export const optionDates = (o: TripOption) => o.days.map((_, i) => new Date(Date.parse(o.start + "T00:00:00Z") + i * 86_400_000).toISOString().slice(0, 10));

function findItem(doc: TripDoc, id: string): Item | undefined {
  for (const d of doc.days) for (const i of d.items) if (i.id === id) return i;
  for (const p of doc.attractionPool) for (const i of p.items) if (i.id === id) return i;
  return undefined;
}

export function optionCard(doc: TripDoc, o: TripOption, N: number): OptionCard {
  const dates = optionDates(o);
  const stays = new Map<string, { key: string; name: string; nightly: number; nights: number }>();
  for (const d of o.days) {
    if (HOME_STAYS.has(d.stay)) continue;
    const st = stayOf(doc, d.stay);
    const cur = stays.get(d.stay) ?? { key: d.stay, name: st.name, nightly: st.nightly, nights: 0 };
    cur.nights++;
    stays.set(d.stay, cur);
  }
  const items = o.days.map((d) => d.itemIds.map((id) => findItem(doc, id)).filter((x): x is Item => !!x));
  const r = applyOp(doc, { op: "applyOption", key: o.key });
  const cost = r.ok ? sum(budgetLines(r.doc, N).filter((l) => dates.includes(l.day))) : null;
  const ppl = new Set<Person>();
  items.flat().forEach((i) => (i.people ?? DEFAULT_PEOPLE).forEach((p) => ppl.add(p)));
  if (!ppl.size) DEFAULT_PEOPLE.forEach((p) => ppl.add(p));
  return {
    option: o,
    dates,
    tripDays: o.days.filter((d) => d.itemIds.length || d.driveHrs > 0).length,
    nights: [...stays.values()].reduce((a, s) => a + s.nights, 0),
    route: o.days.map((d) => d.title).join(" → "),
    driveHrs: Math.round(o.days.reduce((a, d) => a + d.driveHrs, 0) * 10) / 10,
    stays: [...stays.values()],
    cost,
    items,
    people: PEOPLE.filter((p) => ppl.has(p)),
    photo: o.photoUrl ? { url: o.photoUrl, page: o.photoUrl, site: new URL(o.photoUrl).hostname.replace(/^www\./, ""), kind: "custom" } : items.flat().find((i) => i.photo)?.photo,
  };
}

export const dayNightLabel = (c: Pick<OptionCard, "tripDays" | "nights">) => (c.nights ? `${c.tripDays}天${c.nights}夜` : `${c.tripDays}日遊`);

/*
 * Per-plan colours for the 推薦行程方案 reel (docs/PLAN-2026-10-26-plan-reel.md), derived from the
 * paper/ink/vermilion palette: `deep` carries white text (slices without a photo), `tint` is the
 * page background behind ink text. Both meet WCAG AA; a test checks the ratios.
 */
export type Palette = { name: string; deep: string; tint: string };
export const PALETTES: (Palette & { words: string[] })[] = [
  { name: "moss", deep: "#445a3b", tint: "#e5eadf", words: ["搖籃", "Cradle"] },
  { name: "sand", deep: "#7a6236", tint: "#f1e9da", words: ["Stanley", "Penguin", "西北"] },
  { name: "sea", deep: "#3d5a66", tint: "#e3eaec", words: ["東海岸", "Freycinet", "Bicheno"] },
  { name: "forest", deep: "#2f4a3a", tint: "#dfe8e1", words: ["布魯尼", "Bruny", "Huon"] },
  { name: "ochre", deep: "#7f5222", tint: "#f2e4d3", words: ["瑪麗亞", "Maria"] },
];
export const INK_PALETTE: Palette = { name: "ink", deep: "#3d3a33", tint: "#ece8df" };

export function optionPalette(o: Pick<TripOption, "title" | "region">): Palette {
  const text = `${o.title} ${o.region}`;
  return PALETTES.find((p) => p.words.some((w) => text.includes(w))) ?? INK_PALETTE;
}

/** WCAG relative-luminance contrast ratio between two #rrggbb colours. */
export function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, b2] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b2;
  };
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}
