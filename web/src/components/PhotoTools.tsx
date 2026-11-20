"use client";

import { useState } from "react";
import type { MyPhoto } from "@/client/my-photos";
import { contactSheets, download, exportCsv, exportName, exportZip } from "@/client/photo-export";
import { fmtDay } from "@/domain/format";
import { CATEGORIES, classificationPrompt, parseClassification, sheetPages } from "@/domain/photo-sort";
import type { TripDoc } from "@/domain/schema";

/*
 * Owner tools under 我的照片 (docs/PHOTOS-PLAN.md): sorting photos into content categories through a Claude
 * chat Kai already uses (numbered contact sheets out, a JSON reply back in, no API key), and downloading
 * the photos as a ZIP with a folder per day plus a CSV list.
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
function saveOrder(ids: string[]) {
  try {
    sessionStorage.setItem(SHEET_KEY, JSON.stringify(ids));
  } catch {}
}

export function ClassifyPanel({ photos, onSaved }: { photos: MyPhoto[]; onSaved: () => void }) {
  const todo = photos.filter((p) => !p.category);
  /* The numbers on the sheet must stay the ones Claude saw, also after a reload. */
  const [order, setOrder] = useState<string[]>(() => loadOrder().filter((id) => photos.some((p) => p.id === id)));
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [copyText, setCopyText] = useState<string | null>(null);
  const ready = order.length > 0;

  if (!todo.length && !ready) return null;

  const makeSheets = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const ids = todo.map((p) => p.id);
      const pages = sheetPages(todo);
      const { blob, name } = await contactSheets(pages);
      download(blob, name);
      saveOrder(ids);
      setOrder(ids);
    } catch {
      setMsg("總表做不出來，請再試一次。");
    } finally {
      setBusy(false);
    }
  };
  const prompt = () => classificationPrompt(order.length, sheetPages(order).length);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt());
      setMsg("已複製，貼到 Claude 對話，再附上總表圖片。");
    } catch {
      setCopyText(prompt());
    }
  };
  const apply = async () => {
    const got = parseClassification(reply, order.length);
    if (!got.size) return setMsg("讀不到分類結果。請貼上 Claude 回覆的整段 JSON。");
    const items = [...got].map(([n, category]) => ({ id: order[n - 1], category })).filter((x) => x.id);
    setBusy(true);
    try {
      for (let i = 0; i < items.length; i += 500) {
        const r = await fetch("/api/my-photos/categories", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: items.slice(i, i + 500) }) });
        if (!r.ok) throw new Error(String(r.status));
      }
      const left = order.filter((id) => !items.some((x) => x.id === id) && photos.find((p) => p.id === id && !p.category)).length;
      setMsg(`已套用 ${items.length} 張，還有 ${left} 張未分類。`);
      setReply("");
      if (!left) {
        saveOrder([]);
        setOrder([]);
      }
      onSaved();
    } catch {
      setMsg("存不進去，請再試一次。");
    } finally {
      setBusy(false);
    }
  };
  const skip = async () => {
    const items = todo.map((p) => ({ id: p.id, category: "其他" }));
    setBusy(true);
    try {
      for (let i = 0; i < items.length; i += 500)
        await fetch("/api/my-photos/categories", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: items.slice(i, i + 500) }) });
      saveOrder([]);
      setOrder([]);
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card my-classify">
      <h2>用 Claude 分類</h2>
      <p className="small muted">{todo.length} 張還沒有分類（{CATEGORIES.join("、")}）。</p>
      <ol className="my-steps">
        <li>
          <b>下載分類總表</b>
          <button type="button" className="btn small" disabled={busy || !todo.length} onClick={() => void makeSheets()}>
            下載
          </button>
        </li>
        <li>
          <b>複製提示詞</b>，和總表圖片一起貼到 Claude 對話
          <button type="button" className="btn small" disabled={!ready} onClick={() => void copy()}>
            複製
          </button>
          {copyText && <textarea readOnly value={copyText} rows={4} onFocus={(e) => e.target.select()} aria-label="提示詞" />}
        </li>
        <li>
          <b>貼回 Claude 的回覆</b>
          <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={3} placeholder='{"1":"風景","2":"美食"}' aria-label="Claude 的回覆" disabled={!ready} />
          <button type="button" className="btn small" disabled={!ready || busy || !reply.trim()} onClick={() => void apply()}>
            套用分類結果
          </button>
        </li>
      </ol>
      <button type="button" className="linkish small" disabled={busy || !todo.length} onClick={() => void skip()}>
        略過，全部放「其他」
      </button>
      {msg && <p className="small" role="status">{msg}</p>}
    </section>
  );
}

export function ExportPanel({ doc, photos }: { doc: TripDoc; photos: MyPhoto[] }) {
  const [day, setDay] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const days = doc.days.filter((d) => photos.some((p) => p.dayDate === d.date));
  const list = day ? photos.filter((p) => p.dayDate === day) : photos;
  if (!photos.length) return null;
  const zip = async () => {
    setErr(null);
    setProgress(0);
    try {
      const blob = await exportZip(doc, list, setProgress);
      download(blob, `${exportName(day || "全部")}.zip`);
    } catch {
      setErr("下載中斷，請再試一次。");
    } finally {
      setProgress(null);
    }
  };
  return (
    <section className="card my-export">
      <h2>下載</h2>
      <div className="my-export-row">
        <select value={day} onChange={(e) => setDay(e.target.value)} aria-label="哪一天">
          <option value="">全部（{photos.length} 張）</option>
          {days.map((d) => (
            <option key={d.date} value={d.date}>
              {fmtDay(d.date)}（{photos.filter((p) => p.dayDate === d.date).length} 張）
            </option>
          ))}
        </select>
        <button type="button" className="btn small" disabled={progress != null} onClick={() => void zip()}>
          {progress != null ? `${Math.round(progress * 100)}%` : "ZIP"}
        </button>
        <button type="button" className="btn ghost small" onClick={() => download(exportCsv(doc, list), `${exportName(day || "全部")}.csv`)}>
          清單 CSV
        </button>
      </div>
      {err && <p className="small error">{err}</p>}
    </section>
  );
}
