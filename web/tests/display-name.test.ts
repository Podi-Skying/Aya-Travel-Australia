import { describe, expect, it } from "vitest";
import { longestDrive } from "@/domain/rules";
import { dayCoverTitle, displayName, nameIsTentative } from "@/domain/day-title";

describe("displayName", () => {
  it("drops bracketed status notes", () => {
    expect(displayName({ name: "獵人谷日出熱氣球（考慮中・未預訂）" })).toBe("獵人谷日出熱氣球");
    expect(displayName({ name: "住宿：St Helens（待確認）" })).toBe("住宿：St Helens");
  });
  it("keeps other brackets", () => {
    expect(displayName({ name: "The Gardens（火焰灣北端）" })).toBe("The Gardens（火焰灣北端）");
    expect(displayName({ name: "Kai 上班（18:00–23:00，固定）" })).toBe("Kai 上班（18:00–23:00，固定）");
  });
  it("says when the name itself is unsettled", () => {
    expect(nameIsTentative({ name: "熱氣球（考慮中・未預訂）" })).toBe(true);
    expect(nameIsTentative({ name: "The Gardens（火焰灣北端）" })).toBe(false);
  });
});

describe("dayCoverTitle", () => {
  it("keeps full stop names", () => {
    const stop = (name: string) => ({ name, major: true, mode: "drive", pri: "pref" }) as never;
    expect(dayCoverTitle({ title: "x", items: [stop("Bay of Fires 火焰灣（Binalong Bay）"), stop("Little Blue Lake 藍湖")] })).toBe("Bay of Fires 火焰灣 → Little Blue Lake 藍湖");
  });
});

describe("longestDrive", () => {
  it("resets only after a stop of 30 minutes or more", () => {
    expect(longestDrive([{ driveMin: 100, stopMin: 15 }, { driveMin: 60, stopMin: 30 }, { driveMin: 90, stopMin: 0 }])).toBe(160);
    expect(longestDrive([{ driveMin: 120, stopMin: 30 }, { driveMin: 120, stopMin: 45 }])).toBe(120);
  });
});
