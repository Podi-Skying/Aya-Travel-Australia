import { describe, expect, it } from "vitest";
import { routeStops } from "@/components/useLegs";
import { daySegments, dayNavUrls, MAX_WAYPOINTS, navMode, navUrl } from "@/domain/nav";

/* Day route from and to the stay, and navigation links (2026-10-26) */

const home = { lat: -42.87991, lng: 147.32469, name: "住處" };
const mk = (id: string, mode: string, lat?: number, lng?: number, name = id) => ({ id, name, mode, lat, lng });

describe("day route", () => {
  it("starts at last night's stay, drives to the first stop, and returns to tonight's stay", () => {
    const r = routeStops([mk("a", "drive", -42.12, 148.07), mk("b", "drive", -42.15, 148.3), mk("stay", "drive", undefined, undefined, "住宿：Bicheno")], { start: home, end: { lat: -41.87, lng: 148.3, name: "Bicheno by the Bay" } });
    expect(r.map((s) => s.kind)).toEqual(["start", "item", "item", "end"]);
    expect(r.map((s) => s.drive)).toEqual([false, true, true, true]);
    expect(r[3].name).toBe("Bicheno by the Bay");
  });

  it("walks back on a walking day and drops a zero-length leg", () => {
    const r = routeStops([mk("a", "walk", -42.887, 147.331), mk("b", "walk", -42.887, 147.331)], { start: home, end: home });
    expect(r.map((s) => s.kind)).toEqual(["start", "item", "end"]);
    expect(r.at(-1)!.drive).toBe(false);
  });

  it("builds Google Maps links without an origin when it is omitted, and splits long days", () => {
    const u = navUrl(null, { lat: -42.15, lng: 148.3 }, "driving");
    expect(u).toMatch(/^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=-42\.15000%2C148\.30000&travelmode=driving$/);
    expect(navUrl(null, { query: "UTAS Hobart Apartments" }, "driving")).toContain("destination=UTAS+Hobart+Apartments");
    const pts = Array.from({ length: 15 }, (_, k) => ({ lat: -42 - k / 100, lng: 147 }));
    const urls = dayNavUrls(pts, "driving", { lat: -42.88, lng: 147.32 });
    expect(urls).toHaveLength(2);
    expect(new URL(urls[0]).searchParams.get("waypoints")!.split("|")).toHaveLength(MAX_WAYPOINTS);
    expect(new URL(urls[1]).searchParams.get("origin")).toBe(new URL(urls[0]).searchParams.get("destination"));
    expect(navMode("walk")).toBe("walking");
    expect(navMode("train")).toBe("transit");
  });

  it("splits whole-day links where the mode changes and skips flights", () => {
    const p = (k: number) => ({ lat: -42 - k / 10, lng: 148 });
    const segs = daySegments([p(0), p(1), p(2), p(3), p(4)], ["driving", "driving", "walking", null], null);
    expect(segs.map((s) => s.mode)).toEqual(["driving", "walking"]);
    expect(new URL(segs[0].urls[0]).searchParams.get("origin")).toBeNull();
    expect(new URL(segs[1].urls[0]).searchParams.get("origin")).toBe("-42.20000,148.00000");
    expect(navMode("flight")).toBeNull();
  });

  it("keeps a gap before tonight's stay when the last activity has no position", () => {
    const r = routeStops([mk("a", "drive", -42.12, 148.07), mk("b", "drive")], { start: home, end: { lat: -41.87, lng: 148.3, name: "Bicheno" } });
    expect(r.at(-1)).toMatchObject({ kind: "end", drive: false });
  });
});
