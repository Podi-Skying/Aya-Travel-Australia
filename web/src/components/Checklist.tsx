"use client";

import { useTrip } from "./TripApp";
import { Badge } from "./ui";
import { effectiveDay } from "@/domain/effective-day";
import { stayOf } from "@/domain/budget";
import { fmtDay, fmtMD } from "@/domain/format";

/*
 * 待確認、下一步待辦與司機安排 — moved from the removed 總覽 tab (2026-10-26) to 資訊與警示.
 */
export function Checklist() {
  const { doc, mode, gotoDay } = useTrip();
  const eff = doc.days.map(effectiveDay);
  const pendingDriver = eff.filter((d) => d.needsDriver && !d.driverOk);
  const openDays = doc.days.filter((d) => !d.items.length);
  const paid = doc.days.filter((d) => stayOf(doc, d.stay).nightly > 0 && stayOf(doc, d.stay).status !== "confirmed");
  const paidAreas = [...new Set(paid.map((d) => stayOf(doc, d.stay).area))];
  const flights = doc.days.flatMap((d) => d.items.filter((i) => i.mode === "flight" && i.cost?.status !== "confirmed").map((i) => `${fmtMD(d.date)} ${i.name}`));
  const poolCount = doc.attractionPool.reduce((a, p) => a + p.items.length, 0);

  // Everything awaiting confirmation: unconfirmed driver days, pending activities, and places still to arrange.
  const pending: { key: string; idx: number; t: string }[] = [
    ...eff.flatMap((d, idx) => (d.needsDriver && !d.driverOk ? [{ key: `drv-${d.date}`, idx, t: `${mode === "owner" ? d.needsDriver : "朋友"}開車的時段（${d.title}）` }] : [])),
    ...doc.days.flatMap((d, idx) => d.items.filter((i) => i.status === "pending").map((i) => ({ key: i.id, idx, t: i.name }))),
    ...doc.attractionPool.filter((p) => p.key === "arrange").flatMap((p) => p.items.map((i) => ({ key: i.id, idx: -1, t: i.name }))),
  ];

  const todo: string[] = [];
  if (mode === "owner" && pendingDriver.length) todo.push(`與司機確認可開車的日期與時段（${pendingDriver.length} 天依賴司機）`);
  if (paid.length) todo.push(`預訂需付費住宿（${paid.length} 晚：${paidAreas.join("、")}）`);
  if (flights.length) todo.push(`確認並預訂航班：${flights.join("；")}`);
  todo.push("出發前查看國家公園、道路與天氣警示（見下方官方來源）");
  if (openDays.length) todo.push(`${openDays.length} 天尚未安排，可保留休息或從「推薦行程方案」「地圖與景點」加入`);
  if (poolCount) todo.push(`待安排景點還有 ${poolCount} 個活動`);

  return (
    <div className="grid cols-2 section checklist">
      <div className="card">
        <h3>待確認（{pending.length}）</h3>
        {pending.length ? (
          <ul className="todo-list pending-list">
            {pending.map((x) => (
              <li key={x.key}>
                {x.idx >= 0 ? (
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      gotoDay(x.idx);
                    }}
                  >
                    {fmtDay(doc.days[x.idx].date)}
                  </a>
                ) : (
                  <span className="muted">未排日期</span>
                )}{" "}
                {x.t}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">目前沒有待確認的事項。</p>
        )}
      </div>
      <div className="card">
        <h3>下一步待辦</h3>
        <ol className="todo-list">
          {todo.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ol>
        {mode === "owner" && Object.keys(doc.drivers).length > 0 && (
          <details className="day-summary">
            <summary>司機安排</summary>
            <p className="muted small">依規則：司機的日期與時段確認之前，開車行程一律為「暫定」，並提供替代方案。</p>
            <ul className="todo-list">
              {Object.entries(doc.drivers).map(([n, dr]) => {
                const ds = eff.filter((d) => d.needsDriver === n);
                const ok = ds.filter((d) => d.driverOk).length;
                return (
                  <li key={n}>
                    <strong>{n}</strong>・{dr.label} <Badge t={`已確認 ${ok} / ${ds.length} 天`} c={ok === ds.length ? "b-ok" : "b-warn"} />
                    <br />
                    <span className="muted small">{dr.note}</span>
                  </li>
                );
              })}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}
