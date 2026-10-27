"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { TripDoc } from "@/domain/schema";
import type { Op } from "@/domain/ops";
import { alertStatus } from "@/domain/rules";
import { dayDiff, fmtMD, fmtTs } from "@/domain/format";
import { withMediaToken } from "@/domain/media";
import { api, registerServiceWorker } from "@/client/api";
import { keyFor, loadSnapshot, saveSnapshot, mergeVersions, type VersionMeta } from "@/client/offline";
import { SiteHeader } from "./SiteHeader";
import { useRootLang } from "@/i18n";
import { DomTranslator } from "@/i18n/DomTranslator";
import { contentDict } from "@/i18n/content";
import { t as tt } from "@/i18n/current";
import { useAsk, useToast, useHobartToday, useUrlState, withTimeout, writeUrl, type ToastAction } from "./ui";
import { DaysView } from "./DaysView";
import { PlacesMap } from "./Places";
import { Info } from "./Info";
import { TripOptions } from "./TripOptions";
import { PlanQuiz } from "./PlanQuiz";
import { DriftGallery } from "./DriftGallery";

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
  toast: (m: string, action?: ToastAction) => void;
  /** Runs an op and offers 「復原」 for 5 seconds, which restores the version before it. */
  runOpUndoable: (op: Record<string, unknown>, done: string) => Promise<boolean>;
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
  { key: "days", label: "每日行程" },
  { key: "options", label: "行程方案" },
  { key: "map", label: "地圖與景點" },
  { key: "info", label: "資訊與警示" },
  { key: "quiz", label: "旅遊規劃小測驗" }, // open to guests too (Kai 2026-10-27; public start: Hobart city centre)
  { key: "gallery", label: "畫廊", private: true },
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
  // 繁中 / EN / 日本語 (Kai 2026-10-27): the tree below is keyed by the language, so a switch re-renders it all.
  const lang = useRootLang();
  // Public home (PUBLIC_HOME=1): read-only like a share link, but without voting (votes belong to a share link).
  const home = mode === "public" && !!props.home;
  const canVote = mode === "public" && !!token;
  const storeKey = home ? "trip:home" : keyFor(mode, token);
  const [doc, setDoc] = useState<TripDoc>(props.initial.doc);
  // Share pages reach private photos (/api/media) with their token.
  const viewDoc = useMemo(() => (props.token ? withMediaToken(doc, props.token) : doc), [doc, props.token]);
  const content = useMemo(() => contentDict(doc), [doc]);
  const [versionNo, setVersionNo] = useState(props.initial.versionNo);
  const [lastSyncAt, setLastSyncAt] = useState(props.initial.syncedAt);
  const [alerts, setAlerts] = useState<Alerts>(() => alertStatus(props.initial.doc, { showWindow: props.mode === "owner" }));
  const [online, setOnline] = useState(true);
  const [fromCache, setFromCache] = useState(false);
  // Tab and day live in the URL (?tab=days&day=YYYY-MM-DD) so walk ↔ plan links land in place.
  // Without them: 每日行程 (today's day during the trip). 總覽 was removed on 2026-10-26; ?tab=overview opens 每日行程.
  const today = useHobartToday();
  const inTrip = !!today && today >= props.initial.doc.meta.start && today <= props.initial.doc.meta.end;
  const [pickedTab, setPickedTab] = useState<TabKey | null>(null);
  const [pickedDay, setPickedDay] = useState<number | null>(null);
  const url = useUrlState();
  // Only tabs this mode can show (RV-01); the gallery is private.
  // The old 待安排景點 tab now lives on the map (?tab=pool keeps working).
  // Removed tabs (總覽, 預算, 版本與分享 — 2026-10-26) open 每日行程.
  const urlTabKey = url.tab === "pool" ? "map" : ["overview", "budget", "manage", "versions"].includes(url.tab ?? "") ? "days" : url.tab;
  const urlTab = TABS.some((t) => t.key === urlTabKey && (mode === "owner" || !!token || !("private" in t))) ? (urlTabKey as TabKey) : null;
  const urlDayIdx = url.day ? doc.days.findIndex((d) => d.date === url.day) : -1;
  const tab: TabKey = pickedTab ?? urlTab ?? "days";
  const todayIdx = today ? doc.days.findIndex((d) => d.date >= today) : -1;
  const currentDay = pickedDay ?? (urlDayIdx >= 0 ? urlDayIdx : inTrip && todayIdx >= 0 ? todayIdx : inTrip ? doc.days.length - 1 : 0);
  const setTab = useCallback(
    (t: TabKey) => {
      setPickedTab(t);
      writeUrl({ tab: t, day: t === "days" ? doc.days[currentDay]?.date : undefined });
    },
    [doc.days, currentDay],
  );
  const setCurrentDay = useCallback(
    (i: number) => {
      setPickedDay(i);
      writeUrl({ tab: "days", day: doc.days[i]?.date });
    },
    [doc.days],
  );
  const [myVotes, setMyVotes] = useState<Vote[]>([]);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [versions, setVersions] = useState<VersionMeta[]>([]);
  const { ask, node: dialog } = useAsk();
  const { toast, node: toastNode } = useToast();
  // Any server write in flight shows the save bar under the tabs (selects and dialogs have no button to spin).
  const [busy, setBusy] = useState(0);
  const track = useCallback(async <T,>(p: Promise<T>) => {
    setBusy((n) => n + 1);
    try {
      return await withTimeout(p);
    } finally {
      setBusy((n) => n - 1);
    }
  }, []);

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
      const r = await track(api<{ versionNo: number; summary: string; doc: TripDoc }>("/api/trip/ops", { method: "POST", body: { baseVersionNo: versionNo, op: op as Op } }));
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
    [mode, versionNo, applyServerDoc, toast, reloadVersions, refresh, track],
  );

  const runOpUndoable = useCallback(
    async (op: Record<string, unknown>, done: string) => {
      if (mode !== "owner") return false;
      const before = versionNo;
      const r = await track(api<{ versionNo: number; summary: string; doc: TripDoc }>("/api/trip/ops", { method: "POST", body: { baseVersionNo: versionNo, op: op as Op } }));
      if (!r.ok) {
        toast(r.offline ? "目前離線：修改需要網路連線" : r.error);
        if (r.status === 409) await refresh();
        return false;
      }
      applyServerDoc(r.data.doc, r.data.versionNo);
      void reloadVersions();
      const after = r.data.versionNo;
      toast(done, {
        label: "復原",
        run: async () => {
          const u = await track(api<{ versionNo: number; doc: TripDoc }>("/api/trip/restore", { method: "POST", body: { baseVersionNo: after, versionNo: before } }));
          if (u.ok) {
            applyServerDoc(u.data.doc, u.data.versionNo);
            toast(`已復原（存成 v${u.data.versionNo}）`);
            void reloadVersions();
          } else toast(u.status === 409 ? "行程已有其他修改，無法自動復原；請重新整理後查看最新內容" : u.error);
        },
      });
      return true;
    },
    [mode, versionNo, applyServerDoc, toast, reloadVersions, refresh, track],
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
      const k = Math.max(0, Math.min(doc.days.length - 1, i));
      setPickedDay(k);
      setPickedTab("days");
      writeUrl({ tab: "days", day: doc.days[k]?.date });
      if (typeof window !== "undefined") document.querySelector(".tabs")?.scrollIntoView({ block: "start" });
    },
    [doc.days],
  );

  const ctx: Ctx = {
    runOpUndoable,
    mode,
    doc: viewDoc,
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

  // The gallery stays private; the quiz is for everyone (the public version never uses the home base).
  const visibleTabs = TABS.filter((t) => mode === "owner" || !!token || !("private" in t));
  const base = mode === "public" && token ? `/s/${token}` : "";
  const tabsRef = useRef<HTMLDivElement>(null);
  // Keep the selected tab visible in the scrollable tab row (mobile).
  useEffect(() => {
    tabsRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [tab]);
  const onTabKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const i = visibleTabs.findIndex((t) => t.key === tab);
    const n = visibleTabs.length;
    const j = e.key === "Home" ? 0 : e.key === "End" ? n - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + n) % n;
    setTab(visibleTabs[j].key);
    tabsRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')[j]?.focus();
  };

  return (
    <TripCtx.Provider value={ctx}>
      <div key={lang} className="lang-root">
      <DomTranslator content={content} />
      <a className="skip" href="#main">
        {tt("跳到主要內容")}
      </a>
      {/* The planner's tabs live in the top bar; the logo leads back to the walk (2026-10-26). */}
      <SiteHeader base={base} current="plan" account={mode === "owner" ? "signout" : home ? "signin" : null}>
        <nav className="tabs" aria-label={tt("行程分頁")}>
          <div className="tabs-inner" role="tablist" ref={tabsRef} onKeyDown={onTabKey}>
            {visibleTabs.map((t) => (
              <button
                key={t.key}
                id={`tab-${t.key}`}
                role="tab"
                type="button"
                aria-selected={tab === t.key}
                aria-controls={`panel-${t.key}`}
                tabIndex={tab === t.key ? 0 : -1}
                onClick={() => setTab(t.key)}
              >
                {tt(t.label)}
              </button>
            ))}
          </div>
          <div className={`save-bar${busy ? " on" : ""}`} aria-hidden="true" />
        </nav>
      </SiteHeader>
      <Hero doc={doc} />
      {mode === "public" && (
        <div className="banner">
          {canVote ? "你正在檢視 Aya 的旅程（唯讀）。可以對活動按「我有興趣」！" : "你正在檢視 Aya 的旅程（唯讀公開版，住址與司機資訊已隱藏）。"}{" "}

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
      <p className="sr-only" role="status" aria-live="polite">
        {busy ? "正在儲存…" : ""}
      </p>
      <main id="main">
        <Panel id="days" show={tab === "days"}>
          <DaysView active={tab === "days"} />
        </Panel>
        <Panel id="options" show={tab === "options"}>
          <TripOptions />
        </Panel>
        <Panel id="map" show={tab === "map"}>
          <PlacesMap active={tab === "map"} />
        </Panel>
        <Panel id="info" show={tab === "info"}>
          <Info />
        </Panel>
        <Panel id="quiz" show={tab === "quiz"}>
          <PlanQuiz active={tab === "quiz"} />
        </Panel>
        {(mode === "owner" || token) && (
          <Panel id="gallery" show={tab === "gallery"}>
            <DriftGallery active={tab === "gallery"} />
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
      </div>
    </TripCtx.Provider>
  );
}

function Panel({ id, show, children }: { id: string; show: boolean; children: ReactNode }) {
  return (
    <section className="panel" role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} hidden={!show}>
      {children}
    </section>
  );
}

/** The banner under the top bar (2026-10-26): trip dates and the countdown only. */
function Hero({ doc }: { doc: TripDoc }) {
  const t = useHobartToday();
  const s = doc.meta.start;
  const e = doc.meta.end;
  const when = !t ? "" : t < s ? tt("距離出發還有 {n} 天", { n: dayDiff(t, s) }) : t <= e ? tt("旅程第 {n} 天", { n: dayDiff(s, t) + 1 }) : tt("旅程已結束");
  return (
    <header className="hero" id="top">
      <div className="hero-inner">
        <h1 className="sr-only">{doc.meta.title}</h1>
        <dl className="hero-facts">
          <div>
            <dt>{tt("出遊時間")}</dt>
            <dd>
              {fmtMD(s)}–{fmtMD(e)}・{tt("{n} 天", { n: doc.days.length })}
            </dd>
          </div>
          {when && (
            <div>
              <dt>{tt("倒數")}</dt>
              <dd className="hero-when">{when}</dd>
            </div>
          )}
        </dl>
      </div>
    </header>
  );
}
