import { describe, expect, it } from "vitest";
import { seedDoc } from "./helpers";
import { applyOp, type Op } from "@/domain/ops";
import { effectiveDay, isTentative } from "@/domain/effective-day";
import { checks } from "@/domain/rules";
import { budgetLines, dayTotal } from "@/domain/budget";
import type { TripDoc } from "@/domain/schema";

/* AC14 pool and driver behaviour on pure operations (PLAN.md 4.9, R3–R6). */

function run(doc: TripDoc, op: Op): TripDoc {
  const r = applyOp(doc, op);
  if (!r.ok) throw new Error(`${op.op}: ${r.error}`);
  return r.doc;
}
const day = (doc: TripDoc, date: string) => doc.days.find((d) => d.date === date)!;
const idx = (doc: TripDoc, date: string) => doc.days.findIndex((d) => d.date === date);
const warnTexts = (doc: TripDoc, date: string) => checks(doc, effectiveDay(day(doc, date)), { showWindow: true }).filter((c) => c.lv === "warn").map((c) => c.t);

describe("attraction pool scheduling", () => {
  it("schedules a whole package onto a matching date and adds its estimate", () => {
    const doc = seedDoc();
    const before = dayTotal(doc, idx(doc, "2026-11-23"), 2);
    const next = run(doc, { op: "schedulePackage", key: "kunanyi", date: "2026-11-23" });
    const d = day(next, "2026-11-23");
    expect(d.items.map((i) => i.id)).toEqual(["a04", "a05", "a06"]);
    expect(next.attractionPool.some((p) => p.key === "kunanyi")).toBe(false);
    // a04 ticket AUD 0 pp, a05/a06 no cost, shared fuel 25 / 3 participants × 2 people
    expect(dayTotal(next, idx(next, "2026-11-23"), 2) - before).toBeCloseTo((25 * 2) / 3, 9);
    expect(effectiveDay(d).needsDriver).toBe("Zayden");
  });

  it("rejects a date in another destination", () => {
    const r = applyOp(seedDoc(), { op: "schedulePackage", key: "kunanyi", date: "2026-11-04" });
    expect(r).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects a package whose driver differs from the day's driver", () => {
    const r = applyOp(seedDoc(), { op: "schedulePackage", key: "portarthur", date: "2026-11-09" });
    expect(r).toMatchObject({ ok: false, status: 400 });
  });

  it("schedules a single item without the package costs", () => {
    const doc = seedDoc();
    const before = dayTotal(doc, idx(doc, "2026-11-12"), 2);
    const next = run(doc, { op: "scheduleItem", key: "citywalk", itemId: "a14", date: "2026-11-12" });
    expect(dayTotal(next, idx(next, "2026-11-12"), 2)).toBe(before);
    expect(day(next, "2026-11-12").attached).toBeUndefined();
  });

  it("moving every item of an attached package back restores the day and keeps unrelated edits", () => {
    const doc = seedDoc();
    const i23 = idx(doc, "2026-11-23");
    const totalBefore = dayTotal(doc, i23, 2);
    const warnBefore = warnTexts(doc, "2026-11-23");
    let next = run(doc, { op: "schedulePackage", key: "kunanyi", date: "2026-11-23" });
    next = run(next, { op: "editItem", date: "2026-11-23", itemId: "a05", fields: { note: "改成下午去" } });
    next = run(next, { op: "setPartySize", partySize: 3 });
    for (const id of ["a04", "a05", "a06"]) next = run(next, { op: "unscheduleItem", date: "2026-11-23", itemId: id });
    const d = day(next, "2026-11-23");
    expect(d.items).toEqual([]);
    expect(d.attached).toBeUndefined();
    expect(next.partySize).toBe(3);
    expect(dayTotal(next, i23, 2)).toBe(totalBefore);
    expect(warnTexts(next, "2026-11-23")).toEqual(warnBefore);
    const pkg = next.attractionPool.find((p) => p.key === "kunanyi")!;
    expect(pkg.items.map((i) => i.id).sort()).toEqual(["a04", "a05", "a06"]);
    expect(pkg.items.find((i) => i.id === "a05")!.note).toBe("改成下午去");
    expect(pkg.costs).toHaveLength(1);
    expect(pkg.needsDriver).toBe("Zayden");
  });
});

