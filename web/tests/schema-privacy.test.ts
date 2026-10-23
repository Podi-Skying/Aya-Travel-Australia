import { describe, expect, it } from "vitest";
import { seedDoc } from "./helpers";
import { parseTripDoc } from "@/domain/schema";
import { applyOp } from "@/domain/ops";
import { assertPublicSafe, PrivacyGuardError, toPublicDoc } from "@/domain/privacy";
import { effectiveDay } from "@/domain/effective-day";
import { budgetLines, dayTotal } from "@/domain/budget";

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

describe("dates and times (inspection R-01)", () => {
  it("rejects impossible calendar dates and clock times", () => {
    const a = seedDoc();
    a.days[0].date = "2026-02-31";
    expect(parseTripDoc(a).ok).toBe(false);
    const b = seedDoc();
    b.days[0].items[0].time = "99:99";
    expect(parseTripDoc(b).ok).toBe(false);
    const c = seedDoc();
    c.days[0].items[0].time = "24:00";
    expect(parseTripDoc(c).ok).toBe(false);
  });

  it("rejects an impossible time in an item edit", () => {
    const doc = seedDoc();
    const it = doc.days[0].items[0];
    expect(applyOp(doc, { op: "editItem", date: doc.days[0].date, itemId: it.id, fields: { time: "25:10" } })).toMatchObject({ ok: false, status: 400 });
    expect(applyOp(doc, { op: "editItem", date: doc.days[0].date, itemId: it.id, fields: { time: "23:59" } }).ok).toBe(true);
  });
});

describe("inspection 2 findings", () => {
  it("F-01: conflicting package contexts with one key are rejected and still reported as a driver conflict", () => {
    const doc = seedDoc();
    const pkg = doc.attractionPool.find((p) => p.key === "kunanyi")!;
    const day = doc.days.find((d) => d.date === "2026-11-19")!;
    day.items.push(
      { ...pkg.items[0], originPackage: "kunanyi", packageContext: { key: "kunanyi", needsDriver: "Zayden", driveHrs: 1 } },
      { ...pkg.items[1], originPackage: "kunanyi", packageContext: { key: "kunanyi", needsDriver: "JJ", driveHrs: 1 } },
    );
    doc.attractionPool = doc.attractionPool.filter((p) => p.key !== "kunanyi");
    expect(parseTripDoc(doc).ok).toBe(false);
    expect(effectiveDay(day).requiredDrivers.sort()).toEqual(["JJ", "Zayden"]);
  });

  it("a day without activities costs nothing (no implicit meal allowance)", () => {
    const doc = seedDoc();
    const i = doc.days.findIndex((d) => !d.items.length && !(d.costs ?? []).length);
    doc.days[i].stay = "none";
    expect(dayTotal(doc, i, 2)).toBe(0);
    expect(budgetLines(doc, 2).some((l) => l.label === "三餐")).toBe(false);
  });

  it("F-03: driver names are masked and checked case-insensitively", () => {
    const doc = seedDoc();
    doc.days[5].items[0].note = "zayden 和 ＪＪ 會來";
    const json = JSON.stringify(toPublicDoc(doc));
    expect(json.toLowerCase()).not.toContain("zayden");
    expect(json.toLowerCase()).not.toContain("jj");
    expect(() => assertPublicSafe({ note: "ZAYDEN" }, doc)).toThrow(PrivacyGuardError);
  });
});

describe("attraction photos", () => {
  const withPhoto = () => {
    const d = seedDoc();
    d.days[0].items[0].photo = { url: "https://upload.wikimedia.org/x/1920px-a.jpg", w: 1920, h: 1280, page: "https://commons.wikimedia.org/wiki/File:a.jpg", site: "Wikimedia Commons", kind: "commons", license: "CC BY-SA 4.0" };
    return d;
  };

  it("validates photo URLs (https only)", () => {
    expect(parseTripDoc(withPhoto()).ok).toBe(true);
    const bad = withPhoto();
    bad.days[0].items[0].photo!.url = "http://example.com/a.jpg";
    expect(parseTripDoc(bad).ok).toBe(false);
  });

  it("strips photos from the anonymous public doc but keeps them for share links", () => {
    const d = withPhoto();
    expect(JSON.stringify(toPublicDoc(d))).not.toContain('"photo"');
    expect(toPublicDoc(d, { photos: true }).days[0].items[0].photo?.site).toBe("Wikimedia Commons");
  });

  it("lets the owner set or clear a custom photo URL", () => {
    const d = seedDoc();
    const it0 = d.days[0].items[0];
    const set = applyOp(d, { op: "editItem", date: d.days[0].date, itemId: it0.id, fields: { photoUrl: "https://www.example.com/p.jpg" } });
    expect(set.ok && set.doc.days[0].items[0].photo).toMatchObject({ kind: "custom", site: "example.com" });
    const bad = applyOp(d, { op: "editItem", date: d.days[0].date, itemId: it0.id, fields: { photoUrl: "javascript:alert(1)" } });
    expect(bad.ok).toBe(false);
    if (!set.ok) return;
    const cleared = applyOp(set.doc, { op: "editItem", date: d.days[0].date, itemId: it0.id, fields: { photoUrl: "" } });
    expect(cleared.ok && cleared.doc.days[0].items[0].photo).toBeUndefined();
  });
});

describe("owner-only notes and categories", () => {
  it("never sends ownerNote to public documents, and accepts known categories only", () => {
    const d = seedDoc();
    d.days[0].items[0].ownerNote = "QF060 HND 22:00";
    d.days[0].items[0].cat = "lookout";
    expect(parseTripDoc(d).ok).toBe(true);
    for (const pub of [toPublicDoc(d), toPublicDoc(d, { photos: true })]) expect(JSON.stringify(pub)).not.toContain("QF060");
    const bad = applyOp(d, { op: "editItem", date: d.days[0].date, itemId: d.days[0].items[0].id, fields: { cat: "zoo" } });
    expect(bad.ok).toBe(false);
    const ok = applyOp(d, { op: "editItem", date: d.days[0].date, itemId: d.days[0].items[0].id, fields: { cat: "wildlife" } });
    expect(ok.ok && ok.doc.days[0].items[0].cat).toBe("wildlife");
  });
});
