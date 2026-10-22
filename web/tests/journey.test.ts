import { execSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { seedDoc } from "./helpers";
import { chaptersChronological, heroLead, journeyChapters, journeyStats } from "@/domain/journey";
import { toPublicDoc } from "@/domain/privacy";

/* AC15 (data part) and AC12. */

describe("journey page data", () => {
  const doc = seedDoc();
  const chapters = journeyChapters(doc);

  it("orders chapters Sydney first and keeps them chronological", () => {
    expect(chapters.map((c) => c.title)).toEqual(["雪梨", "荷巴特", "東海岸", "荒野"]);
    expect(chaptersChronological(chapters)).toBe(true);
  });

  it("dates each stop by the scheduled day that contains it and skips pool items", () => {
    for (const c of chapters)
      for (const s of c.stops) {
        const day = doc.days.find((d) => d.items.some((i) => i.id === s.itemId))!;
        expect(s.date).toBe(day.date);
      }
    const ids = chapters.flatMap((c) => c.stops.map((s) => s.itemId));
    expect(ids).not.toContain("a04");
    expect(ids).not.toContain("a11");
  });

  it("derives stats and lead text from the document", () => {
    const s = journeyStats(doc);
    expect(s.days).toBe(25);
    expect(s.destinations).toBe(2);
    expect(heroLead(doc)).toMatch(/^25 天的旅程：先到雪梨，再往塔斯馬尼亞/);
  });

  it("works on the public document", () => {
    expect(journeyChapters(toPublicDoc(doc))).toEqual(chapters);
  });

  it("source has no stale journey wording or hard-coded trip dates (AC12, AC15)", () => {
    const src = path.join(__dirname, "..", "src");
    const run = (re: string) => {
      try {
        return execSync(`grep -rnE "${re}" "${src}"`, { encoding: "utf8" });
      } catch {
        return "";
      }
    };
    expect(run("三十三|Interlude|插曲|十一月初飛去雪梨|中途繞去雪梨")).toBe("");
    expect(run("10/25|11/26|11/27|11/3|11/6")).toBe("");
  });
});

describe("route walk data", () => {
  it("uses scheduled days only, in order, and stays redacted on the public document", async () => {
    const { walkDays } = await import("@/domain/walk");
    const doc = seedDoc();
    const days = walkDays(toPublicDoc(doc));
    expect(days).toHaveLength(25);
    expect(days[0].date).toBe("2026-11-03");
    const ids = new Set(doc.attractionPool.flatMap((p) => p.items.map((i) => i.name)));
    expect(days.flatMap((d) => d.items.map((i) => i.name)).some((n) => ids.has(n))).toBe(false);
    expect(JSON.stringify(days)).not.toMatch(/Zayden|JJ/);
  });
});
