/*
 * Sorting helpers for Kai's own photos (docs/PHOTOS-PLAN.md, "Sorting stage"): screenshot names, the
 * content categories inside a day, reading a Claude chat's reply that classified a numbered contact
 * sheet, and the export file layout. Pure, so the browser and the server agree and tests need no DOM.
 */

/** Content categories inside a trip day. 其他 is the fallback for anything that does not match. */
export const CATEGORIES = ["風景", "美食", "合照", "動物", "住宿", "交通", "截圖", "其他"] as const;
export type Category = (typeof CATEGORIES)[number];
export const SCREENSHOT: Category = "截圖";
export const OTHER: Category = "其他";

/** What each category means, for the prompt a Claude chat reads next to the contact sheets. */
export const CATEGORY_HINTS: Record<Category, string> = {
  風景: "outdoor scenery, landmarks, streets, sky, sea, nature",
  美食: "food, drinks, restaurants, cafes, menus",
  合照: "people are the main subject: selfies, group photos, portraits",
  動物: "animals and wildlife",
  住宿: "hotel rooms, holiday houses, lobbies, the view from where we stayed",
  交通: "planes, airports, cars, buses, ferries, trains, road signs, tickets",
  截圖: "phone screenshots: apps, maps, messages, bookings",
  其他: "anything that fits none of the above",
};

export const isCategory = (v: unknown): v is Category => typeof v === "string" && (CATEGORIES as readonly string[]).includes(v);

const SCREENSHOT_NAME = /screen ?shot|screen ?recording|螢幕截圖|螢幕快照|截圖|截屏|螢幕錄影|录屏|錄屏|スクリーンショット/i;

/** A phone screenshot by its file name (Screenshot_20261115-…, 螢幕截圖 2026-11-15…). */
export const isScreenshotName = (name: string) => SCREENSHOT_NAME.test(name);

/** 'size:sha256' over the first, middle and last 64 KB; equal files give equal prints without reading them whole. */
export const FINGERPRINT = /^\d{1,12}:[0-9a-f]{64}$/;
export const PRINT_CHUNK = 65_536;

/**
 * The fingerprint itself, shared by the browser and the local classify script so both give the same print
 * for the same file. `read(a, b)` returns bytes a..b of the file.
 */
export async function fingerprintOf(size: number, read: (a: number, b: number) => Promise<ArrayBuffer | Uint8Array>): Promise<string> {
  const parts = await Promise.all(printRanges(size).map(([a, b]) => read(a, b)));
  const all = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let o = 0;
  for (const p of parts) {
    all.set(p instanceof Uint8Array ? p : new Uint8Array(p), o);
    o += p.byteLength;
  }
  const d = await crypto.subtle.digest("SHA-256", all);
  return `${size}:${[...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

/** The byte ranges a fingerprint reads, merged so a small file is read once. */
export function printRanges(size: number): [number, number][] {
  if (size <= PRINT_CHUNK * 3) return [[0, size]];
  const mid = Math.floor(size / 2 - PRINT_CHUNK / 2);
  return [
    [0, PRINT_CHUNK],
    [mid, mid + PRINT_CHUNK],
    [size - PRINT_CHUNK, size],
  ];
}

/** The category a reply names: exact, then one name inside the other ('美食' ↔ '美食咖啡'), else 其他. */
export function matchCategory(raw: string): Category {
  const s = raw.replace(/["'「」『』\s]/g, "").trim();
  if (isCategory(s)) return s;
  const hit = CATEGORIES.find((c) => s && (s.includes(c) || c.includes(s)));
  return hit ?? OTHER;
}

function jsonPart(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  for (const src of [fenced, text].filter(Boolean) as string[]) {
    const start = src.search(/[[{]/);
    if (start < 0) continue;
    const open = src[start];
    const end = src.lastIndexOf(open === "{" ? "}" : "]");
    if (end <= start) continue;
    try {
      return JSON.parse(src.slice(start, end + 1));
    } catch {}
  }
  return undefined;
}

/**
 * Numbers → categories from a Claude chat's reply. Reads {"1":"美食"}, {"results":[{"id":1,"category":"美食"}]},
 * a bare array of those, and lines like '#1：美食', '1. 美食', '1 - 美食' (full- or half-width colons).
 * Numbers outside 1..max are dropped; unknown names become 其他.
 */
export function parseClassification(text: string, max: number): Map<number, Category> {
  const out = new Map<number, Category>();
  const put = (n: unknown, c: unknown) => {
    const id = typeof n === "number" ? n : typeof n === "string" ? Number(n.replace(/^#/, "").trim()) : NaN;
    if (Number.isInteger(id) && id >= 1 && id <= max && typeof c === "string" && c.trim()) out.set(id, matchCategory(c));
  };
  const j = jsonPart(text);
  const list = Array.isArray(j) ? j : j && typeof j === "object" && Array.isArray((j as { results?: unknown }).results) ? (j as { results: unknown[] }).results : null;
  if (list) for (const r of list) if (r && typeof r === "object") put((r as { id?: unknown }).id, (r as { category?: unknown }).category);
  if (!list && j && typeof j === "object") for (const [k, v] of Object.entries(j)) put(k, v);
  if (out.size) return out;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*[-*]?\s*#?\s*(\d{1,4})\s*(?:[.、:：)）-]|\s-\s)\s*(.+?)\s*,?\s*$/);
    if (m) put(m[1], m[2]);
  }
  return out;
}

/** The text Kai pastes into a Claude chat together with the contact sheets. */
export function classificationPrompt(count: number, sheets: number): string {
  return [
    `I am attaching ${sheets} contact sheet image${sheets > 1 ? "s" : ""} of travel photos. Each photo has a number in its top-left corner, from #1 to #${count}.`,
    "Put every photo into exactly one of these categories (use the Chinese name exactly):",
    ...CATEGORIES.map((c) => `- ${c}: ${CATEGORY_HINTS[c]}`),
    'Reply with JSON only. Keys are the numbers, values are the category names, for example {"1":"風景","2":"美食"}.',
    "If I send the sheets in several messages, answer each message in the same format with only the numbers you can see.",
  ].join("\n");
}

