"use client";

import { useState } from "react";
import { useTrip } from "./TripApp";
import { Icon } from "./Icon";
import { Badge, MODE, PRI } from "./ui";
import { packageEstimate } from "@/domain/budget";
import { fmtDay, money } from "@/domain/format";
import type { Package } from "@/domain/schema";

/* Unscheduled attractions (PLAN.md 4.9, D8). Suggestions are hints; nothing is scheduled automatically. */

export function Pool() {
  const { doc, mode } = useTrip();
  const pkgs = doc.attractionPool.filter((p) => p.items.length);
  return (
    <>
      <div className="card">
        <h2>待安排景點</h2>
        <p className="muted">
          這些是原本 10 月下旬規劃、旅程還沒開始所以先移出行程的景點，以及從 Google 地圖收藏匯入的雪梨與塔州景點。建議日期只是參考，
          {mode === "owner" ? "要由你決定排進哪一天。" : "擁有者還沒排入行程。"}整組排入會一起套用共乘費用、開車時間與司機需求；單獨排入一個景點不套用共乘費用。
        </p>
      </div>
      {pkgs.length ? (
        <div className="pool-grid section">
          {pkgs.map((p) => (
            <PackageCard key={p.key} pkg={p} />
          ))}
        </div>
      ) : (
        <p className="section muted">目前沒有待安排的景點。</p>
      )}
    </>
  );
}

function PackageCard({ pkg }: { pkg: Package }) {
  const { doc, mode, runOp, online } = useTrip();
  const eligible = doc.days.filter((d) => d.seg === pkg.seg);
  const [date, setDate] = useState(pkg.suggestion?.date && eligible.some((d) => d.date === pkg.suggestion!.date) ? pkg.suggestion.date : (eligible[0]?.date ?? ""));
  const editable = mode === "owner" && online;
  const est = packageEstimate(pkg, doc.partySize);
  // Places imported from saved lists carry no cost at all; say so instead of showing $0.
  const priced = pkg.costs.length > 0 || pkg.items.some((i) => i.cost);
  return (
    <div className="card pool-pkg">
      <h3>{pkg.title}</h3>
      <p className="small">
        <Badge t={doc.segments[pkg.seg]?.name ?? pkg.seg} c={`b-${pkg.seg}`} /> {pkg.needsDriver && <Badge t={`需要 ${pkg.needsDriver} 開車`} c="b-warn" />}{" "}
        {pkg.driveHrs ? <Badge t={`開車約 ${pkg.driveHrs} 小時`} c="b-info" /> : null} {pkg.ferry && <Badge t="渡輪" c="b-info" />} {pkg.hike && <Badge t="步道" c="b-info" />}
      </p>
      <ul>
        {pkg.items.map((i) => (
          <li key={i.id}>
            <strong>{i.name}</strong> <Badge {...PRI[i.pri]} />
            <br />
            <span className="small muted">
              {i.time}・{MODE[i.mode]}
              {i.src && (
                <>
                  ・
                  <a href={i.src.url} target="_blank" rel="noopener noreferrer">
                    {i.src.label}
                  </a>
                </>
              )}
              {i.note ? `・${i.note}` : ""}
            </span>
            {editable && (
              <>
                {" "}
                <button className="btn ghost small" type="button" disabled={!date} onClick={() => void runOp({ op: "scheduleItem", key: pkg.key, itemId: i.id, date })}>
                  只排這個
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      {priced ? (
        <p className="small">
          估計花費（{doc.partySize} 人，含共乘）：<strong>{money(est)}</strong> <Badge t="估計" c="b-warn" />
        </p>
      ) : (
        <p className="small muted">費用與開放時間尚未查證。</p>
      )}
      {pkg.alt && <p className="small muted">沒有司機時：{pkg.alt}</p>}
      {pkg.suggestion && (
        <p className="small">
          <Icon name="note" size={16} /> 建議：{pkg.suggestion.date ? `${fmtDay(pkg.suggestion.date)}・` : ""}
          {pkg.suggestion.reason}
        </p>
      )}
      {editable && (
        <div className="pool-actions">
          <label className="small">
            排入日期{" "}
            <select value={date} onChange={(e) => setDate(e.target.value)}>
              {eligible.map((d) => (
                <option key={d.date} value={d.date}>
                  {fmtDay(d.date)} {d.title}
                </option>
              ))}
            </select>
          </label>
          <button className="btn small" type="button" disabled={!date} onClick={() => void runOp({ op: "schedulePackage", key: pkg.key, date })}>
            整組排入
          </button>
        </div>
      )}
    </div>
  );
}
