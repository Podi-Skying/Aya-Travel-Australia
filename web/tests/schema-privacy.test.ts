import { describe, expect, it } from "vitest";
import { seedDoc } from "./helpers";
import { parseTripDoc } from "@/domain/schema";
import { applyOp } from "@/domain/ops";
import { assertPublicSafe, PrivacyGuardError, toPublicDoc } from "@/domain/privacy";
import { effectiveDay } from "@/domain/effective-day";

describe("schema", () => {
  it("rejects duplicate item ids within a day and across day/pool", () => {
    const a = seedDoc();
    a.days[0].items.push({ ...a.days[0].items[0] });
    expect(parseTripDoc(a).ok).toBe(false);
    const b = seedDoc();
    b.attractionPool[0].items.push({ ...b.days[0].items[0] });
    expect(parseTripDoc(b).ok).toBe(false);
  });

  it("rejects empty or malformed driver windows", () => {
    for (const window of ["", "  ", "18:00-08:00", "noon"]) {
      const d = seedDoc();
      const i = d.days.findIndex((x) => x.needsDriver);
      (d.days[i] as Record<string, unknown>).driverConfirmation = { driver: d.days[i].needsDriver, window };
      expect(parseTripDoc(d).ok, window).toBe(false);
    }
  });
});

describe("privacy filter (AC6)", () => {
  const forbidden = (doc: ReturnType<typeof seedDoc>, json: string) => {
    expect(json).not.toMatch(/Zayden|JJ/);
    expect(json).not.toMatch(/"address"|"driverConfirmation"/);
    for (const s of Object.values(doc.stays)) if (s.address.trim()) expect(json).not.toContain(s.address.trim());
  };

  it("hides addresses, drivers and windows for the seed and after scheduling and confirming", () => {
    let doc = seedDoc();
    doc.stays.utas.address = "123 Secret Street, Hobart";
    forbidden(doc, JSON.stringify(toPublicDoc(doc)));
    const steps = [
      { op: "scheduleItem", key: "mtfield", itemId: "a11", date: "2026-11-12" },
      { op: "schedulePackage", key: "kunanyi", date: "2026-11-23" },
      { op: "confirmDriver", date: "2026-11-23", window: "07:45–19:15" },
    ] as const;
    for (const s of steps) {
      const r = applyOp(doc, s);
      if (!r.ok) throw new Error(r.error);
      doc = r.doc;
      const json = JSON.stringify(toPublicDoc(doc));
      forbidden(doc, json);
      expect(json).not.toContain("07:45");
    }
    const pub = toPublicDoc(doc);
    const d = pub.days.find((x) => x.date === "2026-11-23")!;
    expect(effectiveDay(d).driverOk).toBe(true);
    expect(effectiveDay(d).needsDriver).toBe("朋友");
  });

  it("masks driver names written in free text", () => {
    const doc = seedDoc();
    doc.days[5].items[0].note = "Zayden 會帶冰桶";
    expect(JSON.stringify(toPublicDoc(doc))).toContain("朋友 會帶冰桶");
  });

  it("the guard ignores empty addresses and fails closed on leftovers", () => {
    const doc = seedDoc();
    expect(() => assertPublicSafe({ stays: { x: { name: "a" } } }, doc)).not.toThrow();
    doc.stays.utas.address = "9 Hidden Rd";
    expect(() => assertPublicSafe({ note: "9 Hidden Rd" }, doc)).toThrow(PrivacyGuardError);
    expect(() => assertPublicSafe({ who: "Zayden" }, doc)).toThrow(PrivacyGuardError);
    expect(() => assertPublicSafe({ address: "" }, doc)).toThrow(PrivacyGuardError);
  });
});
