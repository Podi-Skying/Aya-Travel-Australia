import { isLogistics } from "./day-title";
import { km } from "./quiz";
import type { Item } from "./schema";

/*
 * Kai's own photos (docs/PHOTOS-PLAN.md): which trip day and which activity a photo belongs to.
 * Pure, so the server decides (never the browser) and tests need no clock.
 */

/** Sydney and Hobart share one zone (AEDT, UTC+11 in November 2026), so one zone covers every trip day. */
export const TRIP_TZ = "Australia/Sydney";
const SLACK_MIN = 15;

export type TimeSource = "exif" | "filename" | "none";

function validDate(y: number, m: number, d: number) {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** 'YYYY-MM-DDTHH:mm' wall time in the trip zone for an instant. */
export function tripWallTime(at: Date): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: TRIP_TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/**
 * EXIF DateTimeOriginal ('YYYY:MM:DD HH:MM:SS', or a Date that exifr built from it) plus the optional
 * OffsetTimeOriginal ('+11:00'). With an offset the instant is moved to the trip zone; without one the
 * camera's wall time is kept (the phone was on local time).
 */
export function exifLocal(raw: string | null | undefined, offset?: string | null): { local: string; at: string | null } | null {
  const m = raw?.match(/^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (!validDate(y, mo, d) || h > 23 || mi > 59) return null;
  const wall = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`;
  const off = offset?.match(/^([+-])(\d{2}):?(\d{2})$/);
  if (!off) return { local: wall, at: null };
  const mins = (off[1] === "-" ? -1 : 1) * (Number(off[2]) * 60 + Number(off[3]));
  const at = new Date(Date.UTC(y, mo - 1, d, h, mi) - mins * 60_000);
  return { local: tripWallTime(at), at: at.toISOString() };
}

/**
 * A date in a file name: the first 8-digit 20YYMMDD group that is a real date (dji_export_20261115_photo_0034,
 * IMG_20261115_143012, 20261115_143012). A 6-digit HHMMSS right after it gives the time.
 */
export function fileNameLocal(name: string): { local: string; hasTime: boolean } | null {
  for (const m of name.matchAll(/(?<!\d)(20\d{2})(\d{2})(\d{2})(?!\d)(?:[_-](\d{2})(\d{2})(\d{2})(?!\d))?/g)) {
    const [y, mo, d] = [m[1], m[2], m[3]].map(Number);
    if (!validDate(y, mo, d)) continue;
    const date = `${m[1]}-${m[2]}-${m[3]}`;
    const h = m[4] ? Number(m[4]) : NaN;
    const mi = m[5] ? Number(m[5]) : NaN;
    if (h <= 23 && mi <= 59) return { local: `${date}T${m[4]}:${m[5]}`, hasTime: true };
    return { local: date, hasTime: false };
  }
  return null;
}

/** The trip day for a wall time, or null (未分類) when the date is not one of the trip's days. */
export function dayFor(local: string | null | undefined, days: { date: string }[]): string | null {
  const date = local?.slice(0, 10);
  return date && days.some((d) => d.date === date) ? date : null;
}

const toMin = (hhmm: string) => {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/**
 * The activity whose time window (start − 15 min to end + 15 min) contains the photo's time. Non-logistics
 * activities win over getting somewhere; on overlap the nearest by GPS when both sides have a position,
 * else the later start. Null without a time or a match.
 */
export function itemFor(local: string | null | undefined, items: Item[], pos?: { lat: number; lng: number } | null): string | null {
  const t = local && local.length >= 16 ? toMin(local.slice(11)) : null;
  if (t == null) return null;
  const hits = items.filter((i) => {
    const s = i.time ? toMin(i.time) : null;
    if (s == null) return false;
    return t >= s - SLACK_MIN && t <= s + (i.dur ?? 0) + SLACK_MIN;
  });
  const doing = hits.filter((i) => !isLogistics(i));
  const pool = doing.length ? doing : hits;
  if (!pool.length) return null;
  const start = (i: Item) => toMin(i.time!)!;
  const sorted = [...pool].sort((a, b) => {
    if (pos && a.lat != null && a.lng != null && b.lat != null && b.lng != null)
      return km([pos.lat, pos.lng], [a.lat, a.lng]) - km([pos.lat, pos.lng], [b.lat, b.lng]);
    return start(b) - start(a);
  });
  return sorted[0].id;
}
