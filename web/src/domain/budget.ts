import type { Cost, TripDoc } from "./schema";
import { effectiveDay } from "./effective-day";
import { nightStay } from "./stay";

/*
 * Ports of lineAmount / basis / budgetLines / dayTotal from site/js/app.js (FR-13〜17).
 * Since 2026-10-23 a day costs only what its activities, attached package costs and stay cost:
 * there is no implicit daily meal allowance any more (meals count only as activities).
 */

export type LineCost = Pick<Cost, "amount" | "unit" | "status" | "note" | "participants">;

export type BudgetLine = {
  day: string;
  seg: string;
  idx: number;
  ci?: number;
  cat: string;
  label: string;
  c: LineCost;
  total: number;
};

export function lineAmount(c: LineCost, N: number): number {
  if (c.status === "unknown") return 0;
  if (c.unit === "pp") return c.amount * N;
  if (c.unit === "shared") {
    const p = Math.max(c.participants || N, N);
    return (c.amount * N) / p;
  }
  return c.amount;
}

export function basis(c: LineCost, N: number): string {
  if (c.unit === "pp") return `每人 $${c.amount} × ${N} 人`;
  if (c.unit === "shared") {
    const p = Math.max(c.participants || N, N);
    return `共乘 $${c.amount} ÷ ${p} 人 × ${N} 人`;
  }
  if (c.unit === "night") return `每晚 $${c.amount}`;
  return `整組 $${c.amount}`;
}

export function stayOf(doc: Pick<TripDoc, "stays">, key: string) {
  return doc.stays[key] || doc.stays.none || { name: "", area: "", address: "", nightly: 0, status: "confirmed" as const, note: "" };
}

export function budgetLines(doc: TripDoc, N: number): BudgetLine[] {
  const lines: BudgetLine[] = [];
  doc.days.forEach((raw, idx) => {
    const d = effectiveDay(raw);
    // The night's stay is derived: the home base unless a multi-day trip takes them elsewhere.
    const night = nightStay(doc, raw);
    d.items.forEach((i) => {
      if (i.cost) lines.push({ day: d.date, seg: d.seg, idx, cat: i.cost.cat, label: i.name, c: i.cost, total: 0 });
    });
    d.costs.forEach((c, ci) => lines.push({ day: d.date, seg: d.seg, idx, ci, cat: c.cat, label: c.label ?? "", c, total: 0 }));
    // What the owner covers for a friend who drives (labels never name the driver).
    const drv = d.needsDriver ? doc.drivers[d.needsDriver] : undefined;
    for (const what of drv?.covers ?? []) {
      if (what === "fuel" && drv?.fuel && d.driveHrs > 0) {
        const km = Math.round(d.driveHrs * drv.fuel.kmPerHour);
        const amount = Math.round(((km * drv.fuel.lPer100) / 100) * drv.fuel.price);
        lines.push({ day: d.date, seg: d.seg, idx, cat: "transport", label: "Kai 負擔：油費", c: { amount, unit: "group", status: "estimate", note: `約 ${km} 公里（車程 ${d.driveHrs} 小時估算）× ${drv.fuel.lPer100}L/100km × AUD ${drv.fuel.price}/L（${drv.fuel.source}）` }, total: 0 });
      }
      if (what === "stay" && night !== "none") {
        const st = stayOf(doc, night);
        if (st.nightly > 0)
          lines.push({ day: d.date, seg: d.seg, idx, cat: "stay", label: "Kai 負擔：司機住宿", c: { amount: st.nightly, unit: "night", status: "estimate", note: "假設司機另住一間同價位的房" }, total: 0 });
      }
      if (what === "tickets") {
        const t = d.items.filter((i) => i.cost && i.cost.cat === "tickets" && i.cost.unit === "pp" && i.cost.status !== "unknown");
        const amount = t.reduce((a, i) => a + i.cost!.amount, 0);
        if (amount > 0)
          lines.push({ day: d.date, seg: d.seg, idx, cat: "tickets", label: "Kai 負擔：司機門票", c: { amount, unit: "group", status: "estimate", note: `司機一人份：${t.map((i) => i.name).join("、")}` }, total: 0 });
      }
    }
    const st = stayOf(doc, night);
    if (night !== "none")
      lines.push({ day: d.date, seg: d.seg, idx, cat: "stay", label: st.name, c: { amount: st.nightly, unit: "night", status: st.status, note: st.note }, total: 0 });
  });
  lines.forEach((l) => {
    l.total = lineAmount(l.c, N);
  });
  return lines;
}

export function dayTotal(doc: TripDoc, idx: number, N: number): number {
  return budgetLines(doc, N)
    .filter((l) => l.idx === idx)
    .reduce((a, l) => a + l.total, 0);
}

export function sum(lines: BudgetLine[]): number {
  return lines.reduce((a, l) => a + l.total, 0);
}

export function byCategory(lines: BudgetLine[]): Record<string, number> {
  const out: Record<string, number> = {};
  lines.forEach((l) => {
    out[l.cat] = (out[l.cat] || 0) + l.total;
  });
  return out;
}

/** Estimated cost of an unscheduled package (items + package costs), not counted in trip totals. */
export function packageEstimate(pkg: { items: { cost?: Cost }[]; costs: Cost[] }, N: number): number {
  return (
    pkg.items.reduce((a, i) => a + (i.cost ? lineAmount(i.cost, N) : 0), 0) + pkg.costs.reduce((a, c) => a + lineAmount(c, N), 0)
  );
}
