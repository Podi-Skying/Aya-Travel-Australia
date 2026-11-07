import { describe, expect, it } from "vitest";
import { hoursLineEn, outsideHours, stopHours, toPeriods, type HoursInfo } from "@/domain/hours";

const P = (d: number, o: string, c: string) => ({ d, o, cd: d, c });
const zoo: HoursInfo = { week: [], periods: [1, 2, 3, 4, 5, 6, 0].map((d) => P(d, "10:00", "16:00")) };
const market: HoursInfo = { week: [], periods: [P(6, "08:30", "15:00")] };
const stop = (time: string, extra: Record<string, unknown> = {}) => ({ name: "x", time, dur: 60, mode: "drive", lat: -42, ...extra });

describe("opening hours on a stop", () => {
  it("shows that weekday's hours, or that it is closed", () => {
    expect(stopHours(stop("12:00"), zoo, "2026-11-11")?.text).toBe("週三 10:00–16:00");
    expect(stopHours(stop("12:00"), market, "2026-11-08")).toEqual({ text: "週日 休息", kind: "closed" });
  });
  it("prefers the venue's own hours and shows departures for flights and tours", () => {
    expect(stopHours(stop("10:50", { hours: "11:00 開門" }), zoo, "2026-11-07")?.text).toBe("11:00 開門");
    expect(stopHours(stop("11:45", { mode: "flight" }), undefined, "2026-11-06")?.text).toBe("出發 11:45");
    expect(stopHours(stop("00:00", { mode: "flight", dur: 0 }), undefined, "2026-11-03")).toBeNull();
  });
  it("labels round-the-clock places and outdoor places without hours", () => {
    expect(stopHours(stop("09:00"), { week: [], periods: [{ d: 0, o: "00:00" }] }, "2026-11-12")?.text).toBe("全天開放");
    expect(stopHours(stop("09:00", { cat: "beach" }), undefined, "2026-11-12")?.text).toBe("戶外・無營業時間");
  });
  it("flags a plan outside the hours, allowing a short wait before opening", () => {
    expect(outsideHours(stop("12:00"), zoo, "2026-11-11")).toBe(false);
    expect(outsideHours(stop("09:50"), zoo, "2026-11-11")).toBe(false);
    expect(outsideHours(stop("16:30"), zoo, "2026-11-11")).toBe(true);
    expect(outsideHours(stop("12:00"), market, "2026-11-08")).toBe(true);
    expect(outsideHours(stop("12:00"), { week: [], periods: [], status: "CLOSED_PERMANENTLY" }, "2026-11-08")).toBe(true);
  });
  it("gives the calendar an English line", () => {
    expect(hoursLineEn(zoo, "2026-11-11")).toBe("Hours: Wed 10:00–16:00");
    expect(hoursLineEn(market, "2026-11-08")).toBe("Hours: Sun closed");
  });
  it("reads Google's periods", () => {
    expect(toPeriods([{ open: { day: 3, hour: 10, minute: 0 }, close: { day: 3, hour: 16, minute: 0 } }])).toEqual([{ d: 3, o: "10:00", cd: 3, c: "16:00" }]);
  });
});
