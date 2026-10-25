import type { Item, Person, TripDoc, TripOption } from "./schema";
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
  photo?: string;
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
    photo: o.photoUrl ?? items.flat().find((i) => i.photo)?.photo?.url,
  };
}

export const dayNightLabel = (c: Pick<OptionCard, "tripDays" | "nights">) => (c.nights ? `${c.tripDays}天${c.nights}夜` : `${c.tripDays}日遊`);
