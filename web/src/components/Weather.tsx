"use client";

import { useWeather, type TripWeather } from "@/client/weather";
import { backupsFor, isWet, isWindy, outdoorPlans, weatherNote, wxLabel, type DayWx } from "@/domain/weather";
import { PendingButton } from "./ui";
import { isLogistics } from "@/domain/day-title";
import type { Item, TripDoc } from "@/domain/schema";
import { fmtDay } from "@/domain/format";

/*
 * Weather chips and lines (Kai 2026-10-26). Hand-drawn line icons in the ink colour; rain is the one
 * vermilion accent. Forecasts beyond Open-Meteo's 16 days read 「尚無預報」.
 */

const PATHS: Record<ReturnType<typeof wxLabel>["icon"], string> = {
  sun: "M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM12 1.5v2.5M12 20v2.5M1.5 12H4M20 12h2.5M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8",
  partly: "M8 4.5v1.6M3.3 8.6h1.6M4.8 5.2l1.1 1.1M11.6 6.4l1.1-1.1M8 8.2a3.2 3.2 0 0 0-2.6 5M9 19h9.3a3.7 3.7 0 0 0 .3-7.4 5.2 5.2 0 0 0-9.9 1.1A3.2 3.2 0 0 0 9 19z",
  cloud: "M7 19h11a4 4 0 0 0 .4-8 6 6 0 0 0-11.5 1.3A3.4 3.4 0 0 0 7 19z",
  fog: "M7 13h11a4 4 0 0 0 .4-8 6 6 0 0 0-11.5 1.3A3.4 3.4 0 0 0 7 13zM3.5 17h17M6 20.5h12",
  drizzle: "M7 15h11a4 4 0 0 0 .4-8 6 6 0 0 0-11.5 1.3A3.4 3.4 0 0 0 7 15zM9 18.5v1M13 18.5v1M17 18.5v1",
  rain: "M7 14h11a4 4 0 0 0 .4-8 6 6 0 0 0-11.5 1.3A3.4 3.4 0 0 0 7 14zM8.5 17l-1 3M12.5 17l-1 3M16.5 17l-1 3",
  storm: "M7 14h11a4 4 0 0 0 .4-8 6 6 0 0 0-11.5 1.3A3.4 3.4 0 0 0 7 14zM13 15l-2.5 4h3L11 22.5",
  snow: "M7 14h11a4 4 0 0 0 .4-8 6 6 0 0 0-11.5 1.3A3.4 3.4 0 0 0 7 14zM9 18h.01M12 20h.01M15 18h.01",
};

