import type { TripDoc } from "@/domain/schema";

/*
 * Trip content translations (Kai 2026-10-27) as lookup tables for the on-screen translator: the Chinese text
 * of each name, note, title and summary → its stored English / Japanese translation (`tr` fields).
 */

type Tr = { tr?: Partial<Record<"en" | "ja", Record<string, string | string[] | undefined>>> };

export function contentDict(doc: Pick<TripDoc, "days" | "attractionPool" | "tripOptions" | "textTr">): Record<"en" | "ja", Record<string, string>> {
  const out: Record<"en" | "ja", Record<string, string>> = { en: {}, ja: {} };
  const add = (o: Tr | undefined, field: string, zh: string | undefined) => {
    if (!o?.tr || !zh) return;
    for (const l of ["en", "ja"] as const) {
      const v = o.tr[l]?.[field];
      if (typeof v === "string" && v) out[l][zh.trim()] = v;
    }
  };
  const items = [...doc.days.flatMap((d) => d.items), ...doc.attractionPool.flatMap((p) => p.items)];
  for (const i of items) {
    add(i as Tr, "name", i.name);
    add(i as Tr, "note", i.note);
  }
  for (const d of doc.days) add(d as Tr, "title", d.title);
  for (const p of doc.attractionPool) add(p as Tr, "title", p.title);
  for (const o of doc.tripOptions ?? []) {
    add(o as Tr, "title", o.title);
    add(o as Tr, "summary", o.summary);
    const days = (o as Tr).tr;
    o.days.forEach((od, k) => {
      for (const l of ["en", "ja"] as const) {
        const v = days?.[l]?.days;
        if (Array.isArray(v) && v[k]) out[l][od.title.trim()] = v[k];
      }
    });
  }
  for (const p of doc.textTr ?? []) {
    if (p.en) out.en[p.zh.trim()] = p.en;
    if (p.ja) out.ja[p.zh.trim()] = p.ja;
  }
  return out;
}
