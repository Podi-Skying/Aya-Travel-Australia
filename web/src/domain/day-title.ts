import type { Day, Item } from "./schema";

/*
 * Day titles follow the day's activities (Kai, 2026-10-26): an emptied day reads 「未規劃」, otherwise
 * the title is built from its main stops (logistics like taxis and check-in are skipped when
 * the day has anything else). A title the owner pins (day.titlePinned) is kept as written.
 * Built from whatever document the viewer has, so guests' titles come from the redacted document.
 */

export const UNPLANNED = "未規劃";
const MAX = 18;

/** Stay notes (「住宿：…」) are reminders, not plans; they never make a day count as planned. */
export const isPlan = (i: Pick<Item, "name">) => !i.name.startsWith("住宿：");

/** Getting somewhere (taxis, trains, check-in, going back to the hotel) is not what a day is about. */
const LOGISTICS = /(^|\s)搭|^(叫|前往|回到?|機場|從|退房|早餐、|Aya 國際線|雪梨機場：)|已在|飛抵|報到/;
export const isLogistics = (i: Pick<Item, "name">) => LOGISTICS.test(i.name);

/** Short place name: no bracketed notes; a long mixed name keeps its Chinese part (with one English word if short), at most 14 characters. */
export function shortName(name: string): string {
  if (/^Kai 有工作/.test(name)) return "Kai 工作";
  let s = name.replace(/[（(][^）)]*[）)]/g, "").replace(/\s+/g, " ").trim();
  const zh = s.match(/[\u3400-\u9fff][\u3400-\u9fff\w・ -]*$/)?.[0].trim();
  if (zh && [...s].length > 12 && zh !== s) {
    const latin = s.match(/^[A-Za-z][A-Za-z'’.-]*/)?.[0];
    s = [...zh].length >= 5 || !latin ? zh : `${latin} ${zh}`;
  }
  return [...s].length > 14 ? [...s].slice(0, 13).join("") + "…" : s;
}

const clip = (s: string) => ([...s].length > MAX ? [...s].slice(0, MAX - 1).join("") + "…" : s);

export function dayTitle(d: Pick<Day, "title" | "items"> & { titlePinned?: boolean }): string {
  if (d.titlePinned && d.title.trim()) return clip(d.title.trim());
  const plans = d.items.filter(isPlan);
  if (!plans.length) return UNPLANNED;
  const doing = plans.filter((i) => !isLogistics(i));
  const pool = doing.length ? doing : plans;
  // Main activities first (must-dos before the rest), then must-dos, then anything planned.
  const major = pool.filter((i) => i.major).sort((a, b) => Number(b.pri === "must") - Number(a.pri === "must"));
  const must = pool.filter((i) => i.pri === "must");
  const pick = (major.length ? major : must.length ? must : pool).map((i) => shortName(i.name));
  const uniq = pick.filter((n, k) => pick.indexOf(n) === k);
  const driving = plans.some((i) => i.mode === "drive");
  if (driving && uniq.length >= 2) return clip(`${uniq[0]} → ${uniq.at(-1)}`);
  return clip(uniq.slice(0, 2).join("・"));
}
