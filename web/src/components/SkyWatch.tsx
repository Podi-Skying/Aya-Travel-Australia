"use client";

import { useEffect, useMemo, useState } from "react";
import { useTrip } from "./TripApp";
import { Badge, PendingButton, useHobartToday } from "./ui";
import { api } from "@/client/api";
import { fmtDay } from "@/domain/format";
import { hobartTime, kpChance, nightKp, nightSky } from "@/domain/sky";
import { SKY_KINDS } from "@/domain/schema";

/*
 * 極光與藍眼淚 (PLAN-2026-10-26 §1). Facebook groups cannot be embedded (no Groups API, the Page
 * Plugin is Pages-only), so the owner keeps links and pastes the posts worth reading.
 */

type Kp = { time: string; kp: number; kind: string };
type Outlook = { kp: Kp[]; fetchedAt: string | null; stale: boolean; source: string; url: string };

const KIND = { aurora: { t: "極光", c: "b-info" }, bio: { t: "藍眼淚", c: "b-ok" } } as const;
const hobart = (iso: string) =>
  new Intl.DateTimeFormat("zh-TW", { timeZone: "Australia/Hobart", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

export function SkyWatch() {
  const { doc, mode, online, runOp, ask } = useTrip();
  const sky = doc.skyWatch ?? { links: [], posts: [] };
  const owner = mode === "owner" && online;
  const [outlook, setOutlook] = useState<Outlook | null | "error">(null);
  useEffect(() => {
    let live = true;
    api<Outlook>("/api/sky").then((r) => live && setOutlook(r.ok ? r.data : "error"));
    return () => {
      live = false;
    };
  }, []);
  const today = useHobartToday();
  const nights = useMemo(() => {
    const tas = doc.days.filter((d) => d.seg === "tas").map((d) => d.date);
    const from = today && today > (tas[0] ?? "") ? today : tas[0];
    return tas.filter((d) => d >= (from ?? "")).map((d) => nightSky(d));
  }, [doc.days, today]);
  const posts = [...sky.posts].sort((a, b) => b.date.localeCompare(a.date));
  // Kp per dark night (dusk to dawn in Hobart), for the nights the 3-day forecast reaches.
  const kpNights = useMemo(() => {
    if (!outlook || outlook === "error" || !today) return [];
    const out: { date: string; k: Kp }[] = [];
    for (let i = 0; i < 4; i++) {
      const date = new Date(Date.parse(today + "T00:00:00Z") + i * 86_400_000).toISOString().slice(0, 10);
      const k = nightKp(nightSky(date), outlook.kp);
      if (k) out.push({ date, k });
    }
    return out;
  }, [outlook, today]);

  return (
    <div className="card section sky-watch" id="sky">
      <h3>極光與藍眼淚</h3>

      <h4>社團連結</h4>
      {sky.links.length ? (
        <ul className="sky-links">
          {sky.links.map((l) => (
            <li key={l.id}>
              <a href={l.url} target="_blank" rel="noopener noreferrer">
                <Badge {...KIND[l.kind]} /> {l.label}
              </a>
              {owner && (
                <PendingButton className="btn ghost small" pendingLabel="移除中…" onAction={() => runOp({ op: "removeSkyLink", id: l.id })}>
                  移除
                </PendingButton>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">Kai 提供社團網址後會顯示在這裡。</p>
      )}
      {sky.links.some((l) => l.url.includes("facebook.com")) && <p className="muted small">Facebook 社團需要登入才看得到貼文，也無法嵌入網站；點連結會在 Facebook 開啟。值得看的貼文，Kai 會整理到下面的「最新消息」。</p>}
      {owner && (
        <PendingButton
          className="btn ghost small"
          pendingLabel="新增中…"
          onAction={async () => {
            // Only aurora groups: the blue tears group is private (Kai 2026-10-26), so sightings go in as posts.
            const v = await ask("新增社團連結", {
              fields: [
                { name: "label", label: "名稱", value: "", required: true, maxLength: 60 },
                { name: "url", label: "網址（https://…）", type: "url", value: "", required: true, maxLength: 500 },
              ],
            });
            if (!v) return null;
            return runOp({ op: "addSkyLink", kind: "aurora", label: v.label, url: v.url });
          }}
        >
          新增連結
        </PendingButton>
      )}

      <h4>最新消息（Kai 整理）</h4>
      {posts.length ? (
        <ul className="sky-posts">
          {posts.map((p) => (
            <li key={p.id} className="sky-post">
              {p.photoUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- hotlinked post photo
                <img src={p.photoUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />
              )}
              <div>
                <p className="small">
                  {fmtDay(p.date)} <Badge {...KIND[p.kind]} />
                </p>
                <p>{p.text}</p>
                <p className="small">
                  {p.url && (
                    <a href={p.url} target="_blank" rel="noopener noreferrer">
                      原文
                    </a>
                  )}{" "}
                  {owner && (
                    <PendingButton className="btn ghost small" pendingLabel="移除中…" onAction={() => runOp({ op: "removeSkyPost", id: p.id })}>
                      移除
                    </PendingButton>
                  )}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">還沒有消息。看到社團有人回報極光或藍眼淚時，Kai 可以把重點貼在這裡。</p>
      )}
      {owner && (
        <PendingButton
          className="btn ghost small"
          pendingLabel="新增中…"
          onAction={async () => {
            const v = await ask("新增極光／藍眼淚消息", {
              fields: [
                { name: "kind", label: "類型", type: "select", value: "aurora", options: [{ value: "aurora", label: "極光" }, { value: "bio", label: "藍眼淚" }] },
                { name: "date", label: "日期（YYYY-MM-DD）", value: today ?? "", maxLength: 10 },
                { name: "text", label: "重點（最多 500 字）", value: "", required: true, maxLength: 500 },
                { name: "url", label: "原文網址（選填）", value: "", maxLength: 500 },
                { name: "photoUrl", label: "照片網址（選填）", value: "", maxLength: 500 },
              ],
            });
            if (!v) return null;
            if (!(SKY_KINDS as readonly string[]).includes(v.kind.trim())) return false;
            return runOp({ op: "addSkyPost", kind: v.kind.trim(), date: v.date.trim(), text: v.text, url: v.url, photoUrl: v.photoUrl });
          }}
        >
          新增消息
        </PendingButton>
      )}

      <h4>今晚看得到嗎</h4>
      {outlook === null ? (
        <p className="muted small">讀取極光指數中…</p>
      ) : outlook === "error" || !kpNights.length ? (
        <p className="muted small">暫時無法取得極光指數，請直接看 NOAA 或 BOM 太空天氣網站。</p>
      ) : (
        <>
          <ul className="sky-kp">
            {kpNights.map(({ date, k }) => (
              <li key={date}>
                {fmtDay(date)} 晚上：最高 Kp {k.kp.toFixed(1)}（{hobartTime(new Date(k.time))} 起的 3 小時）<Badge {...kpChance(k.kp)} />
                {k.kind === "observed" ? <span className="muted small">（已觀測）</span> : null}
              </li>
            ))}
          </ul>
          <p className="muted small">
            來源：
            <a href={outlook.url} target="_blank" rel="noopener noreferrer">
              {outlook.source}
            </a>
            {outlook.fetchedAt ? `，${hobart(outlook.fetchedAt)} 取得` : ""}
            {outlook.stale ? "（資料可能延遲）" : ""}。塔州看極光的 Kp 門檻是經驗法則，不是保證。
          </p>
        </>
      )}
      {nights.length > 0 && (
        <div className="table-wrap">
          <table className="sky-nights">
            <caption className="muted small">荷巴特的夜空，塔州每晚（月亮越暗、全暗時數越長越好）</caption>
            <thead>
              <tr>
                <th scope="col">晚上</th>
                <th scope="col">全暗開始</th>
                <th scope="col">結束</th>
                <th scope="col">月亮亮度</th>
                <th scope="col">無月全暗</th>
              </tr>
            </thead>
            <tbody>
              {nights.map((n) => (
                <tr key={n.date}>
                  <td>{fmtDay(n.date)}</td>
                  <td>{n.dusk ?? "—"}</td>
                  <td>{n.dawn ?? "—"}</td>
                  <td>{n.moonPct}%</td>
                  <td>{n.darkHrs} 小時</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">藍眼淚（海螢光）沒有官方預報，只能靠社團回報（社團是私人的，Kai 看到後會整理到「最新消息」）；通常在無月、無風的夜晚，於荷巴特附近的海灣（例如 Kingston Beach）較常見到。</p>
    </div>
  );
}
