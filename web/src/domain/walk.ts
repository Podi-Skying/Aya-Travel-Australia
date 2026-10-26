import { dayTitle } from "./day-title";
import type { TripDoc } from "./schema";
import { effectiveDay } from "./effective-day";

/* Scheduled days for the route-walk page. Pool items are not scheduled, so they never appear. */
export function walkDays(doc: Pick<TripDoc, "days" | "segments">) {
  return doc.days.map((raw) => {
    const d = effectiveDay(raw);
    return {
      date: d.date,
      seg: d.seg,
      segName: doc.segments[d.seg]?.name ?? d.seg,
      title: dayTitle(d),
      driveHrs: d.driveHrs,
      needsDriver: !!d.needsDriver,
      driverOk: d.driverOk,
      items: d.items.map((i) => ({ time: i.time, dur: i.dur, name: i.name, en: i.en, pri: i.pri, mode: i.mode, travel: i.travel, cost: i.cost && { amount: i.cost.amount, unit: i.cost.unit, status: i.cost.status } })),
    };
  });
}
