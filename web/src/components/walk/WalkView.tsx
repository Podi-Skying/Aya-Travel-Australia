"use client";

import "@/app/walk.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import type { TripDoc } from "@/domain/schema";
import { walkDays } from "@/domain/walk";
import { api, registerServiceWorker } from "@/client/api";
import { fmtTs } from "@/domain/format";

/*
 * Home page: the hand-drawn route walk (prototypes/route-walk/index.html, DESIGN.md).
 * Always receives the redacted public document. Links lead to the planner and the 3D page.
 */
export function WalkView({
  doc: initialDoc,
  dataUrl,
  syncedAt,
  base = "",
  account,
}: {
  doc: TripDoc;
  dataUrl: string;
  syncedAt: string;
  /** "" for the site, "/s/{token}" for a share link. */
  base?: string;
  account: "signin" | "owner" | null;
}) {
  const planHref = `${base}/plan`;
  const root = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState(initialDoc);
  const [sync, setSync] = useState({ at: syncedAt, offline: false });
  const days = useMemo(() => walkDays(doc), [doc]);

  useEffect(() => {
    registerServiceWorker([dataUrl]);
    let alive = true;
    void api<{ doc: TripDoc; syncedAt: string }>(dataUrl).then((r) => {
      if (!alive) return;
      if (r.ok && !r.cached) {
        // Rebuilding the walk is visible; skip it when nothing changed.
        setDoc((cur) => (JSON.stringify(cur) === JSON.stringify(r.data.doc) ? cur : r.data.doc));
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
      if (!cancelled && root.current) stop = m.startWalk(root.current, days, { planHref });
    });
    return () => {
      cancelled = true;
      stop?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  return (
    <div className="rw" ref={root}>
      {/* Hand-drawn wobble for geometric paths. */}
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
        <filter id="rough" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves={2} seed={4} result="t" />
          <feDisplacementMap in="SourceGraphic" in2="t" scale={2.4} xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>

      {sync.offline && (
        <div className="offline" role="status">
          離線副本，可能不是最新資料（最後同步：{fmtTs(sync.at)}）
        </div>
      )}

      <SiteHeader base={base} current="walk" account={account === "owner" ? "signout" : account} />

      <main id="rw-days" />

      <section className="end" id="rw-end">
        <div>
          <h2>{days.length} 天，走完了。</h2>
          <p>路線是手繪示意，時間與費用都是估計。尚未排入行程的景點不會出現。</p>
          <p className="sync">
            最後同步：{fmtTs(sync.at)}
            {sync.offline ? "（離線副本，可能不是最新資料）" : ""}
          </p>
          <div className="go">
            <a href={planHref}>{account === "owner" ? "打開行程管理" : "看完整行程"}</a>
            <a href={`#rw-day-${days[0]?.date ?? ""}`}>從頭再走一次</a>
          </div>
        </div>
      </section>

      <span id="rw-live" className="sr" aria-live="polite" />

      <div className="bar">
        <button type="button" id="rw-prev" aria-label="前一天">
          ‹
        </button>
        <div className="now" id="rw-now" />
        <div className="prog" aria-hidden="true">
          <i id="rw-prog" />
        </div>
        <label>
          <span className="sr">跳到某一天</span>
          <select id="rw-jump" />
        </label>
        <a className="dayplan" id="rw-dayplan" href={planHref}>
          當日行程
        </a>
        <button type="button" id="rw-next" aria-label="後一天">
          ›
        </button>
      </div>
    </div>
  );
}
