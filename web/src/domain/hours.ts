/* Opening hours on a stop (Kai 2026-11-07: plans change on the day, so show when places are open). */

/** One opening period; days 0 = Sunday (Google's numbering), times "HH:MM"; no close = open around the clock. */
export type Period = { d: number; o: string; cd?: number; c?: string };
/** Cached Google hours for a place: Monday-first weekday lines, periods, and the business status. */
export type HoursInfo = { week: string[]; periods: Period[]; status?: string };

const WD_ZH = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];
const WD_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const OUTDOOR = new Set(["nature", "beach", "lookout"]);
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
export const dowOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

type Stop = { hours?: string; time: string; dur: number; mode: string; cat?: string; name: string; status?: string; book?: string; tour?: unknown; lat?: number };

export const alwaysOpen = (h?: HoursInfo) => !!h?.periods.some((p) => p.d === 0 && p.o === "00:00" && !p.c);
const periodsOn = (h: HoursInfo, dow: number) => h.periods.filter((p) => p.d === dow);
const span = (ps: Period[]) => ps.map((p) => `${p.o}–${p.c ?? "24:00"}`).join("、");

export type ShownHours = { text: string; kind: "venue" | "google" | "always" | "closed" | "outdoor" | "booked" };

/** What a stop shows on its card: the venue's own hours first, then Google's hours for that weekday. */
export function stopHours(i: Stop, h: HoursInfo | undefined, date: string): ShownHours | null {
  const wd = WD_ZH[dowOf(date)];
  if (i.hours?.trim()) return { text: i.hours.trim(), kind: "venue" };
  // A whole-day note (00:00, no length) is not a departure.
  if (i.mode === "flight" || i.tour) return i.dur === 0 && i.time === "00:00" ? null : { text: `出發 ${i.time}`, kind: "booked" };
  if (h?.status === "CLOSED_PERMANENTLY") return { text: "已永久歇業", kind: "closed" };
  if (h && alwaysOpen(h)) return { text: "全天開放", kind: "always" };
  if (h?.periods.length) {
    const ps = periodsOn(h, dowOf(date));
    return ps.length ? { text: `${wd} ${span(ps)}`, kind: "google" } : { text: `${wd} 休息`, kind: "closed" };
  }
  if (i.status === "confirmed" && i.book && i.book !== "none") return { text: `預訂 ${i.time}`, kind: "booked" };
  if (i.lat != null && (OUTDOOR.has(i.cat ?? "") || /步道|散步|Walk|海灘|Beach|觀景/.test(i.name))) return { text: "戶外・無營業時間", kind: "outdoor" };
  return null;
}

/** The planned time falls outside that day's hours (15 minutes' wait before opening is fine), or the place is closed. */
export function outsideHours(i: Stop, h: HoursInfo | undefined, date: string): boolean {
  if (!h || i.hours?.trim() || i.mode === "flight" || i.tour) return false;
  if (h.status === "CLOSED_PERMANENTLY") return true;
  if (!h.periods.length || alwaysOpen(h)) return false;
  const ps = periodsOn(h, dowOf(date));
  if (!ps.length) return true;
  const t = toMin(i.time);
  return !ps.some((p) => t >= toMin(p.o) - 15 && (!p.c || p.cd !== p.d || t < toMin(p.c)));
}

/** The calendar's English line, e.g. "Hours: Wed 10:00–16:00". */
export function hoursLineEn(h: HoursInfo | undefined, date: string): string {
  if (!h) return "";
  const wd = WD_EN[dowOf(date)];
  if (h.status === "CLOSED_PERMANENTLY") return "Hours: permanently closed";
  if (alwaysOpen(h)) return "Hours: open 24 hours";
  if (!h.periods.length) return "";
  const ps = periodsOn(h, dowOf(date));
  return ps.length ? `Hours: ${wd} ${ps.map((p) => `${p.o}–${p.c ?? "24:00"}`).join(", ")}` : `Hours: ${wd} closed`;
}

/** Google's period object → ours. */
export function toPeriods(raw: { open?: { day?: number; hour?: number; minute?: number }; close?: { day?: number; hour?: number; minute?: number } }[] = []): Period[] {
  const hm = (x?: { hour?: number; minute?: number }) => `${String(x?.hour ?? 0).padStart(2, "0")}:${String(x?.minute ?? 0).padStart(2, "0")}`;
  return raw.filter((p) => p.open?.day != null).map((p) => ({ d: p.open!.day!, o: hm(p.open), ...(p.close ? { cd: p.close.day ?? p.open!.day!, c: hm(p.close) } : {}) }));
}
