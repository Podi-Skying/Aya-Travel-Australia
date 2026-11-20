"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fingerprint, preparePhoto, readExif, sendPhoto, tinyThumb, type Exif } from "@/client/photo-upload";
import { dayFor, exifLocal, fileNameLocal } from "@/domain/photo-day";
import { bezier, isScreenshotName, launchAt, pileThumb, sortDuration, spiral } from "@/domain/photo-sort";
import type { TripDoc } from "@/domain/schema";

/*
 * The sorting stage on /photos (owner only, docs/PHOTOS-PLAN.md "Sorting stage"). Picked photos gather in a
 * slowly turning pile; 「開始整理」 throws each one along an arc into its trip-day card, then the uploads run
 * in the background with progress per day. The day shown here is a preview from the same pure functions the
 * server uses; the server still decides. Motion follows the brief's rules: layout is measured once at the
 * start, flights are transform/opacity Web Animations, counters are written once per frame, and reduced
 * motion gets short fades instead of flights.
 */

const UNSORTED = "unsorted";
const DUP = "dup";
const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp|tiff?|heic|heif|avif)$/i;
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|avi|mkv|3gp)$/i;
const CARD_THUMB = 22;

type Up = "wait" | "send" | "done" | "fail";
type Entry = { key: string; file: File; thumb: string | null; print: string; exif: Exif; target: string; screenshot: boolean; rot: number; z: number; scanned: boolean; up: Up; error?: string };
type Phase = "idle" | "scan" | "ready" | "fly" | "upload" | "done";

const isImage = (f: File) => !f.name.startsWith(".") && (f.type.startsWith("image/") || IMAGE_EXT.test(f.name));
const isVideo = (f: File) => f.type.startsWith("video/") || VIDEO_EXT.test(f.name);
const short = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Reads dropped folders too: readEntries is called until it returns nothing. */
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
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => {
    while (i < list.length) await work(list[i++]);
  }));
}

