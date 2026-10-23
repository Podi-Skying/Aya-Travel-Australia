import { describe, expect, it } from "vitest";
import { monthGrid, moveInGrid, weekIndexOf } from "@/domain/calendar";

const trip = Array.from({ length: 25 }, (_, i) => `2026-11-${String(3 + i).padStart(2, "0")}`);

describe("calendar grid", () => {
  const grid = monthGrid(trip);

  it("covers 11/3–11/27 in four Monday-first weeks (11/2–11/29)", () => {
    expect(grid).toHaveLength(4);
    expect(grid.every((w) => w.length === 7)).toBe(true);
    expect(grid[0][0].date).toBe("2026-11-02");
    expect(grid[3][6].date).toBe("2026-11-29");
    expect(grid[0][0].inTrip).toBe(false);
    expect(grid[0][1]).toMatchObject({ date: "2026-11-03", inTrip: true, dayIdx: 0 });
    expect(grid.flat().filter((c) => c.inTrip)).toHaveLength(25);
  });

  it("finds the week of a day", () => {
    expect(weekIndexOf(grid, 0)).toBe(0);
    expect(weekIndexOf(grid, 6)).toBe(1); // 11/9 is a Monday
  });

  it("moves by arrow keys and stays inside the trip", () => {
    expect(moveInGrid(grid, 2, "ArrowRight")).toBe(3);
    expect(moveInGrid(grid, 2, "ArrowDown")).toBe(9);
    expect(moveInGrid(grid, 0, "ArrowLeft")).toBe(0); // 11/2 is outside the trip
    expect(moveInGrid(grid, 0, "ArrowUp")).toBe(0);
    expect(moveInGrid(grid, 24, "ArrowDown")).toBe(24);
    expect(moveInGrid(grid, 3, "Home")).toBe(0);
    expect(moveInGrid(grid, 3, "End")).toBe(5);
    expect(moveInGrid(grid, 22, "End")).toBe(24); // last row ends 11/27 (Fri)
  });
});

describe("calendar day status", () => {
  it("is available without activities, pending with a pending item or an unconfirmed driver, else scheduled", async () => {
    const { dayStatus } = await import("@/domain/calendar");
    expect(dayStatus({ items: [] })).toBe("available");
    expect(dayStatus({ items: [{}] })).toBe("scheduled");
    expect(dayStatus({ items: [{ status: "pending" }] })).toBe("pending");
    expect(dayStatus({ items: [{}], needsDriver: "X", driverOk: false })).toBe("pending");
    expect(dayStatus({ items: [{ status: "confirmed" }], needsDriver: "X", driverOk: true })).toBe("scheduled");
  });
});
