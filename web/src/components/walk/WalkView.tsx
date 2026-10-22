"use client";

import "@/app/walk.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { signIn, signOut } from "next-auth/react";
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
  planHref,
  journeyHref,
  account,
}: {
  doc: TripDoc;
  dataUrl: string;
  syncedAt: string;
  planHref: string;
  journeyHref: string;
  account: "signin" | "owner" | null;
}) {
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

      <header className="top">
        <a className="logo" href="#rw-top" aria-label="回到開頭">
          <svg viewBox="0 0 26 26" aria-hidden="true">
            <circle cx="13" cy="13" r="11" fill="none" stroke="#2b2a27" strokeWidth="1.3" />
            <path d="M6 17 Q10 9 13 13 T20 9" fill="none" stroke="#d2483a" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          南方散步
        </a>
        <div className="right">
          <nav className="links" aria-label="網站">
            <a href={planHref} className="keep">
              行程
            </a>
            <a href={`${planHref}#budget`}>預算</a>
            <a href={journeyHref}>3D 旅程</a>
          </nav>
          {account === "signin" && (
            <button type="button" className="account" onClick={() => void signIn("github", { callbackUrl: "/plan" })}>
              登入
            </button>
          )}
          {account === "owner" && (
            <button type="button" className="account" onClick={() => void signOut({ callbackUrl: "/" })}>
              登出
            </button>
          )}
        </div>
      </header>

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
            <a href="#rw-top">從頭再走一次</a>
          </div>
        </div>
      </section>

      <div className="bar" aria-live="polite">
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
        <button type="button" id="rw-next" aria-label="後一天">
          ›
        </button>
      </div>
    </div>
  );
}
