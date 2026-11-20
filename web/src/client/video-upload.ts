"use client";

import { fingerprint, type Exif } from "./photo-upload";
import { AUDIO_BITRATE, keepAsIs, MAX_RAW_VIDEO, MULTIPART_FROM, posterTime, quicktimeTime, targetSize, VIDEO_BITRATE } from "@/domain/video";

/*
 * Browser side of Kai's videos (docs/PHOTOS-PLAN.md, "Videos"). Reading: time from the QuickTime/MP4
 * header, a poster frame at min(1 s, 15 %), size and length. Upload: the video is re-encoded to H.264
 * 720p with WebCodecs (Mediabunny, loaded only when a video is picked), put straight into the private store
 * with a one-video token, then the poster frame and details are sent to make the row.
 */

export type VideoInfo = { exif: Exif; durationSec: number; width: number; height: number; container: string; codec: string | null };

const NO_EXIF: Exif = { exifTime: null, exifOffset: null, lat: null, lng: null };

/** Thrown when this browser cannot shrink a video that is too big to send as it is. */
export class NeedsMac extends Error {
  constructor() {
    super("請放進 Mac 的照片待分類，我幫你壓縮");
  }
}

const mb = () => import("mediabunny");

async function open(file: Blob) {
  const m = await mb();
  return { m, input: new m.Input({ source: new m.BlobSource(file), formats: m.ALL_FORMATS }) };
}

/** ISO 6709 '+42.8821+147.3272+010.000/' from com.apple.quicktime.location.ISO6709. */
function iso6709(v: unknown): { lat: number; lng: number } | null {
  const m = typeof v === "string" ? v.match(/^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)/) : null;
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

const rawText = (v: unknown) => (typeof v === "string" ? v : v instanceof Uint8Array ? new TextDecoder().decode(v) : null);

/** Time, place, size and length; never throws (an unreadable file just has no time). */
export async function readVideo(file: File): Promise<VideoInfo> {
  try {
    const { input } = await open(file);
    try {
      const [tags, track, durationSec, format] = await Promise.all([input.getMetadataTags(), input.getPrimaryVideoTrack(), input.computeDuration(), input.getFormat()]);
      const raw = (tags.raw ?? {}) as Record<string, unknown>;
      const t = quicktimeTime(rawText(raw["com.apple.quicktime.creationdate"]), tags.creationTime ?? tags.date ?? null);
      const pos = iso6709(rawText(raw["com.apple.quicktime.location.ISO6709"]));
      return {
        exif: { exifTime: t?.exifTime ?? null, exifOffset: t?.exifOffset ?? null, lat: pos?.lat ?? null, lng: pos?.lng ?? null },
        durationSec,
        width: track?.displayWidth ?? 0,
        height: track?.displayHeight ?? 0,
        container: /mp4|quicktime|mov/i.test(format.name) ? (/quicktime|mov/i.test(format.name) ? "mov" : "mp4") : format.name.toLowerCase(),
        codec: track?.codec ?? null,
      };
    } finally {
      input.dispose();
    }
  } catch {
    return { exif: NO_EXIF, durationSec: 0, width: 0, height: 0, container: "", codec: null };
  }
}

function jpeg(c: HTMLCanvasElement | OffscreenCanvas, quality: number): Promise<Blob> {
  if ("convertToBlob" in c) return c.convertToBlob({ type: "image/jpeg", quality });
  return new Promise((ok, bad) => c.toBlob((b) => (b ? ok(b) : bad(new Error("encode"))), "image/jpeg", quality));
}

