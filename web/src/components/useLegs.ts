"use client";

import { useEffect, useState } from "react";
import { api } from "@/client/api";
import { getLang } from "@/i18n/current";

/*
 * Road legs between a day's stops, read from the server's route cache (PLAN-2026-10-26 §2).
 * The owner's request computes missing legs once; guests only read what is cached.
 * Results are kept per page load so switching days does not ask again.
 */

export type Pt = [number, number];
export type Travel = "driving" | "walking" | "transit";

/** How a stop is reached when not by car: walking, public transport, or nothing to route (ferry, flight). */
export const softTravel = (mode?: string): Exclude<Travel, "driving"> | null => (mode === "walk" ? "walking" : mode && ["train", "bus", "transit"].includes(mode) ? "transit" : null);

/** Walking and transit pairs of a route (driving legs go through driveChunks). */
function softPairs(list: Stop[]): { at: number; pts: Pt[]; mode: Travel }[] {
  const out: { at: number; pts: Pt[]; mode: Travel }[] = [];
  for (let i = 1; i < list.length; i++) {
    const m = list[i].drive ? null : softTravel(list[i].mode);
    if (m && !list[i].gap) out.push({ at: i - 1, pts: [list[i - 1].pt, list[i].pt], mode: m });
  }
  return out;
}
export type Leg = { distanceM: number; durationS: number; geometry: Pt[]; source: string };

const MAX_POINTS = 25;

const memo = new Map<string, Promise<(Leg | null)[]>>();

const LEGS_EVENT = "aya-legs-updated";

/** Owner action 「計算道路路線」: computes the missing drive legs once; they are stored server side. */
export async function computeLegs(stops: Stop[]): Promise<boolean> {
  let ok = true;
  for (const c of driveChunks(stops)) {
    const r = await api<{ legs: (Leg | null)[] }>("/api/routes", { method: "POST", body: { points: c.pts, compute: true } });
    if (!r.ok || r.data.legs.some((l) => !l)) ok = false;
  }
  for (const c of softPairs(stops)) {
    const r = await api<{ legs: (Leg | null)[] }>("/api/routes", { method: "POST", body: { points: c.pts, compute: true, mode: c.mode } });
    if (!r.ok || r.data.legs.some((l) => !l)) ok = false;
  }
  memo.clear();
  dispatchEvent(new Event(LEGS_EVENT));
  return ok;
}

/** Runs of consecutive drive legs, split into ≤25-point chunks that share their end points. */
function driveChunks(list: Stop[]): { from: number; pts: Pt[] }[] {
  const runs: { from: number; pts: Pt[] }[] = [];
  for (let i = 1; i < list.length; i++) {
    if (!list[i].drive) continue;
    const last = runs.at(-1);
    if (last && last.from + last.pts.length - 1 === i - 1) last.pts.push(list[i].pt);
    else runs.push({ from: i - 1, pts: [list[i - 1].pt, list[i].pt] });
  }
  return runs.flatMap((r) => {
    const out: { from: number; pts: Pt[] }[] = [];
    for (let a = 0; a < r.pts.length - 1; a += MAX_POINTS - 1) out.push({ from: r.from + a, pts: r.pts.slice(a, a + MAX_POINTS) });
    return out;
  });
}

export function fetchLegs(points: Pt[], mode: Travel = "driving"): Promise<(Leg | null)[]> {
  const key = mode + ":" + points.map((p) => p.map((n) => n.toFixed(5)).join(",")).join(";");
  let p = memo.get(key);
  if (!p) {
    p = api<{ legs: (Leg | null)[] }>("/api/routes", { method: "POST", body: mode === "driving" ? { points } : { points, mode } }).then((r) => (r.ok ? r.data.legs : points.slice(1).map(() => null)));
    memo.set(key, p);
    // A failed or partial answer may fill in later (after 「計算道路路線」); do not keep it.
    void p.then((legs) => legs.some((l) => !l) && memo.delete(key));
  }
  return p;
}

/** `mode` is how the stop is reached (walk, train, …); `gap` marks a stop after an activity with no position. */
export type Stop = { pt: Pt; drive: boolean; mode?: string; gap?: boolean };

/**
 * Legs for consecutive stops, aligned with the pairs (stops.length - 1). Only pairs whose destination
 * is reached by car are routed; bus, walk and ferry legs stay null and are never given car times.
 * Each run of consecutive drive legs is one request.
 */
