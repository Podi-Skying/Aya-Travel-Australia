import { describe, expect, it } from "vitest";
import { displayName, nameIsTentative } from "@/domain/day-title";

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