function scaled(src: CanvasImageSource & { width: number; height: number }, long: number, square = false): HTMLCanvasElement {
  const c = document.createElement("canvas");
  if (square) {
    c.width = c.height = long;
    const s = long / Math.min(src.width, src.height);
    c.getContext("2d")!.drawImage(src, (long - src.width * s) / 2, (long - src.height * s) / 2, src.width * s, src.height * s);
    return c;
  }
  const s = Math.min(1, long / Math.max(src.width, src.height));
  c.width = Math.max(1, Math.round(src.width * s));
  c.height = Math.max(1, Math.round(src.height * s));
  const g = c.getContext("2d")!;
  g.imageSmoothingQuality = "high";
  g.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

/** One frame through a plain <video> element: the fallback when Mediabunny cannot decode the file. */
function frameByElement(file: File): Promise<{ canvas: HTMLCanvasElement; durationSec: number }> {
  return new Promise((ok, bad) => {
    const v = document.createElement("video");
    const url = URL.createObjectURL(file);
    const done = (e?: Error) => {
      URL.revokeObjectURL(url);
      v.removeAttribute("src");
      if (e) bad(e);
    };
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.onerror = () => done(new Error("decode"));
    v.onloadedmetadata = () => (v.currentTime = posterTime(v.duration));
    v.onseeked = () => {
      const c = document.createElement("canvas");
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      c.getContext("2d")!.drawImage(v, 0, 0);
      const durationSec = v.duration;
      done();
      ok({ canvas: c, durationSec });
    };
    v.src = url;
  });
}

async function posterCanvas(file: File, durationSec: number): Promise<HTMLCanvasElement> {
  try {
    const { m, input } = await open(file);
    try {
      const track = await input.getPrimaryVideoTrack();
      if (!track || !(await track.canDecode())) throw new Error("decode");
      const sink = new m.CanvasSink(track, { width: Math.min(2048, track.displayWidth), poolSize: 0 });
      const w = await sink.getCanvas(posterTime(durationSec));
      if (!w) throw new Error("frame");
      const c = document.createElement("canvas");
      c.width = w.canvas.width;
      c.height = w.canvas.height;
      c.getContext("2d")!.drawImage(w.canvas, 0, 0);
      return c;
    } finally {
      input.dispose();
    }
  } catch {
    return (await frameByElement(file)).canvas;
  }
}

/** A square preview for the sorting stage, or null when no frame can be read. */
export async function videoThumb(file: File, durationSec: number, size = 256): Promise<string | null> {
  try {
    const b = await jpeg(scaled(await posterCanvas(file, durationSec), size, true), 0.78);
    return URL.createObjectURL(b);
  } catch {
    return null;
  }
}

async function sha256(file: Blob): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Writes a new MP4: re-encoded to H.264 (long edge 1280, ~1.8 Mbps) + AAC, or with `encode` false only
 * re-packed as it is. Either way only the creation time is kept from the original's tags, so the stored
 * file carries no GPS (like the photos, whose canvas copies have no EXIF). `onProgress` gets 0–1.
 */
async function convert(file: File, info: VideoInfo, encode: boolean, onProgress: (f: number) => void): Promise<Blob> {
  const m = await mb();
  if (encode && !(await m.canEncodeVideo("avc"))) throw new NeedsMac();
  const audio = encode && (await m.canEncodeAudio("aac")) ? "aac" : null;
  const input = new m.Input({ source: new m.BlobSource(file), formats: m.ALL_FORMATS });
  try {
    const output = new m.Output({ format: new m.Mp4OutputFormat({ fastStart: "in-memory" }), target: new m.BufferTarget() });
    const size = targetSize(info.width || 1280, info.height || 720);
    const conv = await m.Conversion.init({
      input,
      output,
      video: encode ? { codec: "avc", ...(info.width >= info.height ? { width: size.width } : { height: size.height }), bitrate: new m.Quality({ bitrate: VIDEO_BITRATE }) } : {},
      audio: !encode ? {} : audio ? { codec: audio, bitrate: new m.Quality({ bitrate: AUDIO_BITRATE }) } : { discard: true },
      tags: (t) => ({ creationTime: t.creationTime ?? null }),
      showWarnings: false,
    });
    if (!conv.isValid) throw new NeedsMac();
    conv.onProgress = (p) => onProgress(p);
    await conv.execute();
    const buf = (output.target as InstanceType<typeof m.BufferTarget>).buffer;
    if (!buf) throw new Error("encode");
    return new Blob([buf], { type: "video/mp4" });
  } finally {
    input.dispose();
  }
}

export type PreparedVideo = {
  video: Blob;
  ext: "mp4" | "mov" | "webm";
  display: Blob;
  thumb: Blob;
  meta: { sha256: string; fingerprint: string | null; category: string | null; fileName: string; exifTime: string | null; exifOffset: string | null; lat: number | null; lng: number | null; width: number; height: number; durationMs: number | null };
};

/**
 * What gets stored for one video. `onProgress` reports the compression (0–1). Small MP4/H.264 files are
 * only re-packed; a video this browser cannot shrink is re-packed up to 50 MB, else NeedsMac.
 */
export async function prepareVideo(file: File, known: { fingerprint?: string; info?: VideoInfo; category?: string | null }, onProgress: (f: number) => void): Promise<PreparedVideo> {
  const info = known.info ?? (await readVideo(file));
  const print = known.fingerprint ?? (await fingerprint(file));
  let video: Blob;
  const small = keepAsIs({ ...info, bytes: file.size });
  try {
    video = await convert(file, info, !small, onProgress);
  } catch (e) {
    if (small || file.size > MAX_RAW_VIDEO) throw e instanceof NeedsMac ? e : new NeedsMac();
    try {
      video = await convert(file, info, false, onProgress);
    } catch {
      throw new NeedsMac();
    }
  }
  const ext = "mp4" as const;
  const frame = await posterCanvas(file, info.durationSec);
  const big = scaled(frame, 2048);
  const display = await jpeg(big, 0.85);
  const thumb = await jpeg(scaled(frame, 480), 0.78);
  return {
    video,
    ext,
    display,
    thumb,
    meta: {
      sha256: await sha256(video),
      fingerprint: print,
      category: known.category ?? null,
      fileName: file.name.slice(0, 200),
      ...info.exif,
      width: big.width,
      height: big.height,
      durationMs: info.durationSec ? Math.round(info.durationSec * 1000) : null,
    },
  };
}

/** Puts the video in the store with a one-video token, then makes the row. Progress 0–1 covers the upload. */
export async function sendVideo(p: PreparedVideo, onProgress: (f: number) => void): Promise<{ status: number; body: unknown }> {
  const { upload } = await import("@vercel/blob/client");
  const blob = await upload(`trip-videos/${crypto.randomUUID()}/video.${p.ext}`, p.video, {
    access: "private",
    handleUploadUrl: "/api/my-photos/video/token",
    clientPayload: JSON.stringify({ bytes: p.video.size }),
    contentType: p.ext === "webm" ? "video/webm" : p.ext === "mov" ? "video/quicktime" : "video/mp4",
    multipart: p.video.size > MULTIPART_FROM,
    onUploadProgress: (e) => onProgress(e.percentage / 100),
  }).catch((e: Error) => {
    // The token route refused (store full, not signed in) or the network dropped.
    throw new Error(/token/i.test(e.message) ? "空間不夠或沒有權限放影片" : "網路中斷");
  });
  const form = new FormData();
  form.append("display", p.display, "poster.jpg");
  form.append("thumb", p.thumb, "thumb.jpg");
  form.append("meta", JSON.stringify({ ...p.meta, videoPath: blob.pathname }));
  const r = await fetch("/api/my-photos/video", { method: "POST", body: form });
  let body: unknown = null;
  try {
    body = await r.json();
  } catch {}
  return { status: r.status, body };
}
