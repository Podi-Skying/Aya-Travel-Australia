import type { TripDoc } from "./schema";
import { stayOf, lineAmount } from "./budget";
import { nightStay } from "./stay";

/*
 * The trip as Google Calendar events (Kai 2026-11-01): one-way, into a dedicated private calendar, so owner
 * details may appear. `key` identifies an event across syncs. Pure, so it can be tested without Google.
 */

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
  for (const d of doc.days) {
    const timeZone = d.seg === "syd" ? "Australia/Sydney" : "Australia/Hobart";
    const timed = d.items.filter((i) => !i.name.startsWith("住宿：") && !(i.dur === 0 && i.time === "00:00"));
    timed.forEach((i, k) => {
      const start = toMin(i.time);
      const next = timed[k + 1] ? toMin(timed[k + 1].time) : null;
      const end = i.dur > 0 ? start + i.dur : next !== null && next > start ? next : start + 60;
      const description = [
        i.note,
        i.ownerNote,
        i.status === "confirmed" ? "已確認" : i.status === "pending" ? "待確認" : "",
        i.cost && i.cost.status !== "unknown" ? `AUD ${lineAmount(i.cost, N)}` : "",
        i.src?.url,
        siteUrl ? `${siteUrl}/plan?tab=days&day=${d.date}` : "",
      ].filter(Boolean).join("\n");
      out.push({
        key: i.id,
        body: {
          summary: i.name,
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
    const description = [st.address, st.note, st.checkin ? `入住 ${st.checkin.from}–${st.checkin.to ?? ""}` : ""].filter(Boolean).join("\n");
    out.push({ key: `stay:${r.key}:${r.from}`, body: { summary: `住宿：${st.name}`, start: { date: r.from }, end: { date: nextDate(r.to) }, transparency: "transparent", ...(description ? { description } : {}), ...(st.address ? { location: st.address } : {}) } });
  }
  return out;
}