describe("driver dependencies of single items", () => {
  it("a11 (walk) alone keeps the driver, the 2.5 h drive, the alternative, and is tentative", () => {
    const next = run(seedDoc(), { op: "scheduleItem", key: "mtfield", itemId: "a11", date: "2026-11-12" });
    const e = effectiveDay(day(next, "2026-11-12"));
    expect(e.needsDriver).toBe("Zayden");
    expect(e.driveHrs).toBe(2.5);
    expect(e.alt).toContain("Mount Field");
    expect(isTentative(e, e.items.find((i) => i.id === "a11")!)).toBe(true);
    expect(warnTexts(next, "2026-11-12").some((t) => t.includes("依賴 Zayden"))).toBe(true);
  });

  it("a11 and a12 alone on the same day add the drive once", () => {
    let next = run(seedDoc(), { op: "scheduleItem", key: "mtfield", itemId: "a11", date: "2026-11-12" });
    next = run(next, { op: "scheduleItem", key: "mtfield", itemId: "a12", date: "2026-11-12" });
    expect(effectiveDay(day(next, "2026-11-12")).driveHrs).toBe(2.5);
  });

  it("a04 alone makes the day depend on Zayden and is tentative", () => {
    const next = run(seedDoc(), { op: "scheduleItem", key: "kunanyi", itemId: "a04", date: "2026-11-19" });
    const e = effectiveDay(day(next, "2026-11-19"));
    expect(e.needsDriver).toBe("Zayden");
    expect(isTentative(e, e.items.find((i) => i.id === "a04")!)).toBe(true);
  });

  it("a12 alone on a day with three other majors gives the heavy-day warning", () => {
    let doc = seedDoc();
    // 11/13: add three major activities first.
    for (const name of ["甲", "乙", "丙"]) doc = run(doc, { op: "addItem", date: "2026-11-13", newId: "x" + name.charCodeAt(0), fields: { name } });
    doc = { ...doc, days: doc.days.map((d) => (d.date === "2026-11-13" ? { ...d, items: d.items.filter((i) => i.id.startsWith("x")) } : d)) };
    expect(warnTexts(doc, "2026-11-13").some((t) => t.includes("可能太滿"))).toBe(false);
    const next = run(doc, { op: "scheduleItem", key: "mtfield", itemId: "a12", date: "2026-11-13" });
    expect(warnTexts(next, "2026-11-13").some((t) => t.includes("可能太滿"))).toBe(true);
  });

  it("a confirmation for Zayden does not carry over to JJ", () => {
    let doc = run(seedDoc(), { op: "schedulePackage", key: "kunanyi", date: "2026-11-19" });
    doc = run(doc, { op: "confirmDriver", date: "2026-11-19", window: "08:30–18:00" });
    expect(effectiveDay(day(doc, "2026-11-19")).driverOk).toBe(true);
    for (const id of ["a04", "a05", "a06"]) doc = run(doc, { op: "unscheduleItem", date: "2026-11-19", itemId: id });
    doc = run(doc, { op: "schedulePackage", key: "portarthur", date: "2026-11-19" });
    const e = effectiveDay(day(doc, "2026-11-19"));
    expect(e.needsDriver).toBe("JJ");
    expect(e.driverOk).toBe(false);
    expect(e.staleConfirmation).toBe(true);
    expect(e.items.filter((i) => i.mode === "drive").every((i) => isTentative(e, i))).toBe(true);
  });

  it("rejects a driver confirmation without a valid window", () => {
    const doc = seedDoc();
    for (const w of ["", "18:00–08:00", "8:30-18:00", "abc"]) {
      expect(applyOp(doc, { op: "confirmDriver", date: "2026-11-09", window: w })).toMatchObject({ ok: false, status: 400 });
    }
  });

  it("removing a Must-do activity needs its name as confirmation", () => {
    const doc = seedDoc();
    const must = doc.days.flatMap((d) => d.items.map((i) => ({ d, i }))).find((x) => x.i.pri === "must")!;
    expect(applyOp(doc, { op: "removeItem", date: must.d.date, itemId: must.i.id })).toMatchObject({ ok: false, status: 400 });
    expect(applyOp(doc, { op: "removeItem", date: must.d.date, itemId: must.i.id, confirmMustName: must.i.name }).ok).toBe(true);
  });

  it("shared-cost participants can be edited and change the split", () => {
    const doc = seedDoc();
    const d = doc.days.find((x) => x.costs?.some((c) => c.unit === "shared"))!;
    const ci = d.costs!.findIndex((c) => c.unit === "shared");
    const next = run(doc, { op: "setParticipants", date: d.date, costIndex: ci, participants: 4 });
    const line = budgetLines(next, 2).find((l) => l.day === d.date && l.ci === ci)!;
    expect(line.total).toBeCloseTo((d.costs![ci].amount * 2) / 4, 9);
  });
});

