import { useEffect, useState } from "react";
import { api } from "./api";
import type { DayWx } from "@/domain/weather";

/*
 * Trip weather for every component (one request per page, kept 15 minutes). The server caches Open-Meteo
 * for 3 hours, so this never reaches Open-Meteo directly.
 */

export type TripWeather = { days: { date: string; place: string; wx: DayWx | null; unavailable?: boolean }[]; source: string; url: string; fetchedAt: string | null; stale: boolean; horizonEnd: string };

let memo: { at: number; p: Promise<TripWeather | null> } | null = null;

export function loadWeather(): Promise<TripWeather | null> {
  if (memo && Date.now() - memo.at < 15 * 60_000) return memo.p;
  const p = api<TripWeather>("/api/weather").then((r) => (r.ok ? r.data : null));
  memo = { at: Date.now(), p };
  void p.then((v) => !v && (memo = null));
  return p;
}

export function useWeather(): TripWeather | null {
  const [w, setW] = useState<TripWeather | null>(null);
  useEffect(() => {
    let live = true;
    void loadWeather().then((v) => live && setW(v));
    return () => {
      live = false;
    };
  }, []);
  return w;
}
