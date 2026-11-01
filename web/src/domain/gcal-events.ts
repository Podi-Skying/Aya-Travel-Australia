import type { TripDoc } from "./schema";
import { stayOf, lineAmount } from "./budget";
import { nightStay } from "./stay";
import { bookingFlag } from "./booking";

/*
 * The trip as Google Calendar events (Kai 2026-11-01): one-way, into a dedicated private calendar, so owner
 * details may appear. `key` identifies an event across syncs. Pure, so it can be tested without Google.
 */

const CJK = /[\u3000-\u30ff\u3400-\u9fff\uff00-\uffef]/;

export type CalendarEvent = { key: string; body: Record<string, unknown> };

const pad = (n: number) => String(n).padStart(2, "0");
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

function local(date: string, minutes: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, 0, minutes));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}T${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:00`;
}

function nextDate(date: string): string {
  return local(date, 24 * 60).slice(0, 10);
}

export function calendarEvents(doc: TripDoc, siteUrl = ""): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  const N = doc.partySize;
  // English only: stored translations, and text with no translation is left out rather than shown in Chinese.
  const dict = new Map((doc.textTr ?? []).map((p) => [p.zh, p.en]));
  const en = (raw?: string | string[]): string => {
    const text = Array.isArray(raw) ? raw.join(" ") : raw;
    if (!text) return "";
    const t = CJK.test(text) ? (dict.get(text) ?? "") : text;
    return CJK.test(t) ? "" : t;
  };
  const titleOf = (i: TripDoc["days"][number]["items"][number]) => en(i.tr?.en?.name) || en(i.en) || "Activity";
  for (const d of doc.days) {
    const endsAtHome = !!stayOf(doc, nightStay(doc, d)).home;
    const timed = d.items.filter((i) => !i.name.startsWith("住宿：") && !(i.dur === 0 && i.time === "00:00"));
    timed.forEach((i, k) => {
      // Where the stop is decides the zone; a stop with no position follows where the day ends.
      const inTas = i.lat != null ? i.lat < -40 : d.seg !== "syd" || endsAtHome;
      const timeZone = inTas ? "Australia/Hobart" : "Australia/Sydney";
      const start = toMin(i.time);
      const next = timed[k + 1] ? toMin(timed[k + 1].time) : null;
      const end = i.dur > 0 ? start + i.dur : next !== null && next > start ? next : start + 60;
      const description = [
        en(i.tr?.en?.note ?? i.note),
        en(i.ownerNote),
        i.status === "confirmed" ? "Booked" : i.status === "pending" ? "To confirm" : "",
        i.cost && i.cost.status !== "unknown" ? `Cost: AUD ${lineAmount(i.cost, N)}` : "",
        i.src?.url,
        siteUrl ? `This day: ${siteUrl}/plan?tab=days&day=${d.date}` : "",
      ].filter(Boolean).join("\n");
      out.push({
        key: i.id,
        body: {
          summary: `${bookingFlag(i)?.level === "required" ? "⚠ Not booked: " : ""}${titleOf(i)}`,
          start: { dateTime: local(d.date, start), timeZone },
          end: { dateTime: local(d.date, end), timeZone },
          ...(description ? { description } : {}),
          ...(i.lat != null && i.lng != null ? { location: `${i.lat},${i.lng}` } : {}),
        },
      });
    });
  }
  // Each stay as an all-day event over its nights; Google's end date is exclusive.
  const runs: { key: string; from: string; to: string }[] = [];
  let open = false;
  for (const d of doc.days) {
    const key = nightStay(doc, d);
    if (key === "none") {
      open = false;
      continue;
    }
    const last = runs.at(-1);
    if (open && last?.key === key) last.to = d.date;
    else runs.push({ key, from: d.date, to: d.date });
    open = true;
  }
  for (const r of runs) {
    const st = stayOf(doc, r.key);
    const address = en(st.address);
    const description = [address, en(st.note), st.checkin ? `Check-in ${st.checkin.from}–${st.checkin.to ?? ""}` : ""].filter(Boolean).join("\n");
    out.push({ key: `stay:${r.key}:${r.from}`, body: { summary: `Stay: ${en(st.name) || "Accommodation"}`, start: { date: r.from }, end: { date: nextDate(r.to) }, transparency: "transparent", ...(description ? { description } : {}), ...(address ? { location: address } : {}) } });
  }
  return out;
}