describe("moving activities and booking status", () => {
  it("moves an activity to another day, keeps package costs with it, and locks confirmed bookings", () => {
    const doc = seedDoc();
    const from = doc.days.find((d) => d.seg === "tas" && d.items.length)!;
    const to = doc.days.find((d) => d.seg === "tas" && d !== from)!;
    const id = from.items[0].id;
    const moved = applyOp(structuredClone(doc), { op: "moveItem", date: from.date, itemId: id, toDate: to.date });
    expect(moved.ok && moved.doc.days.find((d) => d.date === to.date)!.items.some((i) => i.id === id)).toBe(true);
    const locked = applyOp(doc, { op: "setStatus", date: from.date, itemId: id, status: "confirmed" });
    expect(locked.ok).toBe(true);
    if (!locked.ok) return;
    const refused = applyOp(locked.doc, { op: "moveItem", date: from.date, itemId: id, toDate: to.date });
    expect(refused.ok).toBe(false);
    const cross = applyOp(seedDoc(), { op: "moveItem", date: from.date, itemId: id, toDate: doc.days.find((d) => d.seg === "syd")!.date });
    expect(cross.ok).toBe(false);
  });
});

describe("removing from a day never loses a place", () => {
  it("moves a non-pool activity back to 「從行程移出的景點」 with its data, and back again", () => {
    const doc = seedDoc();
    const day = doc.days.find((d) => d.items.some((i) => !i.originPackage))!;
    const it = day.items.find((i) => !i.originPackage)!;
    const r = applyOp(doc, { op: "unscheduleItem", date: day.date, itemId: it.id });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const pkg = r.doc.attractionPool.find((p) => p.key === `removed-${day.seg}`)!;
    expect(pkg.title).toBe("從行程移出的景點");
    expect(pkg.items.find((x) => x.id === it.id)?.name).toBe(it.name);
    const back = applyOp(r.doc, { op: "scheduleItem", key: pkg.key, itemId: it.id, date: day.date });
    expect(back.ok && back.doc.days.find((d) => d.date === day.date)!.items.some((x) => x.id === it.id)).toBe(true);
  });
});

describe("confirmed bookings are locked on the server too", () => {
  it("refuses to unschedule or delete a confirmed activity", () => {
    const doc = seedDoc();
    const day = doc.days.find((d) => d.items.length)!;
    const id = day.items[0].id;
    const c = applyOp(doc, { op: "setStatus", date: day.date, itemId: id, status: "confirmed" });
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(applyOp(structuredClone(c.doc), { op: "unscheduleItem", date: day.date, itemId: id }).ok).toBe(false);
    expect(applyOp(structuredClone(c.doc), { op: "removeItem", date: day.date, itemId: id, confirmMustName: day.items[0].name }).ok).toBe(false);
  });
});