export function WxIcon({ code, size = 18 }: { code: number; size?: number }) {
  const l = wxLabel(code);
  return (
    <svg className={`wx-icon wx-${l.icon}`} viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path d={PATHS[l.icon]} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const deg = (v: number | null) => (v == null ? "–" : `${Math.round(v)}°`);

export function wxFor(w: TripWeather | null, date: string) {
  return w?.days.find((d) => d.date === date) ?? null;
}

/** Day header chip: icon, high/low and rain chance. */
export function WxChip({ wx, place, unavailable }: { wx: DayWx | null; place?: string; unavailable?: boolean }) {
  if (!wx) return <span className="wx-chip none">{unavailable ? "暫無預報" : "尚無預報"}</span>;
  const l = wxLabel(wx.code);
  return (
    <span className={`wx-chip${isWet(wx) ? " wet" : ""}`} aria-label={`${place ? `${place}：` : ""}${l.t}，高溫 ${deg(wx.tMax)}、低溫 ${deg(wx.tMin)}，降雨機率 ${wx.pop ?? "–"}%`}>
      <WxIcon code={wx.code} />
      <span aria-hidden="true">
        {deg(wx.tMax)}/{deg(wx.tMin)}
        {wx.pop != null && <span className="pop"> {wx.pop}%</span>}
      </span>
    </span>
  );
}

/** Day detail: a short forecast line plus rain or wind warnings. */
export function WxLine({ day }: { day: { date: string; place: string; wx: DayWx | null; unavailable?: boolean } | null }) {
  if (!day) return null;
  const wx = day.wx;
  if (!wx) return <p className="wx-line small muted">{day.place}：{day.unavailable ? "暫時取不到預報，稍後再看" : "尚無預報（出發前 16 天內才有）"}</p>;
  const l = wxLabel(wx.code);
  return (
    <div className="wx-line small">
      <WxIcon code={wx.code} size={20} />
      <span>
        {day.place}：{l.t}，{deg(wx.tMin)}–{deg(wx.tMax)}，降雨機率 {wx.pop ?? "–"}%{wx.rain ? `（約 ${wx.rain} mm）` : ""}，最大風速 {wx.wind ?? "–"} km/h
        {wx.uv != null && wx.uv >= 6 ? `，紫外線 ${Math.round(wx.uv)}（很強，記得防曬）` : ""}
        {wx.sunset ? `，日落 ${wx.sunset}` : ""}
      </span>
      {isWet(wx) && <strong className="wx-warn">可能下雨，看下面的雨天備案</strong>}
      {isWindy(wx) && <strong className="wx-warn">風很大，海邊步道、遊船和飛行要注意</strong>}
    </div>
  );
}

/** 資訊與警示: the next days at a glance. */
export function WeatherStrip() {
  const w = useWeather();
  if (!w) return null;
  const today = new Date().toISOString().slice(0, 10);
  const days = w.days.filter((d) => d.date >= today).slice(0, 10);
  if (!days.length) return null;
  return (
    <section className="card section wx-strip" aria-labelledby="wx-h">
      <h3 id="wx-h">天氣預報</h3>
      <ol>
        {days.map((d) => (
          <li key={d.date} className={isWet(d.wx ?? undefined) ? "wet" : ""}>
            <span className="d">{fmtDay(d.date)}</span>
            <span className="p small muted">{d.place}</span>
            <WxChip wx={d.wx} place={d.place} unavailable={d.unavailable} />
          </li>
        ))}
      </ol>
      <p className="muted small">
        來源：
        <a href={w.url} target="_blank" rel="noopener noreferrer">
          {w.source}
        </a>
        {w.fetchedAt ? `，更新於 ${new Date(w.fetchedAt).toLocaleString("zh-TW", { timeZone: "Australia/Hobart", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}（荷巴特時間）` : ""}
        {w.stale ? "；暫時連不上，顯示上次的資料" : ""}。預報只到出發前 16 天內的日子。
      </p>
    </section>
  );
}

/**
 * 雨天備案: for a day that looks wet, each outdoor plan with up to two indoor places nearby from the pool.
 * The owner can swap one in (undoable) or trade the whole day with a drier day in the forecast.
 */
export function RainPlan({
  date,
  seg,
  items,
  pool,
  w,
  owner,
  onUse,
  onSwapDay,
  onIndoor,
}: {
  date: string;
  seg: string;
  items: Item[];
  pool: Pick<TripDoc, "attractionPool" | "days">;
  w: TripWeather | null;
  owner: boolean;
  onUse: (itemId: string, key: string, backupId: string) => Promise<unknown>;
  onSwapDay: (toDate: string) => Promise<unknown>;
  onIndoor: (itemId: string, indoor: "" | "yes" | "no") => Promise<unknown>;
}) {
  const day = wxFor(w, date);
  if (!day?.wx || !isWet(day.wx)) return null;
  const outdoor = outdoorPlans({ items });
  // Plans counted as indoor (by the owner or the rules), so the owner can correct either way.
  const indoorNow = items.filter((i) => !outdoor.includes(i) && !isLogistics(i) && !i.name.startsWith("住宿：") && !/^Kai 有工作/.test(i.name));
  const dry = (w?.days ?? []).filter((d) => d.date !== date && d.wx && !isWet(d.wx) && d.date >= new Date().toISOString().slice(0, 10));
  return (
    <section className="card rain-plan" aria-labelledby={`rain-${date}`}>
      <h3 id={`rain-${date}`}>
        <WxIcon code={day.wx.code} size={20} /> 雨天備案
      </h3>
      <p className="small muted">
        降雨機率 {day.wx.pop ?? "–"}%。下面是戶外行程附近（車程約 30 分鐘內）的室內景點。
      </p>
      {outdoor.length ? (
        <ul>
          {outdoor.map((i) => {
            const alts = backupsFor(pool, i, seg);
            const note = weatherNote(i);
            return (
              <li key={i.id}>
                <strong>{i.name}</strong>
                {note && <p className="small wx-note">{note}</p>}
                {alts.length ? (
                  <ul className="rain-alts">
                    {alts.map((b) => (
                      <li key={b.item.id}>
                        {b.item.name} <span className="small muted">約 {b.minutes} 分鐘</span>
                        {owner && i.status !== "confirmed" && (
                          <PendingButton className="btn ghost small" pendingLabel="換成中…" onAction={() => onUse(i.id, b.key, b.item.id)}>
                            換成備案
                          </PendingButton>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="small muted">附近的待安排景點裡沒有室內備案。</p>
                )}
                {owner && i.status === "confirmed" && alts.length > 0 && <p className="small muted">已確認預訂，要換成備案請先把狀態改成「待確認」。</p>}
                {owner && (
                  <PendingButton className="btn ghost small" pendingLabel="儲存中…" onAction={() => onIndoor(i.id, "yes")}>
                    其實是室內，不用備案
                  </PendingButton>
                )}
                {owner && i.indoor != null && (
                  <PendingButton className="btn ghost small" pendingLabel="儲存中…" onAction={() => onIndoor(i.id, "")}>
                    改回自動判斷
                  </PendingButton>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="small">這天的行程都在室內。</p>
      )}
      {owner && indoorNow.length > 0 && (
        <div className="rain-indoor small">
          <span className="muted">算作室內：</span>
          {indoorNow.map((i) => (
            <span key={i.id} className="rain-indoor-item">
              {i.name}
              <PendingButton className="btn ghost small" pendingLabel="儲存中…" onAction={() => onIndoor(i.id, "no")}>
                其實在戶外
              </PendingButton>
              {i.indoor != null && (
                <PendingButton className="btn ghost small" pendingLabel="儲存中…" onAction={() => onIndoor(i.id, "")}>
                  改回自動判斷
                </PendingButton>
              )}
            </span>
          ))}
        </div>
      )}
      {owner && dry.length > 0 && (
        <div className="rain-swap">
          <span className="small muted">或和預報比較好的日子對調（已確認的預訂、住宿和交通不動）：</span>
          {dry
            .filter((d) => pool.days.find((x) => x.date === d.date)?.seg === seg)
            .slice(0, 3)
            .map((d) => (
              <PendingButton key={d.date} className="btn ghost small" pendingLabel="對調中…" onAction={() => onSwapDay(d.date)}>
                和 {fmtDay(d.date)} 對調（{d.wx ? wxLabel(d.wx.code).t : ""}）
              </PendingButton>
            ))}
        </div>
      )}
    </section>
  );
}
