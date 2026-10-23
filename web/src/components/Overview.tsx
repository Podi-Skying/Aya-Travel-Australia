"use client";

import { useTrip } from "./TripApp";
import { Badge } from "./ui";
import { Icon, MODE_ICON } from "./Icon";
import type { Item } from "@/domain/schema";
import { effectiveDay } from "@/domain/effective-day";
import { checks } from "@/domain/rules";
import { budgetLines, stayOf, sum } from "@/domain/budget";
import { fmtDay, fmtMD, money } from "@/domain/format";

export function Overview() {
  const { doc, mode, gotoDay } = useTrip();
  const N = doc.partySize;
  const lines = budgetLines(doc, N);
  const total = sum(lines);
  const eff = doc.days.map(effectiveDay);
  const hasWarn = (i: number) => checks(doc, eff[i], { showWindow: false }).some((c) => c.lv === "warn");
  const must = doc.days.flatMap((d, idx) => d.items.filter((i) => i.pri === "must" && i.major).map((i) => ({ i, idx })));
  const pendingDriver = eff.filter((d) => d.needsDriver && !d.driverOk);
  const openDays = doc.days.filter((d) => !d.items.length);
  const paid = doc.days.filter((d) => stayOf(doc, d.stay).nightly > 0 && stayOf(doc, d.stay).status !== "confirmed");
  const paidAreas = [...new Set(paid.map((d) => stayOf(doc, d.stay).area))];
  const warnDays = eff.filter((_, i) => hasWarn(i)).length;
  const flights = doc.days.flatMap((d) => d.items.filter((i) => i.mode === "flight" && i.cost?.status !== "confirmed").map((i) => `${fmtMD(d.date)} ${i.name}`));
  const poolCount = doc.attractionPool.reduce((a, p) => a + p.items.length, 0);

  const todo: string[] = [];
  if (mode === "owner" && pendingDriver.length) todo.push(`與司機確認可開車的日期與時段（${pendingDriver.length} 天依賴司機）`);
  if (paid.length) todo.push(`預訂需付費住宿（${paid.length} 晚：${paidAreas.join("、")}）`);
  if (flights.length) todo.push(`確認並預訂航班：${flights.join("；")}`);
  todo.push("出發前查看國家公園、道路與天氣警示（見「資訊與警示」）");
  if (openDays.length) todo.push(`${openDays.length} 天尚未安排，可保留休息或從「待安排景點」加入`);
  if (poolCount) todo.push(`待安排景點還有 ${poolCount} 個活動`);

  const segs = Object.entries(doc.segments).filter(([k]) => doc.days.some((d) => d.seg === k));
  const firstOf = (k: string) => doc.days.findIndex((d) => d.seg === k);
  segs.sort((a, b) => firstOf(a[0]) - firstOf(b[0]));
  const axis = [doc.days[0], ...segs.slice(1).map(([k]) => doc.days[firstOf(k)]), doc.days.at(-1)!];

  return (
    <>
      <div className="grid cols-4">
        <div className="card stat">
          <div className="num">{doc.days.length}</div>
          <div className="lbl">旅程天數</div>
        </div>
        <div className="card stat">
          <div className="num">{must.length}</div>
          <div className="lbl">必去活動</div>
        </div>
        <div className="card stat">
          <div className="num">{money(total)}</div>
          <div className="lbl">預估總花費（{N} 人，估計）</div>
        </div>
        <div className="card stat">
          <div className="num">{warnDays}</div>
          <div className="lbl">有提醒的日子</div>
        </div>
      </div>

      <div className="card section">
        <h2>旅程時間軸</h2>
        <p className="muted small">點一格看當天；淡色是尚未安排，點點是有提醒。</p>
        <div className="timeline-mini">
          {doc.days.map((d, i) => (
            <button
              key={d.date}
              type="button"
              className={`${d.seg} ${d.items.length ? "" : "open"} ${hasWarn(i) ? "has-warn" : ""}`}
              title={`${fmtDay(d.date)} ${d.title}`}
              aria-label={`${fmtDay(d.date)} ${d.title}${hasWarn(i) ? "（有提醒）" : ""}`}
              onClick={() => gotoDay(i)}
            />
          ))}
        </div>
        <div className="tl-axis">
          {axis.map((d, k) => (
            <span key={k}>
              {fmtMD(d.date)}
              {k > 0 && k < axis.length - 1 ? ` ${doc.segments[d.seg]?.name ?? ""}` : ""}
            </span>
          ))}
        </div>
      </div>

      <div className="grid cols-2 section">
        {segs.map(([k, s]) => {
          const ds = doc.days.filter((d) => d.seg === k);
          const segTotal = sum(lines.filter((l) => l.seg === k));
          return (
            <div className="card seg-card" key={k}>
              <span className="bar" style={{ background: s.color }} />
              <h3>
                {s.name} <span className="muted small">{s.en}</span>
              </h3>
              <p className="muted">
                {s.range}・{ds.length} 天・{ds.reduce((a, d) => a + d.items.filter((i) => i.major).length, 0)} 個主要活動
              </p>
              <p>
                預估花費 <strong>{money(segTotal)}</strong> <Badge t="估計" c="b-warn" />
              </p>
            </div>
          );
        })}
      </div>

      <div className="card section">
        <h3>必去清單</h3>
        <ul className="must-grid">
          {must.slice(0, 4).map(({ i, idx }) => (
            <MustCard key={i.id} item={i} date={doc.days[idx].date} onOpen={() => gotoDay(idx)} />
          ))}
        </ul>
        {must.length > 4 && (
          <details className="day-summary">
            <summary>看全部 {must.length} 個</summary>
            <ul className="must-grid">
              {must.slice(4).map(({ i, idx }) => (
                <MustCard key={i.id} item={i} date={doc.days[idx].date} onOpen={() => gotoDay(idx)} />
              ))}
            </ul>
          </details>
        )}
      </div>

      <div className="card section">
        <h3>下一步待辦</h3>
        <ol className="todo-list">
          {todo.slice(0, 3).map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ol>
        {todo.length > 3 && (
          <details className="day-summary">
            <summary>還有 {todo.length - 3} 項</summary>
            <ol className="todo-list" start={4}>
              {todo.slice(3).map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ol>
          </details>
        )}
      </div>

      {mode === "owner" && (
        <details className="card section day-summary">
          <summary>
            <h3>司機安排</h3>
          </summary>
          <p className="muted small">依規則：司機的日期與時段確認之前，開車行程一律為「暫定」，並提供替代方案。</p>
          <div className="grid cols-2">
            {Object.entries(doc.drivers).map(([n, dr]) => {
              const ds = eff.filter((d) => d.needsDriver === n);
              const ok = ds.filter((d) => d.driverOk).length;
              return (
                <div key={n}>
                  <strong>{n}</strong>・{dr.label}
                  <br />
                  <span className="muted small">{dr.note}</span>
                  <br />
                  <Badge t={`已確認 ${ok} / ${ds.length} 天`} c={ok === ds.length ? "b-ok" : "b-warn"} />
                </div>
              );
            })}
          </div>
        </details>
      )}
    </>
  );
}

/** A must-see stop with its photo (owner and share links only; others get an icon tile). */
function MustCard({ item, date, onOpen }: { item: Item; date: string; onOpen: () => void }) {
  return (
    <li>
      <button type="button" className="must-card" onClick={onOpen}>
        {item.photo ? (
          // eslint-disable-next-line @next/next/no-img-element -- hotlinked photo, see Photos.tsx
          <img src={item.photo.url} alt="" referrerPolicy="no-referrer" loading="lazy" decoding="async" />
        ) : (
          <span className="ph-icon" aria-hidden="true">
            <Icon name={MODE_ICON[item.mode] ?? "pin"} size={22} />
          </span>
        )}
        <span className="t">
          <span className="d">{fmtDay(date)}</span>
          {item.name}
        </span>
      </button>
    </li>
  );
}
