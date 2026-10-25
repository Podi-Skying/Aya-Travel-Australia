import SunCalc from "suncalc";

/*
 * Night-sky conditions for aurora and bioluminescence watching (PLAN-2026-10-26 §1).
 * Pure calculations with suncalc; nothing is fetched or cached.
 */

export const HOBART = { lat: -42.8821, lng: 147.3272 };
const TZ = "Australia/Hobart";
const STEP = 15 * 60_000;

export const hobartTime = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);

/** Noon in Hobart on a YYYY-MM-DD date, as an instant (Hobart is UTC+11 in November). */
function hobartNoon(date: string): Date {
  const guess = new Date(`${date}T01:00:00Z`);
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false }).format(guess));
  return new Date(guess.getTime() + (12 - h) * 3_600_000);
}

export type NightSky = {
  date: string;
  /** Moon illumination 0–100. */
  moonPct: number;
  /** Astronomical dusk on this date and dawn the next morning (Hobart time, HH:MM). */
  dusk: string | null;
  dawn: string | null;
  /** Hours of astronomical darkness with the moon below the horizon. */
  darkHrs: number;
  /** The same dusk and dawn as instants (ISO), for matching forecast slots. */
  duskAt: string | null;
  dawnAt: string | null;
};

export function nightSky(date: string, at = HOBART): NightSky {
  const noon = hobartNoon(date);
  const today = SunCalc.getTimes(noon, at.lat, at.lng);
  const tomorrow = SunCalc.getTimes(new Date(noon.getTime() + 86_400_000), at.lat, at.lng);
  const dusk = today.night && !Number.isNaN(today.night.getTime()) ? today.night : null;
  const dawn = tomorrow.nightEnd && !Number.isNaN(tomorrow.nightEnd.getTime()) ? tomorrow.nightEnd : null;
  let dark = 0;
  if (dusk && dawn)
    for (let t = dusk.getTime(); t < dawn.getTime(); t += STEP) if (SunCalc.getMoonPosition(new Date(t), at.lat, at.lng).altitude < 0) dark += STEP;
  const midnight = new Date(noon.getTime() + 12 * 3_600_000);
  return {
    date,
    moonPct: Math.round(SunCalc.getMoonIllumination(midnight).fraction * 100),
    dusk: dusk ? hobartTime(dusk) : null,
    dawn: dawn ? hobartTime(dawn) : null,
    darkHrs: Math.round((dark / 3_600_000) * 10) / 10,
    duskAt: dusk?.toISOString() ?? null,
    dawnAt: dawn?.toISOString() ?? null,
  };
}

/**
 * The night's aurora outlook: the highest Kp among 3-hour forecast slots that overlap the night's
 * astronomical darkness. A daytime peak never counts for the night.
 */
export function nightKp<T extends { time: string; kp: number }>(night: Pick<NightSky, "duskAt" | "dawnAt">, slots: T[]): T | null {
  if (!night.duskAt || !night.dawnAt) return null;
  const a = Date.parse(night.duskAt);
  const b = Date.parse(night.dawnAt);
  let best: T | null = null;
  for (const s of slots) {
    const t = Date.parse(s.time);
    if (t < b && t + 3 * 3_600_000 > a && (!best || s.kp > best.kp)) best = s;
  }
  return best;
}

/** Rule of thumb for Tasmania (labelled as such in the UI). */
export function kpChance(kp: number): { t: string; c: string } {
  if (kp >= 6) return { t: "機會高", c: "b-ok" };
  if (kp >= 5) return { t: "可能（往南看、遠離光害）", c: "b-info" };
  return { t: "低", c: "b-line" };
}
