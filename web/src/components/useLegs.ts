"use client";

import { useEffect, useState } from "react";
import { api } from "@/client/api";

/*
 * Road legs between a day's stops, read from the server's route cache (PLAN-2026-10-26 §2).
 * The owner's request computes missing legs once; guests only read what is cached.
 * Results are kept per page load so switching days does not ask again.
 */

export type Pt = [number, number];
export type Leg = { distanceM: number; durationS: number; geometry: Pt[]; source: string };

const MAX_POINTS = 25;
const memo = new Map<string, Promise<(Leg | null)[]>>();

export function fetchLegs(points: Pt[]): Promise<(Leg | null)[]> {
  const key = points.map((p) => p.map((n) => n.toFixed(5)).join(",")).join(";");
  let p = memo.get(key);
  if (!p) {
    p = api<{ legs: (Leg | null)[] }>("/api/routes", { method: "POST", body: { points } }).then((r) => (r.ok ? r.data.legs : points.slice(1).map(() => null)));
    memo.set(key, p);
    // A failed or partial answer may fill in later (the owner computes); do not keep it forever.
    void p.then((legs) => legs.some((l) => !l) && memo.delete(key));
  }
  return p;
}

export type Stop = { pt: Pt; drive: boolean };

/**
 * Legs for consecutive stops, aligned with the pairs (stops.length - 1). Only pairs whose destination
 * is reached by car are routed; bus, walk and ferry legs stay null and are never given car times.
 * Each run of consecutive drive legs is one request.
 */
export function useLegs(stops: Stop[] | null): (Leg | null)[] | null {
  const key = stops && stops.length >= 2 ? JSON.stringify(stops.map((s) => [s.pt, s.drive ? 1 : 0])) : "";
  const [state, setState] = useState<{ key: string; legs: (Leg | null)[] } | null>(null);
  useEffect(() => {
    if (!key) return;
    let live = true;
    const list = (JSON.parse(key) as [Pt, number][]).map(([pt, d]) => ({ pt, drive: !!d }));
    const runs: { from: number; pts: Pt[] }[] = [];
    for (let i = 1; i < list.length; i++) {
      if (!list[i].drive) continue;
      const last = runs.at(-1);
      if (last && last.from + last.pts.length - 1 === i - 1) last.pts.push(list[i].pt);
      else runs.push({ from: i - 1, pts: [list[i - 1].pt, list[i].pt] });
    }
    // The API takes at most 25 points: split long runs into chunks that share their end points.
    const chunks = runs.flatMap((r) => {
      const out: { from: number; pts: Pt[] }[] = [];
      for (let a = 0; a < r.pts.length - 1; a += MAX_POINTS - 1) out.push({ from: r.from + a, pts: r.pts.slice(a, a + MAX_POINTS) });
      return out;
    });
    void Promise.all(chunks.map((r) => fetchLegs(r.pts))).then((parts) => {
      if (!live) return;
      const legs: (Leg | null)[] = list.slice(1).map(() => null);
      chunks.forEach((r, k) => parts[k].forEach((l, j) => (legs[r.from + j] = l)));
      setState({ key, legs });
    });
    return () => {
      live = false;
    };
  }, [key]);
  return state && state.key === key ? state.legs : null;
}

export const legLabel = (l: Leg) => {
  const m = Math.round(l.durationS / 60);
  const t = m >= 60 ? `${Math.floor(m / 60)} 小時${m % 60 ? ` ${m % 60} 分` : ""}` : `${m} 分`;
  return `${t}・${l.distanceM >= 10000 ? Math.round(l.distanceM / 1000) : (l.distanceM / 1000).toFixed(1)} 公里`;
};

/**
 * Stops of a day with coordinates; `drive` marks a stop reached by car directly from the previous
 * located stop. An activity without coordinates in between breaks the route (no leg across it).
 */
export function stopsOf(items: { lat?: number; lng?: number; mode: string }[]): Stop[] {
  const out: Stop[] = [];
  let gap = false;
  for (const i of items) {
    if (i.lat == null || i.lng == null) {
      gap = true;
      continue;
    }
    out.push({ pt: [i.lat, i.lng], drive: i.mode === "drive" && !gap });
    gap = false;
  }
  return out;
}

export const ROUTE_CREDIT = "路線 © OSRM・地圖資料 © OpenStreetMap";
