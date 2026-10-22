"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { TripDoc } from "@/domain/schema";
import type { Op } from "@/domain/ops";
import { alertStatus } from "@/domain/rules";
import { dayDiff, fmtMD, fmtTs } from "@/domain/format";
import { api, registerServiceWorker } from "@/client/api";
import { keyFor, loadSnapshot, saveSnapshot, mergeVersions, type VersionMeta } from "@/client/offline";
import { useAsk, useToast, useToday } from "./ui";
import { Overview } from "./Overview";
import { DaysView } from "./DaysView";
import { TripMapTab } from "./MapViews";
import { Budget } from "./Budget";
import { Info } from "./Info";
import { Pool } from "./Pool";
import { Manage } from "./Manage";

/*
 * Client shell for both the owner view and the read-only share view.
 * Visitors receive only the privacy-filtered document from the server.
 */

export type Mode = "owner" | "public";
export type Alerts = ReturnType<typeof alertStatus>;
export type Vote = { itemId: string; dayDate: string; nickname: string | null };
export type Counts = { current: { itemId: string; dayDate: string; name: string; count: number }[]; moved: { itemId: string; dayDate: string; name: string; count: number }[] };

type Ctx = {
  mode: Mode;
  doc: TripDoc;
  versionNo: number;
  online: boolean;
  token?: string;
  runOp: (op: Record<string, unknown>) => Promise<boolean>;
  ask: ReturnType<typeof useAsk>["ask"];
  toast: (m: string) => void;
  gotoDay: (i: number) => void;
  currentDay: number;
  setCurrentDay: (i: number) => void;
  myVotes: Vote[];
  vote: (itemId: string, dayDate: string) => Promise<void>;
  unvote: (itemId: string, dayDate: string) => Promise<void>;
  counts: Counts | null;
  canVote: boolean;
  versions: VersionMeta[];
  reloadVersions: () => Promise<void>;
  applyServerDoc: (doc: TripDoc, versionNo: number) => void;
  alerts: Alerts;
  lastSyncAt: string;
  offlineCopy: boolean;
};

const TripCtx = createContext<Ctx | null>(null);
export function useTrip(): Ctx {
  const c = useContext(TripCtx);
  if (!c) throw new Error("useTrip outside TripApp");
  return c;
}

const TABS = [
  { key: "overview", label: "總覽" },
  { key: "days", label: "每日行程" },
  { key: "map", label: "地圖" },
  { key: "budget", label: "預算" },
  { key: "pool", label: "待安排景點" },
  { key: "info", label: "資訊與警示" },
  { key: "manage", label: "版本與分享", owner: true },
] as const;
type TabKey = (typeof TABS)[number]["key"];

// Stable for the page session even when localStorage is unavailable (private mode).
let memoryVoterKey: string | null = null;
function voterKey(): string {
  const K = "aya-voter-key";
  try {
    const v = localStorage.getItem(K);
    if (v) return v;
  } catch {
    /* storage blocked */
  }
  memoryVoterKey ??= crypto.randomUUID();
  try {
    localStorage.setItem(K, memoryVoterKey);
  } catch {
    /* keep the in-memory key */
  }
  return memoryVoterKey;
}

