/*
 * Browser side of Kai's photo upload (docs/PHOTOS-PLAN.md): hash the original, read EXIF time and GPS before
 * decoding, decode (HEIC through a lazily loaded converter only when the browser cannot), resize to a
 * 2048 px display copy and a 480 px thumbnail, and send both with the metadata. Canvas output has no EXIF,
 * so the stored images carry no GPS.
 */

export type Prepared = { display: Blob; thumb: Blob; meta: { sha256: string; fileName: string; exifTime: string | null; exifOffset: string | null; lat: number | null; lng: number | null; width: number; height: number } };

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

async function readExif(file: File) {
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

export async function preparePhoto(file: File): Promise<Prepared> {
  const [hash, exif] = await Promise.all([sha256(file), readExif(file)]);
  const img = await decode(file);
  try {
    const d = await resize(img, DISPLAY, 0.85);
    const t = await resize(img, THUMB, 0.78);
    return { display: d.blob, thumb: t.blob, meta: { sha256: hash, fileName: file.name.slice(0, 200), ...exif, width: d.w, height: d.h } };
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
