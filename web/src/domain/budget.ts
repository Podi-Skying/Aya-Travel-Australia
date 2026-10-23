import type { Cost, TripDoc } from "./schema";
import { effectiveDay } from "./effective-day";

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
    d.items.forEach((i) => {
      if (i.cost) lines.push({ day: d.date, seg: d.seg, idx, cat: i.cost.cat, label: i.name, c: i.cost, total: 0 });
    });
    d.costs.forEach((c, ci) => lines.push({ day: d.date, seg: d.seg, idx, ci, cat: c.cat, label: c.label ?? "", c, total: 0 }));
    const st = stayOf(doc, d.stay);
    if (d.stay !== "none")
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