export function TripApp(props: { mode: Mode; token?: string; home?: boolean; initial: { doc: TripDoc; versionNo: number; syncedAt: string } }) {
  const { mode, token } = props;
  // Public home (PUBLIC_HOME=1): read-only like a share link, but without voting (votes belong to a share link).
  const home = mode === "public" && !!props.home;
  const canVote = mode === "public" && !!token;
  const storeKey = home ? "trip:home" : keyFor(mode, token);
  const [doc, setDoc] = useState<TripDoc>(props.initial.doc);
  const [versionNo, setVersionNo] = useState(props.initial.versionNo);
  const [lastSyncAt, setLastSyncAt] = useState(props.initial.syncedAt);
  const [alerts, setAlerts] = useState<Alerts>(() => alertStatus(props.initial.doc, { showWindow: props.mode === "owner" }));
  const [online, setOnline] = useState(true);
  const [fromCache, setFromCache] = useState(false);
  const [tab, setTab] = useState<TabKey>("overview");
  const today = useToday();
  const [pickedDay, setCurrentDay] = useState<number | null>(null);
  const todayIdx = today ? doc.days.findIndex((d) => d.date === today) : -1;
  const currentDay = pickedDay ?? (todayIdx >= 0 ? todayIdx : 0);
  const [myVotes, setMyVotes] = useState<Vote[]>([]);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [versions, setVersions] = useState<VersionMeta[]>([]);
  const { ask, node: dialog } = useAsk();
  const { toast, node: toastNode } = useToast();

  const tripUrl = mode === "owner" ? "/api/trip" : home ? "/api/public" : `/api/s/${token}`;

  const persist = useCallback(
    (d: TripDoc, v: number, syncedAt: string) =>
      saveSnapshot(storeKey, { doc: d, versionNo: v, lastSyncAt: syncedAt, alerts: alertStatus(d, { showWindow: mode === "owner" }), versions: mode === "owner" ? versions : undefined }),
    [storeKey, mode, versions],
  );

  const applyServerDoc = useCallback(
    (d: TripDoc, v: number) => {
      const now = new Date().toISOString();
      setAlerts(alertStatus(d, { showWindow: mode === "owner" }));
      setDoc(d);
      setVersionNo(v);
      setLastSyncAt(now);
      setFromCache(false);
      setOnline(true);
      void persist(d, v, now);
    },
    [persist, mode],
  );

  const refresh = useCallback(async () => {
    const r = await api<{ doc: TripDoc; versionNo: number; syncedAt: string; alerts: Alerts }>(tripUrl);
    if (r.ok && !r.cached) {
      setAlerts(r.data.alerts);
      setDoc(r.data.doc);
      setVersionNo(r.data.versionNo);
      setLastSyncAt(r.data.syncedAt);
      setFromCache(false);
      setOnline(true);
      void persist(r.data.doc, r.data.versionNo, r.data.syncedAt);
      return true;
    }
    if (r.ok && r.cached) {
      // The service worker answered from its cache: the server is unreachable.
      setOnline(false);
      setFromCache(true);
      const snap = await loadSnapshot<TripDoc, Alerts>(storeKey);
      const best = snap && snap.lastSyncAt > r.data.syncedAt ? { doc: snap.doc, versionNo: snap.versionNo, syncedAt: snap.lastSyncAt, alerts: snap.alerts } : r.data;
      setAlerts(best.alerts);
      setDoc(best.doc);
      setVersionNo(best.versionNo);
      setLastSyncAt(best.syncedAt);
      if (snap?.versions && mode === "owner") setVersions(snap.versions);
      return false;
    }
    if (!r.ok && r.offline) {
      setOnline(false);
      const snap = await loadSnapshot<TripDoc, Alerts>(storeKey);
      if (snap && snap.lastSyncAt > props.initial.syncedAt) {
        setAlerts(snap.alerts);
        setDoc(snap.doc);
        setVersionNo(snap.versionNo);
        setLastSyncAt(snap.lastSyncAt);
      }
      setFromCache(true);
      if (snap?.versions && mode === "owner") setVersions(snap.versions);
    }
    return false;
  }, [tripUrl, persist, storeKey, props.initial.syncedAt, mode]);

  const reloadVersions = useCallback(async () => {
    if (mode !== "owner") return;
    const r = await api<{ versions: VersionMeta[] }>("/api/trip/versions?docs=1");
    if (r.ok) {
      setVersions(r.data.versions);
      void mergeVersions(storeKey, r.data.versions);
    }
  }, [mode, storeKey]);

  const loadCounts = useCallback(async () => {
    if (mode !== "owner") return;
    const r = await api<Counts>("/api/trip/interest");
    if (r.ok) setCounts(r.data);
  }, [mode]);

  const loadMyVotes = useCallback(async () => {
    if (!canVote) return;
    const r = await api<{ votes: Vote[] }>(`/api/s/${token}/interest/mine`, { method: "POST", body: { voterKey: voterKey() } });
    if (r.ok) setMyVotes(r.data.votes);
  }, [canVote, token]);

  useEffect(() => {
    registerServiceWorker([tripUrl]);
    // Initial render came from the server (or from a cached page when offline): re-check.
    void (async () => {
      const ok = await refresh();
      if (ok) {
        await Promise.all([reloadVersions(), loadCounts(), loadMyVotes()]);
      }
    })();
    const on = () => {
      setOnline(true);
      void refresh();
    };
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runOp = useCallback(
    async (op: Record<string, unknown>) => {
      if (mode !== "owner") return false;
      const r = await api<{ versionNo: number; summary: string; doc: TripDoc }>("/api/trip/ops", { method: "POST", body: { baseVersionNo: versionNo, op: op as Op } });
      if (r.ok) {
        applyServerDoc(r.data.doc, r.data.versionNo);
        toast(`已儲存為新版本 v${r.data.versionNo}`);
        void reloadVersions();
        return true;
      }
      if (r.offline) toast("目前離線：修改需要網路連線");
      else if (r.status === 409) {
        toast("行程已在其他地方更新，已重新載入");
        await refresh();
      } else toast(r.error);
      return false;
    },
    [mode, versionNo, applyServerDoc, toast, reloadVersions, refresh],
  );

  const vote = useCallback(
    async (itemId: string, dayDate: string) => {
      const prev = myVotes.find((v) => v.itemId === itemId && v.dayDate === dayDate);
      const r = await ask(prev ? "修改暱稱" : "我有興趣！", {
        body: <p className="small muted">暱稱可留空，擁有者只會看到合計人數。</p>,
        fields: [{ name: "nick", label: "暱稱（選填，最多 20 字）", value: prev?.nickname ?? "", maxLength: 20 }],
        ok: "送出",
      });
      if (!r) return;
      const res = await api(`/api/s/${token}/interest`, { method: "POST", body: { voterKey: voterKey(), itemId, dayDate, nickname: r.nick } });
      if (res.ok) {
        toast("已送出，謝謝！");
        await loadMyVotes();
      } else toast(res.error);
    },
    [ask, token, toast, loadMyVotes, myVotes],
  );

  const unvote = useCallback(
    async (itemId: string, dayDate: string) => {
      const res = await api(`/api/s/${token}/interest`, { method: "DELETE", body: { voterKey: voterKey(), itemId, dayDate } });
      if (res.ok) {
        toast("已收回");
        await loadMyVotes();
      } else toast(res.error);
    },
    [token, toast, loadMyVotes],
  );

  const gotoDay = useCallback(
    (i: number) => {
      setCurrentDay(Math.max(0, Math.min(doc.days.length - 1, i)));
      setTab("days");
      if (typeof window !== "undefined") document.querySelector(".tabs")?.scrollIntoView({ block: "start" });
    },
    [doc.days.length],
  );

  const ctx: Ctx = {
    mode,
    doc,
    versionNo,
    online,
    token,
    runOp,
    ask,
    toast,
    gotoDay,
    currentDay: Math.min(currentDay, doc.days.length - 1),
    setCurrentDay,
    myVotes,
    vote,
    unvote,
    counts,
    canVote,
    versions,
    reloadVersions,
    applyServerDoc,
    alerts,
    lastSyncAt,
    offlineCopy: !online || fromCache,
  };

  const visibleTabs = TABS.filter((t) => mode === "owner" || !("owner" in t));
  const journeyHref = mode === "owner" || home ? "/journey" : `/s/${token}/journey`;

  return (
    <TripCtx.Provider value={ctx}>
      <a className="skip" href="#main">
        跳到主要內容
      </a>
      <Hero doc={doc} mode={mode} journeyHref={journeyHref} />
      {mode === "public" && (
        <div className="banner">
          {canVote ? "你正在檢視 Aya 的旅程（唯讀）。可以對活動按「我有興趣」！" : "你正在檢視 Aya 的旅程（唯讀公開版，住址與司機資訊已隱藏）。"}{" "}
          {home && (
            <>
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- next-auth route, full navigation */}
              <a href="/api/auth/signin?callbackUrl=%2F">擁有者登入</a>
            </>
          )}
        </div>
      )}
      {(!online || fromCache) && (
        <div className="offline-banner" role="status">
          離線副本，可能不是最新資料（最後同步：{fmtTs(lastSyncAt)}）
          <button className="btn ghost small" type="button" onClick={() => void refresh()}>
            重新連線
          </button>
        </div>
      )}
      <nav className="tabs" aria-label="主要分頁">
        <div className="tabs-inner" role="tablist">
          {visibleTabs.map((t) => (
            <button key={t.key} role="tab" type="button" aria-selected={tab === t.key} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
      </nav>
      <main id="main">
        <Panel show={tab === "overview"}>
          <Overview />
        </Panel>
        <Panel show={tab === "days"}>
          <DaysView active={tab === "days"} />
        </Panel>
        <Panel show={tab === "map"}>
          <TripMapTab active={tab === "map"} />
        </Panel>
        <Panel show={tab === "budget"}>
          <Budget />
        </Panel>
        <Panel show={tab === "pool"}>
          <Pool />
        </Panel>
        <Panel show={tab === "info"}>
          <Info />
        </Panel>
        {mode === "owner" && (
          <Panel show={tab === "manage"}>
            <Manage />
          </Panel>
        )}
      </main>
      <footer className="foot">
        <p>
          最後同步：{fmtTs(lastSyncAt)}
          {!online || fromCache ? "（離線副本，可能不是最新資料）" : ""}。目前沒有即時資料連線，所有價格與時間皆為估計。
        </p>
        <p>
          版本 v{versionNo}・{mode === "owner" ? "擁有者模式" : "唯讀分享"}
          {mode === "owner" && (
            <>
              {" "}・{/* eslint-disable-next-line @next/next/no-html-link-for-pages -- next-auth route, full navigation */}
              <a href="/api/auth/signout">登出</a>
            </>
          )}
        </p>
      </footer>
      {dialog}
      {toastNode}
    </TripCtx.Provider>
  );
}

function Panel({ show, children }: { show: boolean; children: ReactNode }) {
  return (
    <section className="panel" role="tabpanel" hidden={!show}>
      {children}
    </section>
  );
}

function Hero({ doc, mode, journeyHref }: { doc: TripDoc; mode: Mode; journeyHref: string }) {
  const segOrder = useMemo(() => {
    const out: string[] = [];
    doc.days.forEach((d) => {
      if (!out.includes(d.seg)) out.push(d.seg);
    });
    return out;
  }, [doc.days]);
  const t = useToday();
  const s = doc.meta.start;
  const e = doc.meta.end;
  const when = !t ? "" : t < s ? `距離出發還有 ${dayDiff(t, s)} 天` : t <= e ? `旅程第 ${dayDiff(s, t) + 1} 天` : "旅程已結束";
  return (
    <header className="hero" id="top">
      <svg className="hero-waves" viewBox="0 0 1440 200" preserveAspectRatio="none" aria-hidden="true">
        <path className="w1" d="M0,120 C240,170 480,70 720,110 C960,150 1200,80 1440,120 L1440,200 L0,200 Z" />
        <path className="w2" d="M0,150 C260,110 520,190 780,150 C1040,110 1240,170 1440,140 L1440,200 L0,200 Z" />
      </svg>
      <div className="hero-inner">
        <p className="eyebrow">{mode === "owner" ? "私人測試版 · 擁有者" : "私人測試版 · 唯讀分享"}</p>
        <h1>{doc.meta.title}</h1>
        <p className="hero-sub">{doc.meta.subtitle}</p>
        <div className="hero-meta">
          <span className="chip-hero">
            🗓️ {fmtMD(doc.meta.start)} – {fmtMD(doc.meta.end)}・{doc.days.length} 天
          </span>
          <span className="chip-hero">📍 {segOrder.map((k) => `${doc.segments[k]?.name ?? k}（${doc.segments[k]?.range ?? ""}）`).join(" → ")}</span>
          {when && <span className="chip-hero">⏱️ {when}</span>}
        </div>
        <p className="hero-link">
          <a href={journeyHref}>✦ 進入 3D 旅程首頁 →</a>
        </p>
      </div>
    </header>
  );
}
