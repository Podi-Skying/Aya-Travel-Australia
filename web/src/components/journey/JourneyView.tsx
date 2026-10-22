"use client";

import "@/app/journey.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, registerServiceWorker } from "@/client/api";
import { SiteHeader } from "@/components/SiteHeader";
import { fmtTs } from "@/domain/format";
import type { TripDoc } from "@/domain/schema";
import { heroLead, journeyChapters, journeyStats } from "@/domain/journey";
import type { MoodKey } from "./scene";

/*
 * Port of site/landing.html (PLAN.md 4.11). Chapter membership and dates come
 * from the trip document; the copy below is written for Sydney-first travel.
 */

const COPY: Record<string, { eyebrow: string; title: string; text: string; mood: MoodKey; navLabel: string }> = {
  sydney: {
    eyebrow: "Sydney",
    title: "旅程從港灣開始",
    text: "第一站是雪梨：歌劇院的夜景、曼利渡輪、邦迪到庫吉的海岸步道，再搭火車上藍山看三姊妹岩。",
    mood: "sunset",
    navLabel: "雪梨",
  },
  hobart: {
    eyebrow: "Hobart · kunanyi",
    title: "港灣與山",
    text: "從雪梨飛到荷巴特，UTAS 公寓是塔斯馬尼亞這段的家。週六逛 Salamanca 市集，再往南走進 Huon Valley 的樹頂步道。",
    mood: "morning",
    navLabel: "荷巴特",
  },
  coast: {
    eyebrow: "East Coast",
    title: "酒杯灣與火焰灣",
    text: "沿著東海岸往北，花崗岩染著橘色地衣，海水藍得不像真的。Wineglass Bay 的觀景台值得走上去。",
    mood: "noon",
    navLabel: "東海岸",
  },
  wild: {
    eyebrow: "Wilderness",
    title: "搖籃山的霧",
    text: "樹蕨、雨林和冰河切出的湖。鴿子湖環湖步道走一圈約三小時，天氣說變就變，記得帶外套。",
    mood: "fog",
    navLabel: "荒野",
  },
};

export function JourneyView({
  doc: initialDoc,
  backHref,
  dataUrl,
  syncedAt,
  account = null,
}: {
  doc: TripDoc;
  backHref: string;
  dataUrl: string;
  syncedAt: string;
  account?: "signin" | "signout" | null;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState(initialDoc);
  const [sync, setSync] = useState({ at: syncedAt, offline: false });

  // Same freshness rule as the itinerary: say so when this is an offline copy.
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
  const chapters = useMemo(() => journeyChapters(doc), [doc]);
  const stats = useMemo(() => journeyStats(doc), [doc]);
  const lead = useMemo(() => heroLead(doc), [doc]);
  const moods: MoodKey[] = ["dusk", ...chapters.map((c) => COPY[c.key]?.mood ?? "morning"), "night"];

  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    import("./scene")
      .then((m) => {
        if (!cancelled && root.current) stop = m.startJourney(root.current, moods);
      })
      .catch(() => {
        // Three.js chunk failed (offline or blocked): static background, content stays readable.
        const el = root.current;
        if (!el) return;
        el.classList.add("no-webgl");
        el.querySelector("#loader")?.classList.add("done");
        const canvas = el.querySelector<HTMLElement>("#world");
        if (canvas) canvas.style.display = "none";
        el.querySelectorAll(".card").forEach((c) => c.classList.add("in"));
      });
    return () => {
      cancelled = true;
      stop?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sectionIds = ["top", ...chapters.map((c) => c.key), "afterlight"];
  const label = (id: string) => (id === "top" ? "序章" : id === "afterlight" ? "南極光" : (COPY[id]?.navLabel ?? id));

  return (
    <div className="jr" ref={root}>
      <div id="loader" role="status" aria-live="polite">
        <div className="ld">
          <div className="glyph">南方之旅</div>
          <div className="line">
            正在升起雪梨與塔斯馬尼亞的山海　<span className="pct" id="pct">0%</span>
          </div>
          <div className="bar">
            <i id="bar" />
          </div>
        </div>
      </div>

      <canvas id="world" aria-hidden="true" />
      <div className="vignette" aria-hidden="true" />
      <div className="fg" id="fg-gum" aria-hidden="true" />
      <div className="fg" id="fg-columns" aria-hidden="true" />
      <div className="fg" id="fg-fern" aria-hidden="true" />
      <div className="fg" id="fg-grass" aria-hidden="true" />

      {sync.offline && (
        <div className="jr-offline" role="status">
          離線副本，可能不是最新資料（最後同步：{fmtTs(sync.at)}）
        </div>
      )}
      <SiteHeader base={backHref.replace(/\/plan$/, "")} current="journey" account={account} variant="dark" />

      <nav className="rail" aria-label="章節進度">
        {sectionIds.map((id) => (
          <a key={id} href={`#${id}`} aria-label={label(id)} />
        ))}
      </nav>

      <main>
        <section className="ch hero" id="top" data-ch="0">
          <div className="card">
            <p className="eyebrow">
              <em>00</em>Sydney · Tasmania · 2026
            </p>
            <h1 className="h-hero">
              世界的南端，
              <br />
              是旅程的開始。
            </h1>
            <p className="lead">{lead}</p>
            <div className="scroll-cue">
              往下捲動，進入旅程
              <i />
            </div>
          </div>
        </section>

        {chapters.map((c, k) => {
          const copy = COPY[c.key];
          return (
            <section key={c.key} className={`ch ${k % 2 ? "right" : ""}`} id={c.key} data-ch={k + 1}>
              <div className="card">
                <p className="eyebrow">
                  <em>{String(k + 1).padStart(2, "0")}</em>
                  {copy?.eyebrow ?? c.title}
                </p>
                <h2 className="h-sec">{copy?.title ?? c.title}</h2>
                {copy && <p>{copy.text}</p>}
                <ul className="stops">
                  {c.stops.map((s) => (
                    <li key={s.itemId}>
                      <span>{s.name}</span>
                      <span>{s.label}</span>
                    </li>
                  ))}
                </ul>
                {!c.stops.length && <p className="section-note">這一章的景點還在「待安排景點」中。</p>}
              </div>
            </section>
          );
        })}

        <section className="ch hero" id="afterlight" data-ch={chapters.length + 1}>
          <div className="card">
            <p className="eyebrow">
              <em>{String(chapters.length + 1).padStart(2, "0")}</em>Afterlight
            </p>
            <h2 className="h-hero">
              運氣好的夜晚，
              <br />
              天空會亮起南極光。
            </h2>
            <div className="stats">
              {[
                [stats.days, "天"],
                [stats.destinations, "個目的地"],
                [stats.must, "個必去"],
                [stats.majors, "個景點"],
              ].map(([n, t]) => (
                <div key={t}>
                  <b>{n}</b>
                  <small>{t}</small>
                </div>
              ))}
            </div>
            <a className="btn" href={backHref}>
              打開完整行程
            </a>
            <p className="note">
              行程內容為草稿，價格與時間皆為估計；南極光無法保證出現。
              <br />
              3D 場景為即時運算的程序化地形，非實際地圖比例。
            </p>
          </div>
        </section>
      </main>
      <footer className="foot">
        最後同步：{fmtTs(sync.at)}
        {sync.offline ? "（離線副本，可能不是最新資料）" : ""}。行程內容為草稿，價格與時間皆為估計。
      </footer>
    </div>
  );
}
