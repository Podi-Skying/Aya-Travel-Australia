/*
 * Browser side of Kai's photo upload (docs/PHOTOS-PLAN.md): hash the original, read EXIF time and GPS before
 * decoding, decode (HEIC through a lazily loaded converter only when the browser cannot), resize to a
 * 2048 px display copy and a 480 px thumbnail, and send both with the metadata. Canvas output has no EXIF,
 * so the stored images carry no GPS.
 */

import { printRanges } from "@/domain/photo-sort";

export type Prepared = { display: Blob; thumb: Blob; meta: { sha256: string; fingerprint: string | null; fileName: string; exifTime: string | null; exifOffset: string | null; lat: number | null; lng: number | null; width: number; height: number } };

const DISPLAY = 2048;
const THUMB = 480;

async function sha256(file: Blob): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const pad = (n: number) => String(n).padStart(2, "0");

/** exifr turns DateTimeOriginal into a Date in the browser's zone; this gives back the camera's wall time. */
function wall(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (v instanceof Date && !isNaN(v.getTime())) return `${v.getFullYear()}:${pad(v.getMonth() + 1)}:${pad(v.getDate())} ${pad(v.getHours())}:${pad(v.getMinutes())}:${pad(v.getSeconds())}`;
  return null;
}

const hex = (d: ArrayBuffer) => [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** 'size:sha256' of the first, middle and last 64 KB: finds duplicates without reading big files whole. */
export async function fingerprint(file: Blob): Promise<string> {
  const parts = await Promise.all(printRanges(file.size).map(([a, b]) => file.slice(a, b).arrayBuffer()));
  return `${file.size}:${hex(await crypto.subtle.digest("SHA-256", await new Blob(parts).arrayBuffer()))}`;
}

export type Exif = { exifTime: string | null; exifOffset: string | null; lat: number | null; lng: number | null };

export async function readExif(file: File): Promise<Exif> {
  try {
    const exifr = (await import("exifr")).default;
    const t = (await exifr.parse(file, { pick: ["DateTimeOriginal", "CreateDate", "OffsetTimeOriginal", "OffsetTime"], gps: false, reviveValues: false })) as Record<string, unknown> | undefined;
    const g = await exifr.gps(file).catch(() => null);
    const ok = (n: unknown) => typeof n === "number" && isFinite(n);
    return {
      exifTime: wall(t?.DateTimeOriginal ?? t?.CreateDate),
      exifOffset: (t?.OffsetTimeOriginal ?? t?.OffsetTime ?? null) as string | null,
      lat: g && ok(g.latitude) && ok(g.longitude) ? g.latitude : null,
      lng: g && ok(g.latitude) && ok(g.longitude) ? g.longitude : null,
    };
  } catch {
    return { exifTime: null, exifOffset: null, lat: null, lng: null };
  }
}

const isHeic = (f: File) => /heic|heif/i.test(f.type) || /\.(heic|heif)$/i.test(f.name);

async function decode(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch (e) {
    if (!isHeic(file)) throw e;
    const heic2any = (await import("heic2any")).default;
    const out = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 });
    return createImageBitmap(Array.isArray(out) ? out[0] : out, { imageOrientation: "from-image" });
  }
}

function resize(img: ImageBitmap, long: number, quality: number): Promise<{ blob: Blob; w: number; h: number }> {
  const s = Math.min(1, long / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * s));
  const h = Math.max(1, Math.round(img.height * s));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, w, h);
  return new Promise((ok, bad) => c.toBlob((b) => (b ? ok({ blob: b, w, h }) : bad(new Error("encode"))), "image/jpeg", quality));
}

/** A small square-ish preview for the sorting stage; null when the browser cannot decode the file (HEIC off Safari). */
export async function tinyThumb(file: File, size = 96): Promise<string | null> {
  try {
    const img = await createImageBitmap(file, { imageOrientation: "from-image" });
    try {
      const s = size / Math.min(img.width, img.height);
      const c = document.createElement("canvas");
      c.width = c.height = size;
      c.getContext("2d")!.drawImage(img, (size - img.width * s) / 2, (size - img.height * s) / 2, img.width * s, img.height * s);
      const b = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/jpeg", 0.7));
      return b ? URL.createObjectURL(b) : null;
    } finally {
      img.close();
    }
  } catch {
    return null;
  }
}

export async function preparePhoto(file: File, known?: { fingerprint?: string; exif?: Exif }): Promise<Prepared> {
  const [hash, exif, print] = await Promise.all([sha256(file), known?.exif ?? readExif(file), known?.fingerprint ?? fingerprint(file)]);
  const img = await decode(file);
  try {
    const d = await resize(img, DISPLAY, 0.85);
    const t = await resize(img, THUMB, 0.78);
    return { display: d.blob, thumb: t.blob, meta: { sha256: hash, fingerprint: print, fileName: file.name.slice(0, 200), ...exif, width: d.w, height: d.h } };
  } finally {
    img.close();
  }
}

/** Sends one prepared photo; progress 0–1 through XHR (fetch has no upload progress). */
export function sendPhoto(p: Prepared, onProgress: (f: number) => void): Promise<{ status: number; body: unknown }> {
  const form = new FormData();
  form.append("display", p.display, "display.jpg");
  form.append("thumb", p.thumb, "thumb.jpg");
  form.append("meta", JSON.stringify(p.meta));
  return new Promise((ok, bad) => {
    const x = new XMLHttpRequest();
    x.open("POST", "/api/my-photos");
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    x.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(x.responseText);
      } catch {}
      ok({ status: x.status, body });
    };
    x.onerror = () => bad(new Error("network"));
    x.send(form);
  });
}
