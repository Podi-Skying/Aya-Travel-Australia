"use client";

import { Cormorant_Garamond, Noto_Serif_TC } from "next/font/google";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { thumbUrl, type MyPhoto } from "@/client/my-photos";
import { fingerprint, preparePhoto, readExif, sendPhoto, tinyThumb, type Exif } from "@/client/photo-upload";
import { dayFor, exifLocal, fileNameLocal } from "@/domain/photo-day";
import { bezier, isCategory, isScreenshotName, launchAt, pileThumb, sortDuration, spiral, type Category } from "@/domain/photo-sort";
import type { TripDoc } from "@/domain/schema";
import { ClassifySteps, ExportPanel, LibraryClassify } from "./PhotoTools";

/*
 * The photo sorter on /photos (owner only, docs/PHOTOS-PLAN.md "Sorter"). Its look follows the guide Kai
 * sent: a deep-navy (or white) board with a stat bar, folder cards on both sides and a turning pile of
 * photos in the middle; 「開始整理」 throws every photo along an arc into its trip-day folder. Folders here
 * are trip days. Motion rules: layout is measured once per run, flights are Web Animations on transform
 * and opacity, counters are written once per frame, a tap lands everything at once, and reduced motion
 * gets fades instead of spin and flights.
 */

const serif = Noto_Serif_TC({ weight: "900", subsets: ["latin"], preload: false, display: "swap", variable: "--srt-serif" });
const accent = Cormorant_Garamond({ weight: "600", style: "italic", subsets: ["latin"], display: "swap", variable: "--srt-accent" });

export const UNSORTED = "unsorted";
const DUP = "dup";
const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp|tiff?|heic|heif|avif)$/i;
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|avi|mkv|3gp)$/i;
const TILE = 18;
const GAP = 3;
const SKIN_KEY = "aya-photos-skin";
const WD = ["日", "一", "二", "三", "四", "五", "六"];

type Up = "wait" | "send" | "done" | "fail";
type Entry = { key: string; file: File; thumb: string | null; print: string; exif: Exif; target: string; screenshot: boolean; category: Category | null; labelled: boolean; rot: number; z: number; scanned: boolean; up: Up; error?: string };
type Phase = "idle" | "scan" | "ready" | "fly" | "upload" | "done";
type Section = "add" | "classify" | "export" | "look" | "who";

const isImage = (f: File) => !f.name.startsWith(".") && (f.type.startsWith("image/") || IMAGE_EXT.test(f.name));
const isVideo = (f: File) => f.type.startsWith("video/") || VIDEO_EXT.test(f.name);
const short = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
const weekday = (date: string) => WD[new Date(`${date}T12:00:00`).getDay()];
const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

async function filesFromDrop(items: DataTransferItemList): Promise<File[]> {
  const out: File[] = [];
  const walk = async (e: FileSystemEntry): Promise<void> => {
    if (e.isFile) {
      out.push(await new Promise<File>((ok, bad) => (e as FileSystemFileEntry).file(ok, bad)));
      return;
    }
    if (!e.isDirectory || e.name.startsWith(".")) return;
    const reader = (e as FileSystemDirectoryEntry).createReader();
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((ok, bad) => reader.readEntries(ok, bad));
      if (!batch.length) break;
      for (const c of batch) await walk(c);
    }
  };
  const roots = [...items].map((i) => i.webkitGetAsEntry?.()).filter(Boolean) as FileSystemEntry[];
  if (!roots.length) return [...items].map((i) => i.getAsFile()).filter(Boolean) as File[];
  for (const r of roots) await walk(r);
  return out;
}

async function pool<T>(list: T[], n: number, work: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, list.length) }, async () => {
      while (i < list.length) await work(list[i++]);
    }),
  );
}

const Folder = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden className="srt-ico">
    <path d="M1.8 4.2c0-.7.5-1.2 1.2-1.2h3l1.4 1.6H13c.7 0 1.2.5 1.2 1.2v6.2c0 .7-.5 1.2-1.2 1.2H3c-.7 0-1.2-.5-1.2-1.2z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
  </svg>
);
const Trash = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden className="srt-ico">
    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round" />
  </svg>
);
const Pin = () => (
  <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden className="srt-ico">
    <path d="M8 14s4.5-4.2 4.5-7.5a4.5 4.5 0 0 0-9 0C3.5 9.8 8 14 8 14z" fill="none" stroke="currentColor" strokeWidth="1.3" />
    <circle cx="8" cy="6.5" r="1.5" fill="currentColor" />
  </svg>
);

