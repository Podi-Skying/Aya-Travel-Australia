import { describe, expect, it } from "vitest";
import { seedDoc } from "./helpers";
import { toPublicDoc } from "@/domain/privacy";
import { contentDict } from "@/i18n/content";
import { setRenderLang, t } from "@/i18n/current";
import { fmtDay, mins } from "@/domain/format";
import { parseTripDoc, type TripDoc } from "@/domain/schema";

/* 繁中 / EN / 日本語 (2026-10-27) */

describe("languages", () => {
  it("looks up UI text and fills placeholders, falling back to Chinese", () => {
    setRenderLang("en");
    expect(t("距離出發還有 {n} 天", { n: 8 })).toBe("8 days to go");
    expect(t("這句沒有翻譯")).toBe("這句沒有翻譯");
    expect(mins(90)).toBe("1 h 30 min");
    expect(fmtDay("2026-11-16")).toBe("Mon 16/11");
    setRenderLang("ja");
    expect(t("每日行程")).toBe("毎日の予定");
    expect(fmtDay("2026-11-16")).toBe("11/16（月）");
    setRenderLang("zh");
    expect(mins(90)).toBe("1 小時30 分");
  });

  it("stores content translations and redacts them like the Chinese text", () => {
    const doc = seedDoc() as TripDoc;
    const homeName = Object.values(doc.stays).find((s) => (s as { home?: boolean }).home)!.name;
    const it0 = doc.days.find((d) => d.items.length)!.items[0];
    it0.tr = { en: { name: `Check in at ${homeName}` }, ja: { name: `${homeName} にチェックイン` } };
    const driver = Object.keys(doc.drivers)[0];
    if (driver) it0.note = `${driver} 開車`;
    if (driver) it0.tr.en!.note = `${driver} drives`;
    expect(parseTripDoc(doc).ok).toBe(true);
    const dict = contentDict(doc);
    expect(dict.en[it0.name]).toBe(`Check in at ${homeName}`);
    const pub = toPublicDoc(doc);
    const json = JSON.stringify(pub);
    expect(json).not.toContain(homeName);
    if (driver) expect(json).not.toContain(driver);
    const p0 = pub.days.find((d) => d.items.some((i) => i.id === it0.id))!.items.find((i) => i.id === it0.id)!;
    expect(p0.tr?.en?.name).toBe("Check in at our place");
    expect(p0.tr?.ja?.name).toBe("宿泊先 にチェックイン");
    if (driver) expect(p0.tr?.en?.note).toBe("a friend drives");
  });
});