export function useLegs(stops: Stop[] | null): (Leg | null)[] | null {
  const key = stops && stops.length >= 2 ? JSON.stringify(stops.map((s) => [s.pt, s.drive ? 1 : 0, s.mode ?? "", s.gap ? 1 : 0])) : "";
  const [state, setState] = useState<{ key: string; legs: (Leg | null)[] } | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const on = () => setVersion((v) => v + 1);
    addEventListener(LEGS_EVENT, on);
    return () => removeEventListener(LEGS_EVENT, on);
  }, []);
  useEffect(() => {
    if (!key) return;
    let live = true;
    const list = (JSON.parse(key) as [Pt, number, string, number][]).map(([pt, d, mode, gap]) => ({ pt, drive: !!d, mode, gap: !!gap }));
    const chunks = driveChunks(list);
    const soft = softPairs(list);
    void Promise.all([Promise.all(chunks.map((r) => fetchLegs(r.pts))), Promise.all(soft.map((s) => fetchLegs(s.pts, s.mode)))]).then(([parts, softParts]) => {
      if (!live) return;
      const legs: (Leg | null)[] = list.slice(1).map(() => null);
      chunks.forEach((r, k) => parts[k].forEach((l, j) => (legs[r.from + j] = l)));
      soft.forEach((s, k) => (legs[s.at] = softParts[k][0] ?? null));
      setState({ key, legs });
    });
    return () => {
      live = false;
    };
  }, [key, version]);
  return state && state.key === key ? state.legs : null;
}

export const legLabel = (l: Leg) => {
  const m = Math.round(l.durationS / 60);
  const [H, M, KM, SEP] = ({ zh: [" 小時", " 分", " 公里", "・"], en: [" h", " min", " km", " · "], ja: ["時間", "分", " km", "・"] } as const)[getLang()];
  const t = m >= 60 ? `${Math.floor(m / 60)}${H}${m % 60 ? ` ${m % 60}${M}` : ""}` : `${m}${M}`;
  return `${t}${SEP}${l.distanceM >= 10000 ? Math.round(l.distanceM / 1000) : (l.distanceM / 1000).toFixed(1)}${KM}`;
};

/**
 * Stops of a day with coordinates (and passing `keep`); `drive` marks a stop reached by car directly
 * from the previous stop. Any skipped activity in between breaks the route (no leg across it).
 */
export function stopsOf<T extends { lat?: number; lng?: number; mode: string }>(items: T[], keep: (i: T) => boolean = () => true): Stop[] {
  const out: Stop[] = [];
  let gap = false;
  for (const i of items) {
    // Activities without a position, or not drawn on this map, break the route like a gap.
    if (i.lat == null || i.lng == null || !keep(i)) {
      gap = true;
      continue;
    }
    out.push({ pt: [i.lat, i.lng], drive: i.mode === "drive" && !gap });
    gap = false;
  }
  return out;
}

export const ROUTE_CREDIT = "路線 © OSRM・地圖資料 © OpenStreetMap";

/** Credits for every route source drawn (a day can mix OSRM and Google legs). */
export function routeCredit(legs: (Leg | null)[]): string {
  const src = new Set(legs.map((l) => l?.source));
  return [src.has("google-routes") && "路線 © Google", src.has("osrm-demo") && ROUTE_CREDIT].filter(Boolean).join("；");
}

export type RouteStop = Stop & { kind: "start" | "item" | "end"; name: string; mode: string; itemId?: string };

/**
 * A day as a route (Kai 2026-10-26): from last night's stay, through the stops with a position, back to
 * tonight's stay. The first and last legs are driven when the day's first or last stop is reached by car.
 * Stay notes (「住宿：」) are not stops; the stay itself is the end.
 */
export function routeStops<T extends { id: string; name: string; lat?: number; lng?: number; mode: string }>(
  items: T[],
  ends: { start: { lat: number; lng: number; name: string } | null; end: { lat: number; lng: number; name: string } | null },
): RouteStop[] {
  const out: RouteStop[] = [];
  if (ends.start) out.push({ pt: [ends.start.lat, ends.start.lng], drive: false, kind: "start", name: ends.start.name, mode: "start" });
  let gap = false;
  for (const i of items) {
    if (i.name.startsWith("住宿：")) continue;
    if (i.lat == null || i.lng == null) {
      gap = true;
      continue;
    }
    out.push({ pt: [i.lat, i.lng], drive: i.mode === "drive" && !gap && out.length > 0, gap: gap || out.length === 0, kind: "item", name: i.name, mode: i.mode, itemId: i.id });
    gap = false;
  }
  const lastItem = [...out].reverse().find((s) => s.kind === "item");
  // A skipped activity after the last located stop breaks the route like any gap (no routed leg across it).
  if (ends.end) out.push({ pt: [ends.end.lat, ends.end.lng], drive: lastItem?.mode === "drive" && !gap, gap, kind: "end", name: ends.end.name, mode: lastItem?.mode ?? "walk" });
  // A stay and the first/last stop at the same spot make no leg.
  return out.filter((s, k) => k === 0 || s.pt[0] !== out[k - 1].pt[0] || s.pt[1] !== out[k - 1].pt[1]);
}
