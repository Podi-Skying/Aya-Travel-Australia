import { nightStay } from "./stay";
import type { TripDoc } from "./schema";
import { effectiveDay, type EffectiveDay } from "./effective-day";
import { stayOf } from "./budget";

/* Ports of checks / feasibility from site/js/app.js (PLANNING_RULES.md, FR-10, FR-12). */

export type Check = { lv: "ok" | "info" | "warn" | "danger"; t: string; alt?: string };

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const fromMin = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** Kai's rule (2026-11-01): about 2 hours of driving at most, then a stop of at least 30 minutes. */
export const MAX_DRIVE_MIN = 135;
export const MIN_REST_MIN = 30;
export function longestDrive(legs: { driveMin: number; stopMin: number }[]): number {
  let run = 0;
  let top = 0;
  for (const l of legs) {
    run += l.driveMin;
    top = Math.max(top, run);
    if (l.stopMin >= MIN_REST_MIN) run = 0;
  }
  return top;
}

export function checks(doc: Pick<TripDoc, "stays" | "tripOptions">, d: EffectiveDay, opts: { showWindow: boolean }): Check[] {
  const out: Check[] = [];
  const majors = d.items.filter((i) => i.major).length;
  const heavy = d.transfer || d.ferry || d.hike;
  const label = d.needsDriver;
  if (d.needsDriver && !d.driverOk)
    out.push({ lv: "warn", t: `此日依賴 ${label} 開車，但日期與時段尚未確認：開車行程皆為「暫定」。`, alt: d.alt });
  if (d.needsDriver && d.driverOk) {
    const w = d.driverConfirmation?.window;
    out.push({ lv: "ok", t: `司機已確認${w && opts.showWindow ? "（" + w + "）" : ""}。` });
  }
  if (d.staleConfirmation)
    out.push({ lv: "warn", t: "先前確認的司機與目前需要的司機不同（確認對象已變更），請重新確認。" });
  if (d.driveHrs > 3 && !d.transfer)
    out.push({ lv: "warn", t: `預估總開車約 ${d.driveHrs} 小時，超過一般日 2–3 小時的建議（提案中，待確認）。` });
  if (d.driveHrs > 3 && d.transfer) out.push({ lv: "info", t: `長途移動日（約 ${d.driveHrs} 小時車程），已減少活動量；請安排休息站。` });
  if (majors > 4) out.push({ lv: "warn", t: `主要活動 ${majors} 個，超過每日 3–4 個的彈性目標。` });
  else if (heavy && majors > 3) out.push({ lv: "warn", t: `當天有渡輪／健行／長途移動，主要活動 ${majors} 個可能太滿。` });
  const st = stayOf(doc, nightStay(doc, d));
  const endOf = (i: { time: string; dur: number }) => toMin(i.time) + i.dur;
  for (const i of d.items)
    if (i.closes && endOf(i) > toMin(i.closes)) out.push({ lv: "warn", t: `「${i.name}」排到 ${fromMin(endOf(i))}，但 ${i.closes} 就打烊或最後入座。` });
  const lateTo = st.checkin?.to;
  if (lateTo && !d.items.some((i) => /入住/.test(i.name) && toMin(i.time) <= toMin(lateTo))) {
    const last = d.items.filter((i) => !i.name.startsWith("住宿：")).at(-1);
    if (last && endOf(last) > toMin(lateTo)) out.push({ lv: "warn", t: `最後一站 ${fromMin(endOf(last))} 才結束，住宿最晚 ${lateTo} 要入住。` });
  }
  if (st.nightly > 0 && st.status !== "confirmed") out.push({ lv: "info", t: `住宿「${st.area}」尚未預訂，價格為估計值。` });
  if (d.items.some((i) => i.cost && i.cost.status === "unknown")) out.push({ lv: "info", t: "部分費用未知，未計入總額。" });
  if (d.open && !d.items.length) out.push({ lv: "info", t: "尚未安排活動，可保留彈性休息或之後加入。" });
  return out;
}

export type Feasibility = "verified" | "partial" | "unverified";

export function feasibility(doc: Pick<TripDoc, "stays" | "tripOptions">, d: EffectiveDay): Feasibility {
  if (d.needsDriver && !d.driverOk) return "unverified";
  if (!d.items.length) return "unverified";
  const v = d.items.map((i) => i.verify);
  const warn = checks(doc, d, { showWindow: false }).some((c) => c.lv === "warn" || c.lv === "danger");
  if (v.every((x) => x === "verified") && !warn) return "verified";
  if (v.some((x) => x === "verified" || x === "partial")) return "partial";
  return "unverified";
}

/** Last-known alert status for offline storage (FR-24): rule warnings and feasibility per day. */
export function alertStatus(doc: TripDoc, opts: { showWindow: boolean }) {
  return doc.days.map((raw) => {
    const d = effectiveDay(raw);
    return { date: d.date, checks: checks(doc, d, opts), feasibility: feasibility(doc, d) };
  });
}
