"use client";

import { useHours } from "@/client/hours";
import { fmtDay } from "@/domain/format";
import { outsideHours, stopHours } from "@/domain/hours";
import { BookWarn } from "./BookWarn";
import { useTrip } from "./TripApp";

/* 資訊: stops planned outside their opening hours (Kai 2026-11-07). */
export function HoursWarn() {
  const { doc, token, gotoDay } = useTrip();
  const hours = useHours(token);
  const rows = doc.days.flatMap((d, idx) => d.items.flatMap((i) => (outsideHours(i, hours[i.id], d.date) ? [{ d, idx, i }] : [])));
  if (!rows.length) return null;
  return (
    <section className="card section need-book" aria-labelledby="hw-h">
      <h3 id="hw-h">
        <BookWarn flag="不在營業時間內" /> 不在營業時間內 <b>{rows.length}</b>
      </h3>
      <ul>
        {rows.map(({ d, idx, i }) => (
          <li key={`${d.date}-${i.id}`}>
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                gotoDay(idx);
              }}
            >
              {fmtDay(d.date)}
            </a>
            <span className="nb-name">
              {i.time} {i.name}
            </span>
            <span className="small muted">{stopHours(i, hours[i.id], d.date)?.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