export function SortStage({ doc, onUploaded }: { doc: TripDoc; onUploaded: () => void }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [read, setRead] = useState(0);
  const [skipped, setSkipped] = useState({ video: 0, other: 0 });
  const [toast, setToast] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const dirInput = useRef<HTMLInputElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const pile = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const spin = useRef<Animation | null>(null);
  const token = useRef(0);
  const seq = useRef(0);
  const pileImgs = useRef(new Map<string, HTMLElement>());
  const cards = useRef(new Map<string, HTMLElement>());
  const counters = useRef<{ total: HTMLElement | null; days: HTMLElement | null; dup: HTMLElement | null }>({ total: null, days: null, dup: null });
  const [pileBox, setPileBox] = useState(280);

  const days = doc.days;
  const targets = useMemo(() => [...days.map((d) => d.date), UNSORTED, DUP], [days]);
  const say = useCallback((t: string) => {
    setToast(t);
    window.setTimeout(() => setToast((x) => (x === t ? null : x)), 4000);
  }, []);

  /* the pile turns once every two minutes; its Animation's currentTime gives the angle at launch */
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

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setPileBox(Math.min(320, Math.max(200, el.clientWidth - 32))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const busy = phase === "scan" || phase === "fly" || phase === "upload";
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  const clear = useCallback(() => {
    token.current++;
    layer.current?.replaceChildren();
    setEntries((es) => {
      for (const e of es) if (e.thumb) URL.revokeObjectURL(e.thumb);
      return [];
    });
    setRead(0);
    setSkipped({ video: 0, other: 0 });
    setPhase("idle");
  }, []);

  /* ---------- 1. read the picked files ---------- */
  const add = async (list: File[]) => {
    if (phase !== "idle" && phase !== "done") return;
    if (phase === "done") clear();
    const images = list.filter(isImage);
    const video = list.filter(isVideo).length;
    setSkipped({ video, other: list.length - images.length - video });
    if (!images.length) {
      say(video ? "影片這一版還不收，請選照片。" : "沒有找到照片。");
      return;
    }
    const my = ++token.current;
    setPhase("scan");
    setRead(0);
    const base: Entry[] = images.map((file) => ({ key: `s${++seq.current}`, file, thumb: null, print: "", exif: { exifTime: null, exifOffset: null, lat: null, lng: null }, target: UNSORTED, screenshot: isScreenshotName(file.name), rot: Math.random() * 28 - 14, z: Math.floor(Math.random() * 1000), scanned: false, up: "wait" }));
    setEntries(base);
    const done: Entry[] = [];
    let n = 0;
    await pool(base, 4, async (e) => {
      const [print, exif, thumb] = await Promise.all([fingerprint(e.file).catch(() => ""), readExif(e.file), tinyThumb(e.file)]);
      if (token.current !== my) return;
      const local = exifLocal(exif.exifTime, exif.exifOffset)?.local ?? fileNameLocal(e.file.name)?.local ?? null;
      const next = { ...e, print, exif, thumb, scanned: true, target: e.screenshot ? UNSORTED : (dayFor(local, days) ?? UNSORTED) };
      done.push(next);
      n++;
      setRead(n);
      setEntries((es) => es.map((x) => (x.key === e.key ? next : x)));
    });
    if (token.current !== my) return;
    /* duplicates: the same print earlier in this batch, or already uploaded */
    let known = new Set<string>();
    try {
      const r = await fetch("/api/my-photos/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fingerprints: done.map((e) => e.print).filter(Boolean) }) });
      if (r.ok) known = new Set(((await r.json()) as { known: string[] }).known);
    } catch {}
    /* decided here, not in the state updater: updaters must stay pure (they run twice in development) */
    const seen = new Set<string>();
    const dups = new Set<string>();
    const byKey = new Map(done.map((e) => [e.key, e]));
    for (const e of base) {
      const print = byKey.get(e.key)?.print;
      if (!print) continue;
      if (seen.has(print) || known.has(print)) dups.add(e.key);
      seen.add(print);
    }
    setEntries((es) => es.map((e) => (dups.has(e.key) ? { ...e, target: DUP, up: "done" } : e)));
    setPhase("ready");
  };

  /* ---------- 2. throw them into their days ---------- */
  const counts = useRef(new Map<string, number>());
  const covers = useRef(new Map<string, string>());
  const frame = useRef(0);
  const lastGlow = useRef(new Map<string, number>());

  const flush = useCallback(() => {
    frame.current = 0;
    let total = 0;
    let filled = 0;
    for (const [t, n] of counts.current) {
      total += n;
      if (n && t !== UNSORTED && t !== DUP) filled++;
      const card = cards.current.get(t);
      if (!card) continue;
      const num = card.querySelector<HTMLElement>(".sort-n");
      if (num) num.textContent = String(n);
      card.classList.toggle("has", n > 0);
      const cover = covers.current.get(t);
      const img = card.querySelector<HTMLImageElement>("img");
      if (img && cover && img.dataset.src !== cover) {
        img.src = cover;
        img.dataset.src = cover;
      }
    }
    const c = counters.current;
    if (c.total) c.total.textContent = String(total);
    if (c.days) c.days.textContent = String(filled);
    if (c.dup) c.dup.textContent = String(counts.current.get(DUP) ?? 0);
  }, []);
  const land = useCallback(
    (e: Entry) => {
      counts.current.set(e.target, (counts.current.get(e.target) ?? 0) + 1);
      if (e.thumb) covers.current.set(e.target, e.thumb);
      const now = performance.now();
      const card = cards.current.get(e.target);
      if (card && now - (lastGlow.current.get(e.target) ?? 0) > 250) {
        lastGlow.current.set(e.target, now);
        card.animate([{ backgroundColor: "var(--sort-glow)", borderColor: "var(--vermilion)" }, {}], { duration: 420, easing: "ease-out" });
      }
      if (!frame.current) frame.current = requestAnimationFrame(flush);
    },
    [flush],
  );

  const start = () => {
    if (phase !== "ready") return;
    const my = ++token.current;
    counts.current = new Map();
    covers.current = new Map();
    const list = entries;
    if (reducedMotion() || !stage.current || !pile.current || !layer.current) {
      for (const e of list) land(e);
      setPhase("upload");
      void upload(list, my);
      return;
    }
    setPhase("fly");
    /* measure once */
    const s = stage.current.getBoundingClientRect();
    const p = pile.current.getBoundingClientRect();
    const center = { x: p.left + p.width / 2 - s.left, y: p.top + p.height / 2 - s.top };
    const goal = new Map<string, { x: number; y: number }>();
    for (const t of targets) {
      const r = cards.current.get(t)?.getBoundingClientRect();
      if (r) goal.set(t, { x: r.left + r.width / 2 - s.left, y: r.top + r.height / 2 - s.top });
    }
    const radius = pileBox / 2;
    const size = pileThumb(radius * 0.8, list.length);
    const index = new Map(entries.map((e, i) => [e.key, i]));
    const order = [...list].sort(() => Math.random() - 0.5);
    const total = sortDuration(order.length);
    let t0 = -1;
    let next = 0;
    let landed = 0;
    const tick = (now: number) => {
      if (token.current !== my) return;
      if (t0 < 0) t0 = now;
      while (next < order.length && now - t0 >= launchAt(next, order.length, total)) {
        const e = order[next++];
        const spinDeg = spin.current?.currentTime != null ? ((Number(spin.current.currentTime) / 120_000) * 360) % 360 : 0;
        const at = spiral(index.get(e.key) ?? 0, entries.length, radius * 0.8, size);
        const rad = (spinDeg * Math.PI) / 180;
        const from = { x: center.x + at.x * Math.cos(rad) - at.y * Math.sin(rad), y: center.y + at.x * Math.sin(rad) + at.y * Math.cos(rad) };
        const to = goal.get(e.target) ?? center;
        const ctrl = { x: (from.x + to.x) / 2 + (Math.random() * 60 - 30), y: Math.min(from.y, to.y) - (60 + Math.random() * 100) };
        const src = pileImgs.current.get(e.key);
        if (src) src.style.visibility = "hidden";
        const el = document.createElement("div");
        el.className = "sort-fly";
        el.style.width = el.style.height = `${size}px`;
        if (e.thumb) el.style.backgroundImage = `url(${e.thumb})`;
        layer.current!.append(el);
        const rot0 = e.rot + spinDeg;
        const frames: Keyframe[] = [];
        const steps = 12;
        for (let k = 0; k <= steps; k++) {
          const t = k / steps;
          const pt = bezier(from, ctrl, to, t);
          const grow = t < 0.15 ? 1 + (t / 0.15) * 0.15 : 1.15 - ((t - 0.15) / 0.85) * (1.15 - CARD_THUMB / size);
          frames.push({ transform: `translate(${pt.x - size / 2}px, ${pt.y - size / 2}px) rotate(${rot0 * (1 - t)}deg) scale(${grow})`, opacity: t > 0.92 ? 0.4 : 1, offset: t });
        }
        const a = el.animate(frames, { duration: 900 + Math.random() * 400, easing: "cubic-bezier(.45,.05,.25,1)", fill: "forwards" });
        a.onfinish = () => {
          el.remove();
          if (token.current !== my) return;
          land(e);
          if (++landed === order.length) {
            setPhase("upload");
            void upload(list, my);
          }
        };
      }
      if (next < order.length) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  /* ---------- 3. upload in the background ---------- */
  const [progress, setProgress] = useState<Record<string, { done: number; all: number }>>({});
  const upload = async (list: Entry[], my: number) => {
    const work = list.filter((e) => e.target !== DUP && e.up !== "done");
    const all: Record<string, { done: number; all: number }> = {};
    for (const e of work) all[e.target] = { done: 0, all: (all[e.target]?.all ?? 0) + 1 };
    setProgress(all);
    const mark = (key: string, patch: Partial<Entry>) => setEntries((es) => es.map((x) => (x.key === key ? { ...x, ...patch } : x)));
    await pool(work, 3, async (e) => {
      if (token.current !== my) return;
      mark(e.key, { up: "send", error: undefined });
      try {
        const p = await preparePhoto(e.file, { fingerprint: e.print || undefined, exif: e.exif });
        const r = await sendPhoto(p, () => {});
        if (r.status !== 200 && r.status !== 201) throw new Error((r.body as { error?: string } | null)?.error ?? `錯誤 ${r.status}`);
        mark(e.key, { up: "done" });
        setProgress((pr) => ({ ...pr, [e.target]: { ...pr[e.target], done: pr[e.target].done + 1 } }));
      } catch (err) {
        mark(e.key, { up: "fail", error: (err as Error).message === "network" ? "網路中斷" : (err as Error).message });
      }
    });
    if (token.current !== my) return;
    setPhase("done");
    onUploaded();
  };

  const retry = () => {
    const failed = entries.filter((e) => e.up === "fail");
    if (!failed.length) return;
    setPhase("upload");
    void upload(failed, token.current);
  };

  /* ---------- view ---------- */
  const radius = pileBox / 2;
  const size = pileThumb(radius * 0.8, entries.length);
  const failed = entries.filter((e) => e.up === "fail");
  const sent = entries.filter((e) => e.up === "done" && e.target !== DUP).length;
  const toSend = entries.filter((e) => e.target !== DUP).length;
  const showCards = phase !== "idle";
  const flying = phase === "fly" || phase === "upload" || phase === "done";

  const onDrop = async (ev: React.DragEvent) => {
    ev.preventDefault();
    setDragging(false);
    void add(await filesFromDrop(ev.dataTransfer.items));
  };

  return (
    <section
      ref={stage}
      className={`sort-stage card${dragging ? " drag" : ""}`}
      onDragOver={(e) => (e.preventDefault(), setDragging(true))}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => void onDrop(e)}
      aria-label="整理照片"
    >
      <input ref={fileInput} type="file" accept="image/*,.heic,.heif" multiple hidden onChange={(e) => (void add([...(e.target.files ?? [])]), (e.target.value = ""))} />
      <input ref={dirInput} type="file" multiple hidden {...{ webkitdirectory: "" }} onChange={(e) => (void add([...(e.target.files ?? [])]), (e.target.value = ""))} />

      {showCards && (
        <div className="sort-counters" aria-live="polite">
          <span>
            <b ref={(el) => void (counters.current.total = el)}>{flying ? "" : 0}</b>
            <small>/ {entries.length} 張</small>
          </span>
          <span>
            <b ref={(el) => void (counters.current.days = el)}>0</b>
            <small>天</small>
          </span>
          <span>
            <b ref={(el) => void (counters.current.dup = el)}>0</b>
            <small>重複</small>
          </span>
        </div>
      )}

      <div className="sort-pile-wrap" style={{ height: phase === "scan" || phase === "ready" || phase === "fly" ? pileBox : undefined }}>
        {phase === "idle" ? (
          <div className="sort-drop">
            <p className="sort-drop-title">把照片或資料夾拖到這裡</p>
            <div className="sort-drop-btns">
              <button type="button" className="btn" onClick={() => fileInput.current?.click()}>
                選擇照片
              </button>
              <button type="button" className="btn ghost" onClick={() => dirInput.current?.click()}>
                選擇資料夾
              </button>
            </div>
            <p className="small muted">照片會依拍攝日期放進每一天，只有你看得到。</p>
          </div>
        ) : phase === "upload" || phase === "done" ? null : (
          <div ref={pile} className="sort-pile" style={{ width: pileBox, height: pileBox }}>
            {entries.map((e, i) => {
              const at = spiral(i, entries.length, radius * 0.8, size);
              return (
                <div
                  key={e.key}
                  ref={(el) => void (el ? pileImgs.current.set(e.key, el) : pileImgs.current.delete(e.key))}
                  className={`sort-chip${e.thumb ? "" : " blank"}${e.scanned ? " in" : ""}`}
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
        {phase === "done" && (
          <div className="sort-badge" role="status">
            <span className="sort-check" aria-hidden>
              ✓
            </span>
            <b>{sent} 張放好了</b>
            {failed.length > 0 && <span className="small">{failed.length} 張沒上傳成功</span>}
          </div>
        )}
      </div>

      <div className="sort-status">
        {phase === "scan" && (
          <p className="small muted">
            讀取中 {read} / {entries.length}
          </p>
        )}
        {phase === "ready" && (
          <button type="button" className="btn sort-go" onClick={start}>
            開始整理 {entries.length} 張
          </button>
        )}
        {phase === "fly" && <p className="small muted">整理中…</p>}
        {phase === "upload" && (
          <p className="small muted">
            上傳中 {sent} / {toSend}（可以繼續看照片，別關掉頁面）
          </p>
        )}
        {phase === "done" && (
          <div className="sort-done-btns">
            {failed.length > 0 && (
              <button type="button" className="btn" onClick={retry}>
                重試 {failed.length} 張
              </button>
            )}
            <button type="button" className="btn ghost" onClick={clear}>
              再加照片
            </button>
          </div>
        )}
        {(phase === "ready" || phase === "scan") && (
          <button type="button" className="btn ghost small" onClick={clear}>
            取消
          </button>
        )}
        {skipped.video > 0 && <p className="small muted">影片這一版還不收，略過 {skipped.video} 支。</p>}
      </div>

      {showCards && (
        <ul className="sort-cards" aria-label="每一天">
          {targets.map((t) => {
            const pr = progress[t];
            const ahead = flying ? null : entries.filter((e) => e.target === t).length;
            return (
              <li
                key={t}
                ref={(el) => void (el ? cards.current.set(t, el) : cards.current.delete(t))}
                className={`sort-card${t === DUP ? " dup" : t === UNSORTED ? " unsorted" : ""}${ahead ? " has" : ""}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- local object URL */}
                <img alt="" />
                <span className="sort-label">{t === DUP ? "重複" : t === UNSORTED ? "未分類" : short(t)}</span>
                <span className="sort-n">{flying ? "" : ahead ? `+${ahead}` : ""}</span>
                {pr && pr.all > 0 && (
                  <span className="sort-bar" aria-hidden>
                    <i style={{ transform: `scaleX(${pr.done / pr.all})` }} />
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div ref={layer} className="sort-layer" aria-hidden />
      {toast && (
        <p className="sort-toast" role="status">
          {toast}
        </p>
      )}
    </section>
  );
}
