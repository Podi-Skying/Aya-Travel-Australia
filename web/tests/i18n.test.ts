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

  it("never lets a translation of private text reach a public or share view", () => {
    const doc = seedDoc() as TripDoc;
    const home = Object.values(doc.stays).find((s) => (s as { home?: boolean }).home) as { address: string };
    home.address = "999 Secretplace Rd, Hobart TAS 7000";
    const driver = Object.keys(doc.drivers)[0] ?? "Zayden";
    doc.textTr = [
      { zh: home.address, en: "999 Secretplace Rd", ja: "999 Secretplace Rd" },
      { zh: `${driver} 可開車`, en: `${driver} can drive`, ja: "x" },
      { zh: "塔斯馬尼亞", en: "Tasmania", ja: "タスマニア" },
    ];
    for (const photos of [false, true]) {
      const pub = toPublicDoc(doc, { photos });
      const json = JSON.stringify(pub);
      expect(json).not.toContain("Secretplace");
      expect(json).not.toContain(driver);
    }
  });
});


describe("on-screen translation", () => {
  it("keeps sentences, bracket notes and arrows apart", async () => {
    const { makeTranslate } = await import("@/i18n/translate");
    const en = makeTranslate("en");
    const two = en("此日依賴 朋友 開車，但日期與時段尚未確認：開車行程皆為「暫定」。 預估總開車約 4 小時，超過一般日 2–3 小時的建議（提案中，待確認）。");
    expect(two).toContain("About 4 h of driving in total");
    expect(two).not.toMatch(/[㐀-鿿]/);
    expect(en("11/6 雪梨 → 荷巴特（11:45 → 13:35）")).toBe("11/6 Sydney → Hobart (11:45 → 13:35)");
    expect(makeTranslate("ja")("11/6 雪梨 → 荷巴特（11:45 → 13:35）")).not.toContain("雪梨");
  });
});
