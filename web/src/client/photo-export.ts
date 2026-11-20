"use client";

import { fullUrl, itemName, type MyPhoto } from "./my-photos";
import { fmtDay } from "@/domain/format";
import { safeName, SHEET_CELL, SHEET_COLS, toCsv, uniqueName } from "@/domain/photo-sort";
import type { TripDoc } from "@/domain/schema";
import { crc32, ZipWriter } from "@/domain/zip";

/*
 * Owner-only export and contact sheets for Kai's photos (docs/PHOTOS-PLAN.md). Everything runs in the
 * browser from the photos he already uploaded; nothing goes to any other service.
 */

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

const dayNo = (doc: Pick<TripDoc, "days">, date: string | null) => (date ? doc.days.findIndex((d) => d.date === date) + 1 : 0);

function folderOf(doc: Pick<TripDoc, "days">, p: MyPhoto) {
  if (!p.dayDate) return "未分類";
  return safeName(`${p.dayDate} 第${dayNo(doc, p.dayDate)}天`);
}

function fileOf(p: MyPhoto) {
  const time = p.takenLocal && p.takenLocal.length >= 16 ? p.takenLocal.slice(11, 16).replace(":", "") + " " : "";
  const base = safeName((p.fileName ?? p.id).replace(/\.[^.]*$/, ""));
  return `${time}${base}.jpg`;
}

/** One ZIP of the photos (display copies), a folder per day. `onProgress` gets 0–1. */
export async function exportZip(doc: Pick<TripDoc, "days">, photos: MyPhoto[], onProgress: (f: number) => void): Promise<Blob> {
  const zip = new ZipWriter();
  const taken = new Map<string, Set<string>>();
  let i = 0;
  for (const p of photos) {
    const r = await fetch(fullUrl(p.id));
    if (!r.ok) throw new Error(`photo ${r.status}`);
    const blob = await r.blob();
    const crc = crc32(new Uint8Array(await blob.arrayBuffer()));
    const folder = folderOf(doc, p);
    const names = taken.get(folder) ?? new Set<string>();
    taken.set(folder, names);
    const when = p.takenLocal ? new Date(`${p.takenLocal.length >= 16 ? p.takenLocal : p.takenLocal + "T12:00"}:00`) : new Date();
    zip.add(`${folder}/${uniqueName(fileOf(p), names)}`, blob, crc, blob.size, isNaN(when.getTime()) ? new Date() : when);
    onProgress(++i / photos.length);
  }
  return new Blob(zip.finish(), { type: "application/zip" });
}

/** 檔名, 日期, 天數, 分類, 活動 — one row per photo, UTF-8 with BOM for Excel. */
export function exportCsv(doc: TripDoc, photos: MyPhoto[]): Blob {
  const rows: (string | number | null)[][] = [["檔名", "日期", "天數", "分類", "活動", "時間", "說明"]];
  for (const p of photos)
    rows.push([p.fileName ?? "", p.dayDate ?? "未分類", p.dayDate ? dayNo(doc, p.dayDate) : "", p.category ?? "", p.itemId ? itemName(doc, p) : "", p.takenLocal?.slice(11, 16) ?? "", p.caption ?? ""]);
  return new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
}

export const exportName = (what: string) => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `Aya旅行照片_${what}_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
};

export const dayLabel = (date: string) => fmtDay(date);

/**
 * One numbered contact sheet: 7 columns of 224 px, each photo centre-cropped with a 6 px margin, '#n' in
 * the top-left corner. `first` is the number of the first photo on this sheet. `srcs` are image URLs.
 */
export async function contactSheet(srcs: (string | null)[], first: number): Promise<Blob> {
  const rows = Math.ceil(srcs.length / SHEET_COLS);
  const c = document.createElement("canvas");
  c.width = SHEET_COLS * SHEET_CELL;
  c.height = rows * SHEET_CELL;
  const g = c.getContext("2d")!;
  g.fillStyle = "#faf7f0";
  g.fillRect(0, 0, c.width, c.height);
  const inner = SHEET_CELL - 12;
  await Promise.all(
    srcs.map(async (src, i) => {
      const x = (i % SHEET_COLS) * SHEET_CELL + 6;
      const y = Math.floor(i / SHEET_COLS) * SHEET_CELL + 6;
      try {
        if (!src) throw new Error("none");
        const r = await fetch(src);
        const img = await createImageBitmap(await r.blob());
        const s = inner / Math.min(img.width, img.height);
        g.save();
        g.beginPath();
        g.rect(x, y, inner, inner);
        g.clip();
        g.drawImage(img, x + (inner - img.width * s) / 2, y + (inner - img.height * s) / 2, img.width * s, img.height * s);
        g.restore();
        img.close();
      } catch {
        g.fillStyle = "#d9d3c4";
        g.fillRect(x, y, inner, inner);
      }
      const label = `#${first + i}`;
      g.font = "bold 22px system-ui, sans-serif";
      const w = g.measureText(label).width + 12;
      g.fillStyle = "#000";
      g.fillRect(x, y, w, 30);
      g.fillStyle = "#fff";
      g.fillText(label, x + 6, y + 23);
    }),
  );
  return new Promise((ok, bad) => c.toBlob((b) => (b ? ok(b) : bad(new Error("encode"))), "image/jpeg", 0.88));
}

/** All sheets: one JPEG, or a ZIP of them when there is more than one. */
export async function contactSheets(pages: (string | null)[][]): Promise<{ blob: Blob; name: string }> {
  const sheets: Blob[] = [];
  let n = 1;
  for (const page of pages) {
    sheets.push(await contactSheet(page, n));
    n += page.length;
  }
  if (sheets.length === 1) return { blob: sheets[0], name: "分類總表.jpg" };
  const zip = new ZipWriter();
  for (const [i, s] of sheets.entries()) zip.add(`分類總表-${i + 1}.jpg`, s, crc32(new Uint8Array(await s.arrayBuffer())), s.size);
  return { blob: new Blob(zip.finish(), { type: "application/zip" }), name: "分類總表.zip" };
}

/** Copies the photos into a folder Kai picks (Chrome and Edge), one sub-folder per day. Returns the folder name. */
export async function exportToFolder(doc: Pick<TripDoc, "days">, photos: MyPhoto[], onProgress: (f: number) => void): Promise<string> {
  const pick = (window as unknown as { showDirectoryPicker?: (o: { mode: string }) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
  if (!pick) throw new Error("unsupported");
  const root = await pick({ mode: "readwrite" });
  const name = exportName("整理好的照片");
  const top = await root.getDirectoryHandle(name, { create: true });
  const taken = new Map<string, Set<string>>();
  let i = 0;
  for (const p of photos) {
    const folder = folderOf(doc, p);
    const dir = await top.getDirectoryHandle(folder, { create: true });
    const names = taken.get(folder) ?? new Set<string>();
    taken.set(folder, names);
    const r = await fetch(fullUrl(p.id));
    if (!r.ok || !r.body) throw new Error(`photo ${r.status}`);
    const fh = await dir.getFileHandle(uniqueName(fileOf(p), names), { create: true });
    await r.body.pipeTo(await fh.createWritable());
    onProgress(++i / photos.length);
  }
  return name;
}

export const canSaveToFolder = () => typeof window !== "undefined" && "showDirectoryPicker" in window;