export type SorterProps = {
  doc: TripDoc;
  photos: MyPhoto[];
  configured: boolean;
  usedBytes?: number;
  onUploaded: () => void;
  onOpenDay: (target: string) => void;
  who: ReactNode;
  setup: ReactNode;
};

export function Sorter({ doc, photos, configured, usedBytes, onUploaded, onOpenDay, who, setup }: SorterProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [read, setRead] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [panel, setPanel] = useState<Section | null>(null);
  const [classified, setClassified] = useState(false);
  const [skin, setSkin] = useState<"navy" | "light">(() => {
    try {
      return localStorage.getItem(SKIN_KEY) === "light" ? "light" : "navy";
    } catch {
      return "navy";
    }
  });
  const root = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const dirInput = useRef<HTMLInputElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const center = useRef<HTMLDivElement>(null);
  const pile = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const spin = useRef<Animation | null>(null);
  const token = useRef(0);
  const seq = useRef(0);
  const pileImgs = useRef(new Map<string, HTMLElement>());
  const cards = useRef(new Map<string, HTMLElement>());
  const stat = useRef(new Map<string, HTMLElement>());
  const [radius, setRadius] = useState(140);
  /* flights in the air and photos not yet landed, so a tap can land them all or 重來 can take them back */
  const flights = useRef(new Set<Animation>());
  const pending = useRef(new Map<string, Entry>());

  const days = doc.days;
  const half = Math.ceil(days.length / 2);
  const leftDays = days.slice(0, half);
  const rightDays = days.slice(half);
  const targets = useMemo(() => [...days.map((d) => d.date), UNSORTED, DUP], [days]);

  /* what is already uploaded, per folder */
  const base = useMemo(() => {
    const m = new Map<string, MyPhoto[]>();
    for (const p of photos) {
      const t = p.dayDate ?? UNSORTED;
      m.set(t, [...(m.get(t) ?? []), p]);
    }
    return m;
  }, [photos]);

  const say = useCallback((t: string) => {
    setToast(t);
    window.setTimeout(() => setToast((x) => (x === t ? null : x)), 3800);
  }, []);

  const changeSkin = (s: "navy" | "light") => {
    setSkin(s);
    try {
      localStorage.setItem(SKIN_KEY, s);
    } catch {}
  };

  /* pile radius = 0.4 × the middle column's smaller side, re-measured 200 ms after a resize */
  useEffect(() => {
    const el = center.current;
    if (!el) return;
    let t = 0;
    const measure = () => setRadius(Math.max(90, Math.min(el.clientWidth, el.clientHeight || el.clientWidth) * 0.4));
    measure();
    const ro = new ResizeObserver(() => {
      window.clearTimeout(t);
      t = window.setTimeout(measure, 200);
    });
    ro.observe(el);
    return () => (ro.disconnect(), window.clearTimeout(t));
  }, []);

  useEffect(() => {
    const el = pile.current;
    if (!el || reducedMotion() || (phase !== "scan" && phase !== "ready" && phase !== "fly")) return;
    const a = el.animate([{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }], { duration: 120_000, iterations: Infinity });
    spin.current = a;
    return () => {
      a.cancel();
      spin.current = null;
    };
  }, [phase]);

  const busy = phase === "scan" || phase === "fly" || phase === "upload";
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  /* ---------- counting (written to the page once per frame) ---------- */
  const landed = useRef(new Map<string, number>());
  const slots = useRef(new Map<string, number>());
  const frame = useRef(0);
  const lastGlow = useRef(new Map<string, number>());

  const flush = useCallback(() => {
    frame.current = 0;
    let inDays = 0;
    let used = 0;
    for (const t of targets) {
      const n = (landed.current.get(t) ?? 0) + (t === DUP ? 0 : (base.get(t)?.length ?? 0));
      const card = cards.current.get(t);
      const num = card?.querySelector<HTMLElement>(".srt-n");
      if (num) num.textContent = String(n);
      card?.classList.toggle("has", n > 0);
      if (t !== UNSORTED && t !== DUP) {
        inDays += landed.current.get(t) ?? 0;
        if (n) used++;
      }
    }
    const put = (k: string, v: number) => {
      const el = stat.current.get(k);
      if (el) el.textContent = v.toLocaleString();
    };
    put("days", inDays);
    put("used", used);
    put("unsorted", landed.current.get(UNSORTED) ?? 0);
    put("dup", landed.current.get(DUP) ?? 0);
  }, [targets, base]);

  useEffect(() => {
    if (phase === "idle" || phase === "scan" || phase === "ready") flush();
  }, [flush, phase, photos]);

  const clearTiles = () => {
    for (const card of cards.current.values()) for (const t of card.querySelectorAll(".srt-tile.new")) t.remove();
    landed.current = new Map();
    slots.current = new Map();
  };

  const land = useCallback(
    (e: Entry, slot: { col: number; row: number } | null) => {
      landed.current.set(e.target, (landed.current.get(e.target) ?? 0) + 1);
      const card = cards.current.get(e.target);
      if (card && slot && e.thumb) {
        const tile = document.createElement("i");
        tile.className = "srt-tile new";
        tile.style.backgroundImage = `url(${e.thumb})`;
        tile.style.gridColumn = String(slot.col + 1);
        tile.style.gridRow = String(slot.row + 1);
        card.querySelector(".srt-grid")?.append(tile);
      }
      const now = performance.now();
      if (card && now - (lastGlow.current.get(e.target) ?? 0) > 250) {
        lastGlow.current.set(e.target, now);
        card.animate([{ backgroundColor: "var(--srt-glow)", borderColor: "var(--srt-gold)" }, {}], { duration: 450, easing: "ease-out" });
      }
      if (!frame.current) frame.current = requestAnimationFrame(flush);
    },
    [flush],
  );

  const reset = useCallback(() => {
    token.current++;
    for (const a of flights.current) a.cancel();
    flights.current.clear();
    layer.current?.replaceChildren();
    clearTiles();
    setEntries((es) => {
      for (const e of es) if (e.thumb) URL.revokeObjectURL(e.thumb);
      return [];
    });
    setRead(0);
    setClassified(false);
    setPhase("idle");
  }, []);

  /* ---------- 1. read ---------- */
  const add = async (list: File[]) => {
    if (phase !== "idle" && phase !== "done") return;
    if (phase === "done") reset();
    setPanel(null);
    const images = list.filter(isImage);
    const video = list.filter(isVideo).length;
    if (!images.length) return say(video ? "影片這一版還不收，請選照片。" : "沒有找到照片。");
    if (video) say(`影片這一版還不收，略過 ${video} 支。`);
    const my = ++token.current;
    setPhase("scan");
    setRead(0);
    const fresh: Entry[] = images.map((file) => ({
      key: `s${++seq.current}`,
      file,
      thumb: null,
      print: "",
      exif: { exifTime: null, exifOffset: null, lat: null, lng: null },
      target: UNSORTED,
      screenshot: isScreenshotName(file.name),
      category: null,
      labelled: false,
      rot: Math.random() * 28 - 14,
      z: Math.floor(Math.random() * 1000),
      scanned: false,
      up: "wait",
    }));
    setEntries(fresh);
    const done: Entry[] = [];
    let n = 0;
    await pool(fresh, 4, async (e) => {
      const [print, exif, thumb] = await Promise.all([fingerprint(e.file).catch(() => ""), readExif(e.file), tinyThumb(e.file)]);
      if (token.current !== my) return;
      const local = exifLocal(exif.exifTime, exif.exifOffset)?.local ?? fileNameLocal(e.file.name)?.local ?? null;
      const next: Entry = { ...e, print, exif, thumb, scanned: true, category: e.screenshot ? "截圖" : null, target: e.screenshot ? UNSORTED : (dayFor(local, days) ?? UNSORTED) };
      done.push(next);
      setRead(++n);
      setEntries((es) => es.map((x) => (x.key === e.key ? next : x)));
    });
    if (token.current !== my) return;
    let known = new Set<string>();
    let labels: Record<string, string> = {};
    try {
      const r = await fetch("/api/my-photos/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fingerprints: done.map((e) => e.print).filter(Boolean) }) });
      if (r.ok) {
        const j = (await r.json()) as { known: string[]; labels?: Record<string, string> };
        known = new Set(j.known);
        labels = j.labels ?? {};
      }
    } catch {}
    /* decided outside the state updater, which must stay pure */
    const seen = new Set<string>();
    const dups = new Set<string>();
    const byKey = new Map(done.map((e) => [e.key, e]));
    for (const e of fresh) {
      const p = byKey.get(e.key)?.print;
      if (!p) continue;
      if (seen.has(p) || known.has(p)) dups.add(e.key);
      seen.add(p);
    }
    setEntries((es) =>
      es.map((e) => {
        if (dups.has(e.key)) return { ...e, target: DUP, up: "done" };
        const l = labels[e.print];
        return !e.category && isCategory(l) ? { ...e, category: l, labelled: true } : e;
      }),
    );
    setPhase("ready");
  };

  /* ---------- 2. throw ---------- */

  const finishNow = () => {
    if (phase !== "fly") return;
    const my = ++token.current;
    for (const a of flights.current) a.cancel();
    flights.current.clear();
    layer.current?.replaceChildren();
    for (const e of pending.current.values()) land(e, null);
    pending.current.clear();
    for (const el of pileImgs.current.values()) el.style.visibility = "hidden";
    setPhase("upload");
    void upload(entries, my);
  };

  const again = () => {
    if (phase !== "fly" && phase !== "done") return;
    token.current++;
    for (const a of flights.current) a.cancel();
    flights.current.clear();
    layer.current?.replaceChildren();
    pending.current.clear();
    clearTiles();
    for (const el of pileImgs.current.values()) el.style.visibility = "";
    flush();
    setPhase("ready");
  };

  const start = () => {
    if (phase !== "ready") return;
    const my = ++token.current;
    clearTiles();
    flush();
    const list = entries;
    const left = list.filter((e) => e.target !== DUP && !e.category).length;
    if (left && !classified) say(`${left} 張還沒分類，之後可以在「設定」裡分。`);
    setPanel(null);
    if (reducedMotion() || !stage.current || !center.current || !layer.current) {
      for (const e of list) land(e, null);
      setPhase("upload");
      void upload(list, my);
      return;
    }
    setPhase("fly");
    pending.current = new Map(list.map((e) => [e.key, e]));
    /* measure once */
    const s = stage.current.getBoundingClientRect();
    const c = center.current.getBoundingClientRect();
    const mid = { x: c.left + c.width / 2 - s.left, y: c.top + c.height / 2 - s.top };
    const grids = new Map<string, { x: number; y: number; w: number; h: number; cols: number; cap: number; used: number }>();
    for (const t of targets) {
      const g = cards.current.get(t)?.querySelector<HTMLElement>(".srt-grid");
      if (!g) continue;
      const r = g.getBoundingClientRect();
      const cols = Math.max(1, Math.floor((r.width + GAP) / (TILE + GAP)));
      const rows = Math.max(1, Math.floor((r.height + GAP) / (TILE + GAP)));
      const used = Math.min(base.get(t)?.length ?? 0, cols * rows);
      grids.set(t, { x: r.left - s.left, y: r.top - s.top, w: r.width, h: r.height, cols, cap: cols * rows, used });
    }
    const size = pileThumb(radius * 0.8, list.length);
    const index = new Map(list.map((e, i) => [e.key, i]));
    const order = [...list].sort(() => Math.random() - 0.5);
    const total = sortDuration(order.length);
    let t0 = -1;
    let next = 0;
    let count = 0;
    const tick = (now: number) => {
      if (token.current !== my) return;
      if (t0 < 0) t0 = now;
      while (next < order.length && now - t0 >= launchAt(next, order.length, total)) {
        const e = order[next++];
        const spinDeg = spin.current?.currentTime != null ? ((Number(spin.current.currentTime) / 120_000) * 360) % 360 : 0;
        const at = spiral(index.get(e.key) ?? 0, list.length, radius * 0.8, size);
        const rad = (spinDeg * Math.PI) / 180;
        const from = { x: mid.x + at.x * Math.cos(rad) - at.y * Math.sin(rad), y: mid.y + at.x * Math.sin(rad) + at.y * Math.cos(rad) };
        const g = grids.get(e.target);
        let slot: { col: number; row: number } | null = null;
        let to = mid;
        if (g) {
          const k = g.used++;
          if (k < g.cap) {
            slot = { col: k % g.cols, row: Math.floor(k / g.cols) };
            to = { x: g.x + slot.col * (TILE + GAP) + TILE / 2, y: g.y + slot.row * (TILE + GAP) + TILE / 2 };
          } else to = { x: g.x + Math.random() * g.w, y: g.y + Math.random() * g.h };
        }
        const ctrl = { x: (from.x + to.x) / 2 + (Math.random() * 40 - 20), y: (from.y + to.y) / 2 - (60 + Math.random() * 100) };
        const src = pileImgs.current.get(e.key);
        if (src) src.style.visibility = "hidden";
        const el = document.createElement("i");
        el.className = "srt-fly";
        el.style.width = el.style.height = `${size}px`;
        if (e.thumb) el.style.backgroundImage = `url(${e.thumb})`;
        layer.current!.append(el);
        const rot0 = e.rot + spinDeg;
        const frames: Keyframe[] = [];
        for (let k = 0; k <= 12; k++) {
          const t = k / 12;
          const pt = bezier(from, ctrl, to, t);
          const sc = t < 0.15 ? 1 + (t / 0.15) * 0.15 : 1.15 - ((t - 0.15) / 0.85) * (1.15 - TILE / size);
          frames.push({ transform: `translate(${pt.x - size / 2}px, ${pt.y - size / 2}px) rotate(${rot0 * (1 - t)}deg) scale(${sc})`, opacity: !slot && t > 0.8 ? 1 - (t - 0.8) / 0.2 : 1, offset: t });
        }
        const a = el.animate(frames, { duration: 900 + Math.random() * 400, easing: "cubic-bezier(.45,.05,.25,1)", fill: "forwards" });
        flights.current.add(a);
        a.onfinish = () => {
          el.remove();
          flights.current.delete(a);
          if (token.current !== my) return;
          pending.current.delete(e.key);
          land(e, slot);
          if (++count === order.length) {
            setPhase("upload");
            void upload(list, my);
          }
        };
      }
      if (next < order.length) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  /* ---------- 3. upload ---------- */
  const [sent, setSent] = useState(0);
  const upload = async (list: Entry[], my: number) => {
    const work = list.filter((e) => e.target !== DUP && e.up !== "done");
    if (!configured) {
      setPhase("done");
      say("照片儲存空間還沒設定，這次只整理不上傳。");
      return;
    }
    setSent(0);
    const mark = (key: string, patch: Partial<Entry>) => setEntries((es) => es.map((x) => (x.key === key ? { ...x, ...patch } : x)));
    await pool(work, 3, async (e) => {
      if (token.current !== my) return;
      mark(e.key, { up: "send", error: undefined });
      try {
        const p = await preparePhoto(e.file, { fingerprint: e.print || undefined, exif: e.exif, category: e.category });
        const r = await sendPhoto(p, () => {});
        if (r.status !== 200 && r.status !== 201) throw new Error((r.body as { error?: string } | null)?.error ?? `錯誤 ${r.status}`);
        mark(e.key, { up: "done" });
        setSent((n) => n + 1);
      } catch (err) {
        mark(e.key, { up: "fail", error: (err as Error).message === "network" ? "網路中斷" : (err as Error).message });
      }
    });
    if (token.current !== my) return;
    setPhase("done");
    onUploaded();
  };

  const failed = entries.filter((e) => e.up === "fail");
  const retry = () => {
    if (!failed.length) return;
    setPhase("upload");
    void upload(failed, token.current);
  };

  /* uploaded photos come back from the server as base tiles; drop the stand-ins */
  useEffect(() => {
    if (phase !== "done" || !configured) return;
    for (const card of cards.current.values()) for (const t of card.querySelectorAll(".srt-tile.new")) t.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos]);

  /* ---------- keyboard ---------- */
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "escape") setPanel(null);
      else if (k === "s") start();
      else if (k === "r") again();
      else if (k === "f") void (document.fullscreenElement ? document.exitFullscreen() : root.current?.requestFullscreen?.());
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  /* ---------- view ---------- */
  const dupCount = entries.filter((e) => e.target === DUP).length;
  const todo = entries.filter((e) => e.scanned && e.target !== DUP && !e.category);
  const labelledCount = entries.filter((e) => e.labelled).length;
  const toSend = entries.filter((e) => e.target !== DUP).length;

  const status =
    phase === "idle"
      ? photos.length
        ? `已有 ${photos.length.toLocaleString()} 張照片`
        : "還沒加入照片"
      : phase === "scan"
        ? `讀取中 ${read} / ${entries.length}`
        : phase === "ready"
          ? `已讀取 ${entries.length} 張・找到 ${dupCount} 張重複`
          : phase === "fly"
            ? "整理中…"
            : phase === "upload"
              ? `上傳中 ${sent} / ${toSend}`
              : "完成";
  const needClassify = phase === "ready" && todo.length > 0 && !classified;
  const label = phase === "idle" ? "加入照片" : phase === "scan" ? "讀取中…" : needClassify ? "分類" : phase === "ready" ? "開始整理" : phase === "fly" ? "整理中…" : "下載";
  const main = () => {
    if (phase === "idle") setPanel("add");
    else if (needClassify) setPanel("classify");
    else if (phase === "ready") start();
    else if (phase === "fly") finishNow();
    else if (phase === "upload" || phase === "done") setPanel("export");
  };

  const size = pileThumb(radius * 0.8, entries.length);
  const showPile = phase === "scan" || phase === "ready" || phase === "fly";

  const card = (t: string, wide = false) => {
    const list = t === DUP ? [] : (base.get(t) ?? []);
    const day = days.find((d) => d.date === t);
    return (
      <li
        key={t}
        ref={(el) => void (el ? cards.current.set(t, el) : cards.current.delete(t))}
        className={`srt-card${wide ? " wide" : ""}${t === DUP ? " dup" : ""}${list.length ? " has" : ""}`}
        onClick={() => t !== DUP && list.length && onOpenDay(t)}
        title={day?.title}
      >
        <div className="srt-card-h">
          {t === DUP ? <Trash /> : <Folder />}
          <span className="srt-name">
            {t === DUP ? "重複" : t === UNSORTED ? "未分類" : short(t)}
            {day && <small>{weekday(day.date)}</small>}
            {day?.title && (
              <em className="srt-place">
                <Pin />
                {day.title}
              </em>
            )}
          </span>
          <b className="srt-n">{list.length}</b>
        </div>
        <div className="srt-grid">
          {list.slice(0, 80).map((p) => (
            <i key={p.id} className="srt-tile" style={{ backgroundImage: `url(${thumbUrl(p.id)})` }} />
          ))}
        </div>
      </li>
    );
  };

  const statCell = (k: string, labelText: string, value: number, dot?: "dark" | "light") => (
    <div className="srt-stat">
      <span className="srt-stat-l">
        {dot && <i className={`srt-dot ${dot}`} />}
        {labelText}
      </span>
      <b ref={(el) => void (el ? stat.current.set(k, el) : stat.current.delete(k))}>{value.toLocaleString()}</b>
    </div>
  );

  const sortedLib = photos.filter((p) => p.dayDate).length;

  return (
    <div
      ref={root}
      className={`srt ${serif.variable} ${accent.variable}${dragging ? " drag" : ""}`}
      data-skin={skin}
      onDragOver={(e) => (e.preventDefault(), setDragging(true))}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void filesFromDrop(e.dataTransfer.items).then(add);
      }}
    >
      <input ref={fileInput} type="file" accept="image/*,.heic,.heif" multiple hidden onChange={(e) => (void add([...(e.target.files ?? [])]), (e.target.value = ""))} />
      <input ref={dirInput} type="file" multiple hidden {...{ webkitdirectory: "" }} onChange={(e) => (void add([...(e.target.files ?? [])]), (e.target.value = ""))} />

      <header className="srt-top">
        <div className="srt-id">
          <span className="srt-avatar" aria-hidden>
            K
          </span>
          <div>
            <p className="srt-who">
              <b>Kai</b> · 旅遊照片
            </p>
            <h1>
              整理我的 <em>Tasmania</em> 旅遊照片
            </h1>
          </div>
        </div>
        <div className="srt-action">
          <span className="srt-status" aria-live="polite">
            {status}
          </span>
          <button type="button" className="srt-main" onClick={main} disabled={phase === "scan"}>
            <i className="srt-breath" aria-hidden />
            {label}
          </button>
        </div>
      </header>

      <div className="srt-stats">
        {statCell("total", "總照片", phase === "idle" ? photos.length : entries.length)}
        {statCell("days", "已分天", phase === "idle" ? sortedLib : 0, "dark")}
        {statCell("used", "天數", 0, "light")}
        {statCell("unsorted", "未分類", phase === "idle" ? (base.get(UNSORTED)?.length ?? 0) : 0)}
        {statCell("dup", "重複", 0)}
      </div>

      <div className="srt-stage" ref={stage} onPointerDown={(e) => phase === "fly" && !(e.target as HTMLElement).closest("button") && finishNow()}>
        <section className="srt-col">
          <h2>
            <i className="srt-dot light" />
            <em>Days</em> {leftDays.length ? `${short(leftDays[0].date)}–${short(leftDays[leftDays.length - 1].date)}` : ""}
          </h2>
          <ul className="srt-cards">
            {leftDays.map((d) => card(d.date))}
            {card(UNSORTED, true)}
          </ul>
        </section>

        <div className="srt-center" ref={center}>
          <div className="srt-rings" style={{ width: radius * 2.48, height: radius * 2.48 }} aria-hidden>
            <i style={{ width: radius * 2, height: radius * 2 }} />
            <i className="dash" style={{ width: radius * 2.24, height: radius * 2.24 }} />
            <i style={{ width: radius * 2.48, height: radius * 2.48 }} />
          </div>
          {phase === "idle" && (
            <div className="srt-drop" style={{ width: radius * 2, height: radius * 2 }}>
              <p className="srt-drop-t">把照片拖到這裡</p>
              <div className="srt-row">
                <button type="button" className="srt-btn gold" onClick={() => dirInput.current?.click()}>
                  選擇資料夾
                </button>
                <button type="button" className="srt-btn" onClick={() => fileInput.current?.click()}>
                  選擇照片
                </button>
              </div>
              <p className="srt-note">照片只有你看得到，原始檔不會被改動</p>
            </div>
          )}
          {showPile && (
            <div ref={pile} className="srt-pile" style={{ width: radius * 2, height: radius * 2 }}>
              {entries.map((e, i) => {
                const at = spiral(i, entries.length, radius * 0.8, size);
                return (
                  <i
                    key={e.key}
                    ref={(el) => void (el ? pileImgs.current.set(e.key, el) : pileImgs.current.delete(e.key))}
                    className={`srt-chip${e.thumb ? "" : " blank"}${e.scanned ? " in" : ""}`}
                    style={{
                      width: size,
                      height: size,
                      zIndex: e.z,
                      transform: `translate(${radius + at.x - size / 2}px, ${radius + at.y - size / 2}px) rotate(${e.rot}deg)`,
                      backgroundImage: e.thumb ? `url(${e.thumb})` : undefined,
                      animationDelay: `${Math.round((i / Math.max(1, entries.length)) * 1400)}ms`,
                    }}
                  />
                );
              })}
            </div>
          )}
          {phase === "fly" && (
            <div className="srt-fly-ctl">
              <button type="button" className="srt-btn" onClick={finishNow}>
                略過動畫
              </button>
              <button type="button" className="srt-btn" onClick={again}>
                重來
              </button>
            </div>
          )}
          {(phase === "upload" || phase === "done") && (
            <div className="srt-badge" role="status">
              <span className="srt-check" aria-hidden>
                <svg viewBox="0 0 24 24" width="30" height="30">
                  <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <b>{(entries.length - dupCount).toLocaleString()} 張照片整理好了</b>
              <span>
                分到 {new Set(entries.filter((e) => e.target !== DUP && e.target !== UNSORTED).map((e) => e.target)).size} 天 · {dupCount} 張重複
              </span>
              {phase === "upload" && (
                <span className="srt-up">
                  上傳中 {sent} / {toSend}
                </span>
              )}
              {phase === "done" && (
                <div className="srt-row">
                  {failed.length > 0 && (
                    <button type="button" className="srt-btn gold" onClick={retry}>
                      重試 {failed.length} 張
                    </button>
                  )}
                  <button type="button" className="srt-btn" onClick={reset}>
                    再加照片
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <section className="srt-col">
          <h2>
            <i className="srt-dot light" />
            <em>Days</em> {rightDays.length ? `${short(rightDays[0].date)}–${short(rightDays[rightDays.length - 1].date)}` : ""}
          </h2>
          <ul className="srt-cards">
            {rightDays.map((d) => card(d.date))}
            {card(DUP, true)}
          </ul>
        </section>
        <div ref={layer} className="srt-layer" aria-hidden />
      </div>

      <button type="button" className="srt-settings" onClick={() => setPanel(panel ? null : "add")} aria-expanded={!!panel}>
        設定
      </button>

      <aside className={`srt-panel${panel ? " open" : ""}`} aria-label="設定" aria-hidden={!panel} inert={!panel}>
        <button type="button" className="srt-close" onClick={() => setPanel(null)} aria-label="關閉設定">
          ×
        </button>
        <PanelSection id="add" open={panel} title="1. 加入照片">
          <p className="srt-note">選照片或整個資料夾，也可以直接拖進畫面。只收照片，影片這一版先不收。</p>
          <div className="srt-row">
            <button type="button" className="srt-btn gold" onClick={() => dirInput.current?.click()}>
              選擇資料夾
            </button>
            <button type="button" className="srt-btn" onClick={() => fileInput.current?.click()}>
              選擇照片
            </button>
          </div>
          {!configured && setup}
          {configured && usedBytes != null && <p className="srt-note">已用 {Math.round(usedBytes / 1_000_000)} MB / 1 GB</p>}
          <button
            type="button"
            className="srt-link"
            onClick={async () => {
              const r = await fetch("/api/my-photos/resort", { method: "POST" });
              if (!r.ok) return;
              onUploaded();
              say("已依拍攝時間重新分天");
            }}
          >
            重新依時間分天
          </button>
        </PanelSection>
        <PanelSection id="classify" open={panel} title="2. 用 Claude 分類">
          <p className="srt-note">Claude 要看過照片才能分類。在這台 Mac 上讓 Claude 分好的照片，加入時會自動套用。</p>
          {phase === "ready" || phase === "scan" ? (
            <>
              <p className="srt-note">
                這批：已在 Mac 分好 {labelledCount} 張，還沒分 {todo.length} 張
              </p>
              {todo.length ? (
                <ClassifySteps
                  items={todo.map((e) => ({ key: e.key, src: e.thumb }))}
                  say={say}
                  onApply={async (map) => {
                    setEntries((es) => es.map((e) => (map.has(e.key) ? { ...e, category: map.get(e.key)! } : e)));
                    if (map.size >= todo.length) {
                      setClassified(true);
                      setPanel(null);
                    }
                    return map.size;
                  }}
                  onSkip={() => {
                    setClassified(true);
                    setPanel(null);
                  }}
                />
              ) : (
                <p className="srt-note">這批都分好了，按「開始整理」。</p>
              )}
            </>
          ) : (
            <LibraryClassify photos={photos} onSaved={onUploaded} say={say} />
          )}
        </PanelSection>
        <PanelSection id="export" open={panel} title="3. 下載">
          <ExportPanel doc={doc} photos={photos} say={say} />
        </PanelSection>
        <PanelSection id="look" open={panel} title="4. 外觀">
          <div className="srt-seg" role="group" aria-label="配色">
            <button type="button" aria-pressed={skin === "navy"} onClick={() => changeSkin("navy")}>
              深藍
            </button>
            <button type="button" aria-pressed={skin === "light"} onClick={() => changeSkin("light")}>
              白底
            </button>
          </div>
          <dl className="srt-keys">
            <dt>S</dt>
            <dd>開始整理</dd>
            <dt>R</dt>
            <dd>重來，再看一次</dd>
            <dt>F</dt>
            <dd>全螢幕</dd>
            <dt>Esc</dt>
            <dd>關閉設定</dd>
          </dl>
        </PanelSection>
        <PanelSection id="who" open={panel} title="5. 誰可以看">
          {who}
        </PanelSection>
      </aside>

      {toast && (
        <p className="srt-toast" role="status">
          {toast}
        </p>
      )}
    </div>
  );
}

/** One section of the panel; opening the panel at a section scrolls it into view. */
function PanelSection({ id, open, title, children }: { id: Section; open: Section | null; title: string; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (open === id) ref.current?.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
  }, [open, id]);
  return (
    <section ref={ref} className="srt-sec">
      <h3>{title}</h3>
      {children}
    </section>
  );
}
