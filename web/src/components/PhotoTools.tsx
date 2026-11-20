"use client";

import { useState } from "react";
import { thumbUrl, type MyPhoto } from "@/client/my-photos";
import { canSaveToFolder, contactSheets, download, exportCsv, exportName, exportToFolder, exportZip } from "@/client/photo-export";
import { fmtDay } from "@/domain/format";
import { classificationPrompt, OTHER, parseClassification, sheetPages, type Category } from "@/domain/photo-sort";
import type { TripDoc } from "@/domain/schema";

/*
 * Owner tools in the sorter's 設定 panel (docs/PHOTOS-PLAN.md): content categories through a Claude chat Kai
 * already uses (numbered contact sheets out, the JSON reply back in, no API key), and downloads.
 */

const SHEET_KEY = "aya-photo-sheet";

function loadOrder(): string[] {
  try {
    const v = JSON.parse(sessionStorage.getItem(SHEET_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
function saveOrder(keys: string[]) {
  try {
    sessionStorage.setItem(SHEET_KEY, JSON.stringify(keys));
  } catch {}
}

export type ClassifyItem = { key: string; src: string | null; video?: boolean };

/**
 * The three numbered steps. `items` are the photos still without a category; the numbers on the sheet are
 * kept (also across a reload) so a reply always maps back to the photos Claude saw.
 */
export function ClassifySteps({ items, onApply, onSkip, say }: { items: ClassifyItem[]; onApply: (got: Map<string, Category>) => Promise<number>; onSkip: () => Promise<void> | void; say: (t: string) => void }) {
  const [order, setOrder] = useState<string[]>(() => loadOrder().filter((k) => items.some((i) => i.key === k)));
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState("");
  const [copyText, setCopyText] = useState<string | null>(null);
  const ready = order.length > 0;

  const sheets = async () => {
    setBusy(true);
    try {
      const keys = items.map((i) => i.key);
      const { blob, name } = await contactSheets(sheetPages(items).map((pg) => pg.map((i) => ({ src: i.src, video: !!i.video }))));
      download(blob, name);
      saveOrder(keys);
      setOrder(keys);
    } catch {
      say("總表做不出來，請再試一次。");
    } finally {
      setBusy(false);
    }
  };
  const prompt = () => classificationPrompt(order.length, sheetPages(order).length);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt());
      say("提示詞已複製");
    } catch {
      setCopyText(prompt());
    }
  };
  const apply = async () => {
    const got = parseClassification(reply, order.length);
    if (!got.size) return say("讀不到分類結果，請貼上 Claude 回覆的整段文字。");
    const map = new Map<string, Category>();
    for (const [n, c] of got) if (order[n - 1]) map.set(order[n - 1], c);
    setBusy(true);
    try {
      const n = await onApply(map);
      const left = items.filter((i) => !map.has(i.key)).length;
      say(`已套用 ${n} 個，還有 ${left} 個未分類`);
      setReply("");
      if (!left) {
        saveOrder([]);
        setOrder([]);
      }
    } catch {
      say("存不進去，請再試一次。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ol className="srt-steps">
        <li>
          <b>下載分類總表</b>
          <p>把要分類的 {items.length} 個排成有編號的總表圖片（影片用封面，標 ▶）</p>
          <button type="button" className="srt-btn gold" disabled={busy || !items.length} onClick={() => void sheets()}>
            下載分類總表
          </button>
        </li>
        <li>
          <b>複製提示詞</b>
          <p>開一個 Claude 對話，貼上提示詞，再附上總表圖片</p>
          <button type="button" className="srt-btn" disabled={!ready} onClick={() => void copy()}>
            複製提示詞
          </button>
          {copyText && <textarea readOnly value={copyText} rows={4} onFocus={(e) => e.target.select()} aria-label="提示詞" />}
        </li>
        <li>
          <b>貼回 Claude 的回覆</b>
          <p>把回覆整段貼進來，按套用</p>
          <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={4} placeholder='{"1":"風景","2":"美食"}' aria-label="Claude 的回覆" disabled={!ready} />
          <button type="button" className="srt-btn gold" disabled={!ready || busy || !reply.trim()} onClick={() => void apply()}>
            套用分類結果
          </button>
        </li>
      </ol>
      <button type="button" className="srt-link" disabled={busy} onClick={() => void onSkip()}>
        略過分類，直接整理
      </button>
    </>
  );
}

/** Classifying photos already uploaded: results go straight to the server. */
export function LibraryClassify({ photos, onSaved, say }: { photos: MyPhoto[]; onSaved: () => void; say: (t: string) => void }) {
  const todo = photos.filter((p) => !p.category);
  const post = async (items: { id: string; category: string }[]) => {
    for (let i = 0; i < items.length; i += 500) {
      const r = await fetch("/api/my-photos/categories", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: items.slice(i, i + 500) }) });
      if (!r.ok) throw new Error(String(r.status));
    }
    onSaved();
  };
  if (!todo.length) return <p className="srt-note">{photos.length ? "已上傳的照片和影片都分類好了。" : "加入照片或影片之後就能分類。"}</p>;
  return (
    <ClassifySteps
      items={todo.map((p) => ({ key: p.id, src: thumbUrl(p.id), video: !!p.video }))}
      say={say}
      onApply={async (map) => {
        await post([...map].map(([id, category]) => ({ id, category })));
        return map.size;
      }}
      onSkip={() => post(todo.map((p) => ({ id: p.id, category: OTHER })))}
    />
  );
}

export function ExportPanel({ doc, photos, say }: { doc: TripDoc; photos: MyPhoto[]; say: (t: string) => void }) {
  const [day, setDay] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const days = doc.days.filter((d) => photos.some((p) => p.dayDate === d.date));
  const list = day ? photos.filter((p) => p.dayDate === day) : photos;
  if (!photos.length) return <p className="srt-note">上傳之後就能下載（影片是壓縮後的 720p 版本）。</p>;
  const run = async (what: "zip" | "folder") => {
    setProgress(0);
    try {
      if (what === "zip") download(await exportZip(doc, list, setProgress), `${exportName(day || "全部")}.zip`);
      else say(`已存到「${await exportToFolder(doc, list, setProgress)}」`);
    } catch (e) {
      if ((e as Error).name !== "AbortError") say("下載中斷，請再試一次。");
    } finally {
      setProgress(null);
    }
  };
  const busy = progress != null;
  return (
    <div className="srt-export">
      <select value={day} onChange={(e) => setDay(e.target.value)} aria-label="哪一天">
        <option value="">全部（{photos.length} 個）</option>
        {days.map((d) => (
          <option key={d.date} value={d.date}>
            {fmtDay(d.date)}（{photos.filter((p) => p.dayDate === d.date).length} 個）
          </option>
        ))}
      </select>
      <div className="srt-row">
        <button type="button" className="srt-btn gold" disabled={busy || !canSaveToFolder()} onClick={() => void run("folder")}>
          存到資料夾
        </button>
        <button type="button" className="srt-btn" disabled={busy} onClick={() => void run("zip")}>
          {busy ? `${Math.round(progress! * 100)}%` : "下載 ZIP"}
        </button>
        <button type="button" className="srt-btn" onClick={() => download(exportCsv(doc, list), `${exportName(day || "全部")}.csv`)}>
          清單 CSV
        </button>
      </div>
      {!canSaveToFolder() && <p className="srt-note">「存到資料夾」要用 Chrome 或 Edge。</p>}
    </div>
  );
}
