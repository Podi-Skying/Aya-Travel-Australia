import { describe, expect, it } from "vitest";
import { seedDoc } from "./helpers";
import { applyOp } from "@/domain/ops";
import { dayTitle, shortName, UNPLANNED } from "@/domain/day-title";
import { toPublicDoc } from "@/domain/privacy";
import type { Item, TripDoc } from "@/domain/schema";

/* Derived day titles (Kai, 2026-10-26). */

const mk = (name: string, extra: Partial<Item> = {}) => ({ id: name, name, time: "10:00", dur: 60, en: "", pri: "pref", major: true, mode: "walk", travel: {}, verify: "unverified", ...extra }) as Item;

describe("day titles", () => {
  it("an empty day, or one with only a stay note, is 未規劃", () => {
    expect(dayTitle({ title: "火焰灣 → 朗塞斯頓", items: [] })).toBe(UNPLANNED);
    expect(dayTitle({ title: "x", items: [mk("住宿：Bicheno（待確認）")] })).toBe(UNPLANNED);
  });

  it("uses the main stops: first → last on driving days, else the top two, kept short", () => {
    expect(dayTitle({ title: "x", items: [mk("Spiky Bridge 與 Swansea 休息", { mode: "drive" }), mk("Wineglass Bay 酒杯灣觀景台步道", { mode: "drive" }), mk("Honeymoon Bay 夕陽", { mode: "drive" })] })).toMatch(/ → /);
    expect(dayTitle({ title: "x", items: [mk("MONA", { mode: "ferry" }), mk("海濱區散步晚餐", { major: false })] })).toBe("MONA");
    expect([...dayTitle({ title: "x", items: [mk("一二三四五六七八九十一二"), mk("甲乙丙丁戊己庚辛壬癸子丑")] })].length).toBeLessThanOrEqual(18);
    expect(shortName("Balloon Aloft 獵人谷日出熱氣球（考慮中・未預訂）")).toBe("獵人谷日出熱氣球");
    expect(shortName("Kai 有工作（18:00–23:00，固定行程）")).toBe("Kai 工作");
  });

  it("keeps a pinned title until 清空這天 releases it", () => {
    const doc = seedDoc() as TripDoc;
    const date = doc.days.find((d) => d.items.some((i) => i.status !== "confirmed" && i.mode !== "flight"))!.date;
    const r1 = applyOp(doc, { op: "setDayTitle", date, title: "我的一天" });
    if (!r1.ok) throw new Error(r1.error);
    const d1 = r1.doc.days.find((d) => d.date === date)!;
    expect(dayTitle(d1)).toBe("我的一天");
    const r2 = applyOp(r1.doc, { op: "clearDay", date });
    if (!r2.ok) throw new Error(r2.error);
    const d2 = r2.doc.days.find((d) => d.date === date)!;
    expect(d2.titlePinned).toBeUndefined();
    expect(dayTitle(d2)).toBe(d2.items.some((i) => !i.name.startsWith("住宿：")) ? dayTitle({ ...d2 }) : UNPLANNED);
    const r3 = applyOp(r1.doc, { op: "setDayTitle", date, title: "" });
    expect(r3.ok && r3.doc.days.find((d) => d.date === date)!.titlePinned).toBeFalsy();
  });

  it("guest titles come from the redacted document and never contain private names", () => {
    const doc = seedDoc() as TripDoc;
    doc.peopleNames = { friend: "Mina" };
    doc.days[0].items[0].name = "和 Mina 與 Zayden 吃飯";
    const pub = toPublicDoc(doc);
    const titles = pub.days.map((d) => dayTitle(d)).join("|");
    for (const n of ["Mina", ...Object.keys(doc.drivers), "KwanHo"]) expect(titles).not.toContain(n);
  });
});

describe("day title review fixes", () => {
  it("shows a pinned title in full and skips check-in steps", () => {
    const long = "這是一個超過十八個字的自訂標題，用來測試不會被截斷的情況";
    expect(dayTitle({ title: long, titlePinned: true, items: [] })).toBe(long);
    expect(dayTitle({ title: "x", items: [mk("飯店入住"), mk("雪梨歌劇院")] })).toBe("雪梨歌劇院");
  });
});
