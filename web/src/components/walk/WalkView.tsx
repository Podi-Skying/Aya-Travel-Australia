"use client";

import "@/app/walk.css";
import { useEffect, useMemo, useRef, useState } from "react";
import type { TripDoc } from "@/domain/schema";
import { walkDays } from "@/domain/walk";
import { api, registerServiceWorker } from "@/client/api";
import { fmtTs } from "@/domain/format";

/*
 * Route-walk page (port of prototypes/route-walk). Always receives the redacted public document.
 * variant "hero" shows one day with a day switcher, for reuse as a home-page first view.
 */
export function WalkView({
  doc: initialDoc,
  backHref,
  dataUrl,
  syncedAt,
  variant = "page",
  initialDate,
}: {
  doc: TripDoc;
  backHref: string;
  dataUrl: string;
  syncedAt: string;
  variant?: "page" | "hero";
  initialDate?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState(initialDoc);
  const [sync, setSync] = useState({ at: syncedAt, offline: false });
  const allDays = useMemo(() => walkDays(doc), [doc]);
  const [picked, setPicked] = useState<string | null>(null);
  const heroDate = picked ?? (allDays.some((d) => d.date === initialDate) ? initialDate! : allDays[0]?.date);
  const days = useMemo(() => (variant === "hero" ? allDays.filter((d) => d.date === heroDate) : allDays), [variant, allDays, heroDate]);

  useEffect(() => {
    registerServiceWorker([dataUrl]);
    let alive = true;
    void api<{ doc: TripDoc; syncedAt: string }>(dataUrl).then((r) => {
      if (!alive) return;
      if (r.ok && !r.cached) {
        setDoc(r.data.doc);
        setSync({ at: r.data.syncedAt, offline: false });
      } else if (r.ok) setSync({ at: r.data.syncedAt, offline: true });
      else if (r.offline) setSync((s) => ({ ...s, offline: true }));
    });
    return () => {
      alive = false;
    };
  }, [dataUrl]);

  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    void import("./walk").then((m) => {
      if (!cancelled && root.current) stop = m.startWalk(root.current, days);
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [days]);

  return (
    <div className="rw" ref={root}>
      <header className="top">
        <a className="brand" href="#rw-intro">
          每日路線散步
        </a>
        <nav className="daynav" id="rw-daynav" aria-label="跳到某一天" hidden={variant === "hero"} />
        {variant === "hero" && (
          <label className="day-pick">
            <span className="sr-only">選擇日期</span>
            <select value={heroDate} onChange={(e) => setPicked(e.target.value)}>
              {allDays.map((d, i) => (
                <option key={d.date} value={d.date}>
                  第 {i + 1} 天・{d.date.slice(5).replace("-", "/")} {d.title}
                </option>
              ))}
            </select>
          </label>
        )}
        <a className="brand" href={backHref}>
          打開行程 →
        </a>
      </header>
      <section className="intro" id="rw-intro" hidden={variant === "hero"}>
        <div>
          <h1>跟著 Aya 走一天</h1>
          <p>往下捲動，小人會沿著當天路線走過每個景點；走完最後一站就換到下一天。開車、搭船、坐飛機的路段會自動換交通工具。</p>
          <div className="cue">
            往下捲動開始
            <i />
          </div>
        </div>
      </section>
      <main id="rw-days" />
      <section className="outro" hidden={variant === "hero"}>
        <div>
          <h2>旅程走完了</h2>
          <p className="note">路線為示意圖，距離與時間是估計值，非實際比例。尚未排入行程的景點不會出現。</p>
          <p className="sync">
            最後同步：{fmtTs(sync.at)}
            {sync.offline ? "（離線副本，可能不是最新資料）" : ""}
          </p>
          <a className="btn" href={backHref}>
            打開完整行程
          </a>
        </div>
      </section>
      {sync.offline && (
        <div className="offline" role="status">
          離線副本，可能不是最新資料（最後同步：{fmtTs(sync.at)}）
        </div>
      )}
    </div>
  );
}
