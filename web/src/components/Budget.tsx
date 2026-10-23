"use client";

import { useTrip } from "./TripApp";
import { Icon } from "./Icon";
import { Badge, CATS, STATUS } from "./ui";
import { basis, budgetLines, byCategory, sum } from "@/domain/budget";
import { fmtDay, money } from "@/domain/format";

export function Budget() {
  const { doc, mode, runOp, online } = useTrip();
  const N = doc.partySize;
  const lines = budgetLines(doc, N);
  const total = sum(lines);
  const byCat = byCategory(lines);
  const max = Math.max(...Object.values(byCat), 1);
  const est = sum(lines.filter((l) => l.c.status === "estimate" && l.total > 0));
  const unknown = lines.filter((l) => l.c.status === "unknown").length;
  const shown = lines.filter((l) => l.total > 0 || l.c.status === "unknown" || l.cat === "stay");
  const segs = Object.entries(doc.segments).filter(([k]) => doc.days.some((d) => d.seg === k));

  return (
    <>
      <div className="card">
        <div className="party">
          <label htmlFor="party">同行人數（本組）</label>
          <input
            id="party"
            type="number"
            min={1}
            max={10}
            defaultValue={N}
            key={N}
            disabled={mode !== "owner" || !online}
            onBlur={(e) => {
              const n = Math.max(1, Math.min(10, Number(e.target.value) || 1));
              if (n !== N) void runOp({ op: "setPartySize", partySize: n });
            }}
          />
          <span className="muted small">改人數後，每人費用、共乘分攤會自動重算。</span>
        </div>
        <p className="small">
          <strong>金額依活動計算：</strong>每天只加總當天活動的費用、整組行程的共乘費用和住宿。沒有安排活動的日子是 $0；餐費要算進來，請把餐廳加成活動。
        </p>
        {N > 2 && (
          <div className="alert info">
            <span className="ic">
              <Icon name="info" label="資訊" />
            </span>
            <p>UTAS Hobart Apartments 的 AUD $0 只適用擁有者與 Aya；其他同行者的住宿尚未列入，需另外估算。</p>
          </div>
        )}
      </div>
      <div className="grid cols-4 section">
        <div className="card stat">
          <div className="num">{money(total)}</div>
          <div className="lbl">全程總額（{N} 人）</div>
        </div>
        <div className="card stat">
          <div className="num">{money(total / N)}</div>
          <div className="lbl">每人平均</div>
        </div>
        <div className="card stat">
          <div className="num">{money(total / doc.days.length)}</div>
          <div className="lbl">每日平均（整組）</div>
        </div>
        <div className="card stat">
          <div className="num">{Math.round((est / (total || 1)) * 100)}%</div>
          <div className="lbl">
            屬於估計值的比例{unknown ? `・${unknown} 項未知` : ""}
          </div>
        </div>
      </div>
      <div className="grid cols-2 section">
        <div className="card">
          <h3>分類</h3>
          <div className="bars">
            {Object.keys(CATS)
              .filter((k) => byCat[k])
              .map((k) => (
                <div className="bar-row" key={k}>
                  <span>{CATS[k].t}</span>
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width: `${(byCat[k] / max) * 100}%`, background: CATS[k].color }} />
                  </div>
                  <span className="num" style={{ textAlign: "right" }}>
                    {money(byCat[k])}
                  </span>
                </div>
              ))}
          </div>
        </div>
        <div className="card">
          <h3>目的地</h3>
          <div className="bars">
            {segs.map(([k, s]) => {
              const v = sum(lines.filter((l) => l.seg === k));
              return (
                <div className="bar-row" key={k}>
                  <span>{s.name}</span>
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width: `${(v / (total || 1)) * 100}%`, background: s.color }} />
                  </div>
                  <span className="num" style={{ textAlign: "right" }}>
                    {money(v)}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="muted small">每筆都列出計算基礎與狀態；國際機票與待安排景點不計入總額。</p>
        </div>
      </div>
      <details className="card section budget-detail">
        <summary>
          <h3>逐項明細（{shown.length} 筆）</h3>
        </summary>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>日期</th>
                <th>分類</th>
                <th>項目</th>
                <th>計算基礎</th>
                <th>狀態</th>
                <th className="num">金額</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((l, k) => (
                <tr key={k}>
                  <td>{fmtDay(l.day)}</td>
                  <td>
                    <span className="cat-dot" style={{ background: CATS[l.cat]?.color }} />
                    {CATS[l.cat]?.t ?? l.cat}
                  </td>
                  <td>
                    {l.label}
                    {l.c.note && (
                      <>
                        <br />
                        <span className="muted small">{l.c.note}</span>
                      </>
                    )}
                  </td>
                  <td className="small">{l.c.status === "unknown" ? "—" : l.c.unit === "night" ? (l.c.amount ? `每晚 $${l.c.amount}` : "$0") : basis(l.c, N)}</td>
                  <td>
                    <Badge {...STATUS[l.c.status]} />
                  </td>
                  <td className="num">{l.c.status === "unknown" ? "未知" : money(l.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th colSpan={5}>合計</th>
                <th className="num">{money(total)}</th>
              </tr>
            </tfoot>
          </table>
        </div>
      </details>
    </>
  );
}
