import { parseDate } from "./format";

/* Monday-first month grid for the day picker (DESIGN.md「月曆」). Dates are calendar dates without a time zone. */

export type CalCell = { date: string; day: number; inTrip: boolean; dayIdx: number };

export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Weeks (Monday → Sunday) covering every trip date; cells outside the trip have dayIdx -1. */
export function monthGrid(dates: string[]): CalCell[][] {
  if (!dates.length) return [];
  const idx = new Map(dates.map((d, i) => [d, i]));
  const cur = parseDate(dates[0]);
  cur.setDate(cur.getDate() - ((cur.getDay() + 6) % 7));
  const end = parseDate(dates[dates.length - 1]);
  end.setDate(end.getDate() + ((7 - end.getDay()) % 7));
  const weeks: CalCell[][] = [];
  while (cur <= end) {
    if (!weeks.length || weeks[weeks.length - 1].length === 7) weeks.push([]);
    const date = isoDate(cur);
    const dayIdx = idx.get(date) ?? -1;
    weeks[weeks.length - 1].push({ date, day: cur.getDate(), inTrip: dayIdx >= 0, dayIdx });
    cur.setDate(cur.getDate() + 1);
  }
  return weeks;
}

export function weekIndexOf(grid: CalCell[][], dayIdx: number): number {
  return Math.max(0, grid.findIndex((w) => w.some((c) => c.dayIdx === dayIdx)));
}

/** Grid keyboard movement between trip days; returns the same index when the move leaves the trip. */
export function moveInGrid(grid: CalCell[][], dayIdx: number, key: string): number {
  const flat = grid.flat();
  const at = flat.findIndex((c) => c.dayIdx === dayIdx);
  if (at < 0) return dayIdx;
  const row = Math.floor(at / 7);
  let to = at;
  if (key === "ArrowLeft") to = at - 1;
  else if (key === "ArrowRight") to = at + 1;
  else if (key === "ArrowUp") to = at - 7;
  else if (key === "ArrowDown") to = at + 7;
  else if (key === "Home") to = grid[row].findIndex((c) => c.inTrip) + row * 7;
  else if (key === "End") to = row * 7 + grid[row].map((c) => c.inTrip).lastIndexOf(true);
  const c = flat[to];
  return c?.inTrip ? c.dayIdx : dayIdx;
}

export type DayStatus = "available" | "scheduled" | "pending";

/**
 * Calendar colour status (DESIGN.md「月曆」): no activities → available (green); any activity awaiting
 * confirmation, or a driver day whose driver has not confirmed → pending; otherwise scheduled.
 */
export function dayStatus(day: { items: { status?: string }[]; needsDriver?: string; driverOk?: boolean }): DayStatus {
  if (!day.items.length) return "available";
  if (day.items.some((i) => i.status === "pending") || (day.needsDriver && !day.driverOk)) return "pending";
  return "scheduled";
}