/* Contact sheets: 7 columns of 224 px, at most 7 rows, so 49 photos on a 1568 px wide image. */
export const SHEET_COLS = 7;
export const SHEET_CELL = 224;
export const SHEET_MAX = 49;

export function sheetPages<T>(list: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += SHEET_MAX) out.push(list.slice(i, i + SHEET_MAX));
  return out;
}

/* Export layout */

/** A name that is safe inside a ZIP on Windows and macOS. */
export const safeName = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim() || "photo";

/** Adds ' (2)', ' (3)' before the extension when a folder already holds that name. */
export function uniqueName(name: string, taken: Set<string>): string {
  let n = name;
  for (let i = 2; taken.has(n.toLowerCase()); i++) n = name.replace(/(\.[^.]*)?$/, (ext) => ` (${i})${ext}`);
  taken.add(n.toLowerCase());
  return n;
}

/** CSV with a UTF-8 BOM so Excel shows the Chinese. Cells that start with = + - @ are quoted as text. */
export function toCsv(rows: (string | number | null)[][]): string {
  const cell = (v: string | number | null) => {
    let s = v == null ? "" : String(v);
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

/* Sorting stage geometry (the pile is a sunflower spiral; launches start slow and speed up). */

export const GOLDEN_DEG = 137.508;

export function pileThumb(radius: number, count: number, min = 16, max = 36): number {
  return Math.max(min, Math.min(max, (radius * 3.4) / Math.sqrt(Math.max(1, count))));
}

export function spiral(i: number, count: number, radius: number, size: number): { x: number; y: number } {
  const c = (radius - size * 0.35) / Math.sqrt(Math.max(1, count));
  const r = c * Math.sqrt(i + 0.5);
  const a = (i * GOLDEN_DEG * Math.PI) / 180;
  return { x: r * Math.cos(a), y: r * Math.sin(a) };
}

export const sortDuration = (count: number) => Math.max(4000, Math.min(20000, count * 25));

export const launchAt = (i: number, count: number, total: number) => total * Math.pow(i / Math.max(1, count), 0.6);

/** Point on a quadratic Bézier from a to b with control c, at t in 0..1. */
export function bezier(a: { x: number; y: number }, c: { x: number; y: number }, b: { x: number; y: number }, t: number) {
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
}
