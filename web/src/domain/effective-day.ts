import type { Cost, Day, Item, TripDoc } from "./schema";

/*
 * effectiveDay applies attached package contributions and single-item package
 * contexts to a day (PLAN.md 4.9). Budget, rules, map and journey code all work
 * on effective days. A day without attachments or contexts is returned with the
 * same values, so the legacy parity test is unaffected.
 */

export type EffectiveDay = Omit<Day, "costs"> & {
  costs: Cost[];
  /** Driver confirmed for the effective requirement (driver and window). */
  driverOk: boolean;
  /** A confirmation exists but names a different driver than the requirement. */
  staleConfirmation: boolean;
  /** Distinct drivers required on this day; more than one is a conflict. */
  requiredDrivers: string[];
  /** Alternatives to show, one per source. */
  alts: string[];
};

type Context = {
  key: string;
  needsDriver?: string;
  driveHrs: number;
  alt?: string;
  ferry?: boolean;
  hike?: boolean;
  transfer?: boolean;
  costs: Cost[];
};

/** Public documents carry the confirmation outcome without the driver or window. */
type MaybePublicDay = Day & { publicDriverOk?: boolean };

function contextsOf(day: Day): Context[] {
  const byKey = new Map<string, Context>();
  for (const a of day.attached ?? []) {
    byKey.set(a.key, { ...a, costs: a.costs });
  }
  for (const it of day.items) {
    const pc = it.packageContext;
    if (pc && !byKey.has(pc.key)) byKey.set(pc.key, { ...pc, costs: [] });
  }
  return [...byKey.values()];
}

export function effectiveDay(day: Day): EffectiveDay {
  const ctx = contextsOf(day);
  // Collect requirements before de-duplication so inconsistent contexts are reported, not hidden.
  const required = new Set<string>();
  if (day.needsDriver) required.add(day.needsDriver);
  for (const a of day.attached ?? []) if (a.needsDriver) required.add(a.needsDriver);
  for (const it of day.items) if (it.packageContext?.needsDriver) required.add(it.packageContext.needsDriver);
  const requiredDrivers = [...required];
  const needsDriver = day.needsDriver ?? ctx.find((c) => c.needsDriver)?.needsDriver;

  const alts: string[] = [];
  if (day.alt) alts.push(day.alt);
  for (const c of ctx) if (c.alt && !alts.includes(c.alt)) alts.push(c.alt);

  const conf = day.driverConfirmation;
  const publicOk = (day as MaybePublicDay).publicDriverOk === true;
  const driverOk = !!needsDriver && ((!!conf && conf.driver === needsDriver) || publicOk);
  const staleConfirmation = !!conf && conf.driver !== needsDriver;

  const hasCtx = ctx.length > 0;
  return {
    ...day,
    needsDriver,
    driveHrs: hasCtx ? round1(day.driveHrs + ctx.reduce((a, c) => a + c.driveHrs, 0)) : day.driveHrs,
    alt: alts.length ? alts.join(" ／ ") : undefined,
    ferry: day.ferry || ctx.some((c) => c.ferry) || undefined,
    hike: day.hike || ctx.some((c) => c.hike) || undefined,
    transfer: day.transfer || ctx.some((c) => c.transfer) || undefined,
    costs: [...(day.costs ?? []), ...ctx.flatMap((c) => c.costs)],
    driverOk,
    staleConfirmation,
    requiredDrivers,
    alts,
  };
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

export function itemNeedsDriver(eday: EffectiveDay, item: Item): boolean {
  return !!eday.needsDriver && (item.mode === "drive" || !!item.packageContext?.needsDriver);
}

/** Drive items, and items reachable only by a package's drive, are tentative until the driver is confirmed. */
export function isTentative(eday: EffectiveDay, item: Item): boolean {
  return itemNeedsDriver(eday, item) && !eday.driverOk;
}

/** Rule violations that make a document unacceptable on save/import (beyond the schema). */
export function docRuleErrors(doc: TripDoc): { path: string; message: string }[] {
  const errors: { path: string; message: string }[] = [];
  doc.days.forEach((d, i) => {
    const e = effectiveDay(d);
    if (e.requiredDrivers.length > 1)
      errors.push({ path: `days.${i}`, message: `${d.date} 同時依賴多位司機（${e.requiredDrivers.join("、")}）` });
    for (const k of e.requiredDrivers)
      if (!doc.drivers[k]) errors.push({ path: `days.${i}`, message: `${d.date} 依賴未知的司機 ${k}` });
  });
  return errors;
}
