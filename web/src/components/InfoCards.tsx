"use client";

import { useMemo } from "react";
import { useTrip } from "./TripApp";
import { Icon } from "./Icon";
import { CATS } from "./ui";
import { budgetLines, byCategory, stayOf, sum } from "@/domain/budget";
import { displayName } from "@/domain/day-title";
import { fmtDay, fmtMD, mins, money } from "@/domain/format";
import { nightStay } from "@/domain/stay";
import { sizedPhoto } from "./PlaceGallery";

/*
 * 資訊 as pictures (Kai 2026-11-01): flights as boarding passes, stays as cards, the budget as bars.
 * All of it comes from the document this viewer already has, so the privacy tiers are unchanged.
 */

const AIRPORTS: [RegExp, string][] = [
  [/荷巴特|Hobart/i, "HBA"],
  [/雪梨|Sydney/i, "SYD"],
  [/墨爾本|Melbourne/i, "MEL"],
  [/布里斯本|Brisbane/i, "BNE"],
  [/桃園|台北|臺北|Taipei/i, "TPE"],
];

/** Airport codes in the order the text names them, from the visible name and its English form. */
function route(text: string): string[] {
  const found = AIRPORTS.flatMap(([re, code]) => {
    const k = text.search(re);
    return k >= 0 ? [{ k, code }] : [];
  });
  return found.sort((a, b) => a.k - b.k).map((f) => f.code);
}

const addMin = (hhmm: string, m: number) => {
  const [h, n] = hhmm.split(":").map(Number);
  const t = h * 60 + n + m;
  return `${String(Math.floor(t / 60) % 24).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};

export function FlightCards() {
  const { doc } = useTrip();
  const flights = doc.days.flatMap((d) => d.items.filter((i) => i.mode === "flight" && i.dur > 0).map((i) => ({ d, i })));
  if (!flights.length) return null;
  return (
    <section className="section info-block" aria-labelledby="fl-h">
      <h3 id="fl-h">
        <Icon name="plane" size={18} /> 航班
      </h3>
      <ul className="passes">
        {flights.map(({ d, i }) => {
          const codes = route(`${i.en ?? ""} ${i.name}`);
          const named = /(\d{1,2}:\d{2})\s*[→–-]\s*(\d{1,2}:\d{2})/.exec(i.name);
          const dep = named?.[1] ?? i.time;
          const arr = named?.[2] ?? addMin(i.time, i.dur);
          return (
            <li key={i.id} className="pass" role="group" aria-label={`${fmtDay(d.date)} ${displayName(i)}，${dep} 到 ${arr}`}>
              <div className="pass-top">
                <span>{fmtDay(d.date)}</span>
                {i.status === "confirmed" && (
                  <span className="pass-ok">
                    <Icon name="ok" size={16} label="已確認" />
                  </span>
                )}
              </div>
              <div className="pass-route" aria-hidden="true">
                <span>
                  <b>{codes[0] ?? "—"}</b>
                  <time>{dep}</time>
                </span>
                <span className="pass-line">
                  <Icon name="plane" size={18} />
                  <small>{mins(i.dur)}</small>
                </span>
                <span>
                  <b>{codes[1] ?? "—"}</b>
                  <time>{arr}</time>
                </span>
              </div>
              {i.ownerNote && <p className="small muted">{i.ownerNote}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function StayCards() {
  const { doc } = useTrip();
  const stays = useMemo(() => {
    const runs: { key: string; from: string; to: string; nights: number }[] = [];
    for (const d of doc.days) {
      const key = nightStay(doc, d);
      if (key === "none") continue;
      const last = runs.at(-1);
      if (last?.key === key) {
        last.to = d.date;
        last.nights++;
      } else runs.push({ key, from: d.date, to: d.date, nights: 1 });
    }
    return runs;
  }, [doc]);
  if (!stays.length) return null;
  // Stay photos reach only the viewers allowed to see them: the document has none for the rest.
  const photoOf = (key: string, name: string) => doc.days.flatMap((d) => (nightStay(doc, d) === key ? d.items : [])).find((i) => i.name.startsWith("住宿：") && i.name.includes(name.split(" ")[0]) && i.photo)?.photo;
  return (
    <section className="section info-block" aria-labelledby="st-h">
      <h3 id="st-h">
        <Icon name="bed" size={18} /> 住宿
      </h3>
      <ul className="stay-cards">
        {stays.map((r) => {
          const s = stayOf(doc, r.key);
          const name = s.home ? "住處" : s.name.replace(/[（(][^（）()]*[）)]/g, "").trim();
          const ph = photoOf(r.key, name);
          return (
            <li key={`${r.key}-${r.from}`} className="stay-card">
              <span className="stay-pic">
                {ph ? (
                  // eslint-disable-next-line @next/next/no-img-element -- hotlinked photo, see Photos.tsx
                  <img src={sizedPhoto(ph.url, 500, ph.w)} alt="" referrerPolicy="no-referrer" loading="lazy" decoding="async" />
                ) : (
                  <Icon name={s.home ? "home" : "bed"} size={32} />
                )}
              </span>
              <div>
                <strong>{name}</strong>
                <div className="stay-dates">
                  <span role="img" aria-label={`入住 ${fmtMD(r.from)}`}>
                    <Icon name="upload" size={14} /> {fmtMD(r.from)}
                  </span>
                  <span role="img" aria-label={`${r.nights} 晚`}>
                    <Icon name="bed" size={14} /> {r.nights}
                  </span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function BudgetBars() {
  const { doc } = useTrip();
  const N = doc.partySize;
  const lines = useMemo(() => budgetLines(doc, N), [doc, N]);
  const cats = Object.entries(byCategory(lines)).filter(([, v]) => (v as number) > 0) as [string, number][];
  if (!cats.length) return null;
  const top = Math.max(...cats.map(([, v]) => v));
  return (
    <section className="card section budget-bars" aria-labelledby="bd-h">
      <h3 id="bd-h">
        <Icon name="wallet" size={18} /> 預算 <b>{money(Math.round(sum(lines)))}</b>
      </h3>
      <ul>
        {cats
          .sort((a, b) => b[1] - a[1])
          .map(([c, v]) => (
            <li key={c}>
              <span>{CATS[c]?.t ?? c}</span>
              <span className="bar" aria-hidden="true">
                <i style={{ width: `${(v / top) * 100}%` }} className={v === top ? "top" : ""} />
              </span>
              <b>{money(Math.round(v))}</b>
            </li>
          ))}
      </ul>
      <p className="small muted">
        {N} 人・未計入未知價格
      </p>
    </section>
  );
}
