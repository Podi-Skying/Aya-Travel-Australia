/*
 * Videos next to Kai's photos (docs/PHOTOS-PLAN.md, "Videos"). Pure rules shared by the browser, the server
 * and the Mac script: what counts as a video, where its time comes from, where the poster frame is taken,
 * how small the stored copy is, and how much of the free Blob store may be used.
 */

export const VIDEO_EXT = /\.(mp4|mov|m4v|webm)$/i;
export const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"] as const;

export const isVideoName = (name: string) => VIDEO_EXT.test(name);
export const isVideoFile = (f: { name: string; type?: string }) => !f.name.startsWith(".") && (VIDEO_EXT.test(f.name) || /^video\/(mp4|quicktime|webm|x-m4v)$/.test(f.type ?? ""));

/** Copies Kai's Mac made in 照片待分類/已壓縮; the original next to it is the same video. */
export const COMPRESSED_DIR = "已壓縮";

/** Stored copy: long edge 1280 px, H.264 about 1.8 Mbps, AAC 128 kbps (about 15 MB a minute). */
export const VIDEO_LONG_EDGE = 1280;
export const VIDEO_BITRATE = 1_800_000;
export const AUDIO_BITRATE = 128_000;
/** A file already this small is uploaded as it is. */
export const KEEP_BITRATE = 2_500_000;
/** When the browser cannot encode, an original up to this size is uploaded unchanged. */
export const MAX_RAW_VIDEO = 50_000_000;
/** Above this a video goes up in parts. */
export const MULTIPART_FROM = 100_000_000;
export const MAX_VIDEO_BYTES = 500_000_000;

/**
 * The one storage setting. Vercel Blob Hobby includes 1 GB; going over is not billed but locks the store
 * for 30 days, so uploads stop at 90 % and a warning shows from 75 %. Raise this after moving to Pro.
 */
export const STORAGE_LIMIT_BYTES = 1_000_000_000;
export const storageCaps = (limit = STORAGE_LIMIT_BYTES) => ({ limit, refuse: Math.floor(limit * 0.9), warn: Math.floor(limit * 0.75) });

export type StorageLevel = "ok" | "warn" | "full";
export function storageLevel(used: number, limit = STORAGE_LIMIT_BYTES): StorageLevel {
  const c = storageCaps(limit);
  return used >= c.refuse ? "full" : used >= c.warn ? "warn" : "ok";
}
/** Whether `adding` more bytes still fits under the refuse line. */
export const fitsStorage = (used: number, adding: number, limit = STORAGE_LIMIT_BYTES) => used + adding <= storageCaps(limit).refuse;

export const mb = (bytes: number) => `${Math.round(bytes / 1_000_000).toLocaleString()} MB`;
export const gbOrMb = (bytes: number) => (bytes >= 1_000_000_000 && bytes % 1_000_000_000 === 0 ? `${bytes / 1_000_000_000} GB` : mb(bytes));

/** The poster frame: one second in, or 15 % of a shorter clip. */
export const posterTime = (durationSec: number) => (isFinite(durationSec) && durationSec > 0 ? Math.min(1, durationSec * 0.15) : 0);

/** Whether a video can be stored as it is: MP4 with H.264, small enough frame and bitrate. */
export function keepAsIs(v: { container: string; codec: string | null; width: number; height: number; bytes: number; durationSec: number }): boolean {
  if (v.container !== "mp4" || v.codec !== "avc") return false;
  if (Math.max(v.width, v.height) > VIDEO_LONG_EDGE) return false;
  return v.durationSec > 0 && (v.bytes * 8) / v.durationSec <= KEEP_BITRATE;
}

/** The frame size of the stored copy: long edge 1280, even numbers, never larger than the original. */
export function targetSize(w: number, h: number): { width: number; height: number } {
  const s = Math.min(1, VIDEO_LONG_EDGE / Math.max(w, h, 1));
  const even = (n: number) => Math.max(2, Math.round((n * s) / 2) * 2);
  return { width: even(w), height: even(h) };
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * A video's time as the EXIF-style pair the photo code already reads. iPhones write
 * com.apple.quicktime.creationdate with the zone ('2026-11-15T14:30:12+1100'); most cameras only write the
 * UTC creation time in the file header, which becomes an offset of +00:00.
 */
export function quicktimeTime(apple: string | null | undefined, utc: Date | string | null | undefined): { exifTime: string; exifOffset: string } | null {
  const m = apple?.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})$/);
  if (m) {
    const off = m[7] === "Z" ? "+00:00" : m[7].replace(/^([+-]\d{2}):?(\d{2})$/, "$1:$2");
    return { exifTime: `${m[1]}:${m[2]}:${m[3]} ${m[4]}:${m[5]}:${m[6]}`, exifOffset: off };
  }
  const d = typeof utc === "string" ? new Date(utc) : utc;
  // 1904 and 1970 are what an empty header decodes to.
  if (!d || isNaN(d.getTime()) || d.getUTCFullYear() < 2000) return null;
  return { exifTime: `${d.getUTCFullYear()}:${pad(d.getUTCMonth() + 1)}:${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`, exifOffset: "+00:00" };
}

/** '1:05' or '12:03:09' for a duration in milliseconds. */
export function clock(ms: number | null | undefined): string {
  if (!ms || ms < 0) return "";
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const mi = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(mi)}:${pad(s % 60)}` : `${mi}:${pad(s % 60)}`;
}

/** Where an uploaded video lives in the private store; the server accepts no other path. */
export const VIDEO_PATH = /^trip-videos\/[0-9a-f-]{36}\/video(?:-[A-Za-z0-9]{1,40})?\.(?:mp4|mov|webm)$/;
