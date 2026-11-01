"use client";

import { bookingFlag } from "@/domain/booking";
import { fmtDay, fmtMD } from "@/domain/format";
import { BookWarn } from "./BookWarn";
import { useTrip } from "./TripApp";

/* 資訊: everything still to book, in date order. Owner and share links only. */
export function NeedBooking() {
  const { doc, gotoDay } = useTrip();
  const rows = doc.days.flatMap((d, idx) => d.items.flatMap((i) => { const flag = bookingFlag(i); return flag ? [{ d, idx, i, flag }] : []; }));
  if (!rows.length) return null;
  return (
    <section className="card section need-book" aria-labelledby="nb-h">
      <h3 id="nb-h">
        <BookWarn flag="需要預訂" /> 需要預訂 <b>{rows.length}</b>
      </h3>
      <ul>
        {rows.map(({ d, idx, i, flag }) => (
          <li key={i.id}>
            <BookWarn flag={flag} size={16} />
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                gotoDay(idx);
              }}
            >
              {fmtDay(d.date)}
            </a>
            <span className="nb-name">{i.name}</span>
            {i.bookBy && <span className="small muted">≤ {fmtMD(i.bookBy)}</span>}
            {i.src?.url && (
              <a href={i.src.url} target="_blank" rel="noopener noreferrer">
                預訂
              </a>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
