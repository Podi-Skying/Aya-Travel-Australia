import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { loadLegacyData, readLegacyApp } from "../scripts/legacy";
import { budgetLines, byCategory, dayTotal, sum } from "@/domain/budget";
import { checks, feasibility } from "@/domain/rules";
import { effectiveDay, isTentative } from "@/domain/effective-day";
import type { TripDoc } from "@/domain/schema";

/*
 * AC3: runs the real legacy functions from site/js/app.js (extracted between the
 * "rules" and "header" markers) and the TypeScript ports on the same data.
 */

const START = "/* ---------- rules";
const END = "/* ---------- header ----------";
const WINDOW = "08:30–18:00";

function legacyFns(days: unknown[], partySize: number) {
  const app = readLegacyApp();
  const a = app.indexOf(START);
  const b = app.indexOf(END);
  if (a < 0 || b < 0 || b <= a) throw new Error("legacy markers not found in site/js/app.js");
  const code = app.slice(a, b);
  const data = loadLegacyData();
  const sandbox: Record<string, unknown> = { DATA: data, S: { days, partySize }, out: null };
  vm.runInNewContext(
    `const SHARE = false;
     function driverLabel(d) { return SHARE ? "朋友" : d.needsDriver; }
     function stayOf(d) { return DATA.stays[d.stay] || DATA.stays.none; }
     ${code}
     out = { checks, feasibility, isTentative, budgetLines, dayTotal };`,
    sandbox,
  );
  return sandbox.out as {
    checks: (d: unknown) => { lv: string; t: string; alt?: string }[];
    feasibility: (d: unknown) => string;
    isTentative: (d: unknown, i: unknown) => boolean;
    budgetLines: (N: number) => { cat: string; total: number; idx: number }[];
    dayTotal: (idx: number, N: number) => number;
  };
}

function variants(confirmed: boolean) {
  const data = loadLegacyData();
  const legacyDays = data.days.map((d: Record<string, unknown>) => (confirmed && d.needsDriver ? { ...d, driverOk: true, driverWindow: WINDOW } : d));
  const doc = {
    ...data,
    partySize: 2,
    attractionPool: [],
    days: data.days.map((d: Record<string, unknown>) =>
      confirmed && d.needsDriver ? { ...d, driverConfirmation: { driver: d.needsDriver, window: WINDOW } } : d,
    ),
  } as TripDoc;
  return { legacyDays, doc };
}

describe("legacy parity (AC3)", () => {
  for (const confirmed of [false, true]) {
    for (const N of [1, 2, 3, 4, 6]) {
      it(`budget totals match for party size ${N}, drivers ${confirmed ? "confirmed" : "unconfirmed"}`, () => {
        const { legacyDays, doc } = variants(confirmed);
        const L = legacyFns(legacyDays, N);
        const legacyLines = L.budgetLines(N);
        const lines = budgetLines(doc, N);
        expect(lines.length).toBe(legacyLines.length);
        expect(sum(lines)).toBeCloseTo(legacyLines.reduce((a, l) => a + l.total, 0), 9);
        const legacyCats: Record<string, number> = {};
        legacyLines.forEach((l) => (legacyCats[l.cat] = (legacyCats[l.cat] || 0) + l.total));
        const cats = byCategory(lines);
        expect(Object.keys(cats).sort()).toEqual(Object.keys(legacyCats).sort());
        for (const k of Object.keys(cats)) expect(cats[k]).toBeCloseTo(legacyCats[k], 9);
        doc.days.forEach((_, idx) => expect(dayTotal(doc, idx, N)).toBeCloseTo(L.dayTotal(idx, N), 9));
      });
    }

    it(`checks, feasibility and tentative labels match, drivers ${confirmed ? "confirmed" : "unconfirmed"}`, () => {
      const { legacyDays, doc } = variants(confirmed);
      const L = legacyFns(legacyDays, 2);
      doc.days.forEach((d, idx) => {
        const e = effectiveDay(d);
        const ours = checks(doc, e, { showWindow: true }).map((c) => ({ lv: c.lv, t: c.t, alt: c.alt }));
        const theirs = L.checks(legacyDays[idx]).map((c) => ({ lv: c.lv, t: c.t, alt: c.alt }));
        expect(ours, d.date).toEqual(theirs);
        expect(feasibility(doc, e), d.date).toBe(L.feasibility(legacyDays[idx]));
        d.items.forEach((it, k) => expect(isTentative(e, it), `${d.date} ${it.id}`).toBe(!!L.isTentative(legacyDays[idx], legacyDays[idx].items[k])));
      });
    });
  }
});
