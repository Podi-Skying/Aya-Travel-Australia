import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, closeSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/*
 * Classifies Kai's trip photos on his Mac (docs/PHOTOS-PLAN.md, "Local classification"). Photos stay in the
 * inbox folder outside the repository; this script only reads them.
 *
 *   npm run photos:scan              read the inbox, write numbered contact sheets + manifest to a temp folder;
 *                                    videos are also shrunk to 720p into 照片待分類/已壓縮 (ffmpeg, else avconvert)
 *   npm run photos:apply -- <file>   store the categories Claude gave (JSON or '#1：風景' lines) as labels
 *
 * Labels are keyed by the same fingerprint the browser computes, so the site applies them on upload and
 * back-fills photos already uploaded. Nothing here prints the database URL.
 */

const HERE = typeof __dirname !== "undefined" ? __dirname : path.join(process.cwd(), "scripts");
const ROOT = path.resolve(HERE, "..", "..", "..");
export const INBOX = process.env.PHOTO_INBOX ?? path.join(ROOT, "照片待分類");
export const OUT = process.env.PHOTO_SHEETS ?? path.join(os.tmpdir(), "aya-photo-sheets");
const IMAGE = /\.(jpe?g|png|gif|webp|bmp|tiff?|heic|heif|avif)$/i;
const VIDEO = /\.(mp4|mov|m4v|webm)$/i;
const SHRUNK = "已壓縮";

/** `alt`: the fingerprint of the 720p copy in 已壓縮, so the label also fits when that copy is uploaded. */
type Row = { n: number; file: string; fingerprint: string; local: string | null; day: string | null; screenshot: boolean; video?: boolean; alt?: string | null };

function listImages(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith(".") || name === SHRUNK) continue;
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...listImages(p));
    else if (IMAGE.test(name) || VIDEO.test(name)) out.push(p);
  }
  return out;
}

const has = (cmd: string) => {
  try {
    execFileSync("/usr/bin/which", [cmd], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

/** Creation time and length from the file header (ffprobe; Spotlight's date when ffprobe is missing). */
function probe(file: string): { apple: string | null; utc: string | null; durationSec: number } {
  if (has("ffprobe")) {
    try {
      const j = JSON.parse(execFileSync("ffprobe", ["-v", "quiet", "-print_format", "json", "-show_format", file], { encoding: "utf8" })) as { format?: { duration?: string; tags?: Record<string, string> } };
      const tags = j.format?.tags ?? {};
      return { apple: tags["com.apple.quicktime.creationdate"] ?? null, utc: tags.creation_time ?? null, durationSec: Number(j.format?.duration ?? 0) || 0 };
    } catch {}
  }
  try {
    const out = execFileSync("mdls", ["-raw", "-name", "kMDItemContentCreationDate", file], { encoding: "utf8" }).trim();
    return { apple: null, utc: out && out !== "(null)" ? out.replace(" ", "T").replace(" +0000", "Z") : null, durationSec: 0 };
  } catch {
    return { apple: null, utc: null, durationSec: 0 };
  }
}

/** The poster frame as a JPEG path (ffmpeg at min(1 s, 15 %); Quick Look's thumbnail otherwise). */
function poster(file: string, at: number): string {
  const out = path.join(OUT, `poster-${process.pid}.jpg`);
  rmSync(out, { force: true });
  if (has("ffmpeg")) {
    execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", String(at), "-i", file, "-frames:v", "1", "-vf", "scale='min(1024,iw)':-2", out], { stdio: "ignore" });
    return out;
  }
  const dir = path.join(OUT, `ql-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir);
  execFileSync("qlmanage", ["-t", "-s", "1024", "-o", dir, file], { stdio: "ignore" });
  const png = readdirSync(dir).find((n) => n.endsWith(".png"));
  if (!png) throw new Error("no frame");
  execFileSync("sips", ["-s", "format", "jpeg", path.join(dir, png), "--out", out], { stdio: "ignore" });
  rmSync(dir, { recursive: true, force: true });
  return out;
}

/**
 * The 720p copy in 照片待分類/已壓縮/<name>.mp4 (kept between runs). Only the creation time is carried over,
 * so the copy has no GPS; avconvert's metadata filter drops location as well.
 */
function shrink(file: string, apple: string | null, utc: string | null): string | null {
  const dir = path.join(INBOX, SHRUNK);
  mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `${path.basename(file).replace(/\.[^.]*$/, "")}.mp4`);
  if (existsSync(out)) return out;
  const tmp = `${out}.part.mp4`;
  rmSync(tmp, { force: true });
  try {
    if (has("ffmpeg")) {
      const keep = [...(utc ? ["-metadata", `creation_time=${utc}`] : []), ...(apple ? ["-metadata", `com.apple.quicktime.creationdate=${apple}`] : [])];
      execFileSync(
        "ffmpeg",
        ["-v", "error", "-y", "-i", file, "-map", "0:v:0", "-map", "0:a:0?", "-map_metadata", "-1", ...keep, "-vf", "scale='if(gte(iw,ih),min(1280,iw),-2)':'if(gte(iw,ih),-2,min(1280,ih))'", "-c:v", "libx264", "-preset", "medium", "-b:v", "1800k", "-maxrate", "2200k", "-bufsize", "3600k", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart+use_metadata_tags", tmp],
        { stdio: "ignore" },
      );
    } else execFileSync("avconvert", ["--preset", "Preset1280x720", "--source", file, "--output", tmp, "--replace"], { stdio: "ignore" });
    renameSync(tmp, out);
    return out;
  } catch {
    rmSync(tmp, { force: true });
    return null;
  }
}

/** The browser's fingerprint, from a file on disk (reads only the three 64 KB slices). */
export async function fileFingerprint(file: string): Promise<string> {
  const { fingerprintOf } = await import("../src/domain/photo-sort");
  const size = statSync(file).size;
  const fd = openSync(file, "r");
  try {
    return await fingerprintOf(size, async (a, b) => {
      const buf = Buffer.alloc(b - a);
      readSync(fd, buf, 0, b - a, a);
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.length);
    });
  } finally {
    closeSync(fd);
  }
}

async function thumb(file: string, size: number): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  try {
    return await sharp(file).rotate().resize(size, size, { fit: "cover" }).jpeg({ quality: 80 }).toBuffer();
  } catch {
    // HEIC and other formats sharp cannot read: let macOS convert first.
    const tmp = path.join(OUT, `conv-${process.pid}.jpg`);
    execFileSync("sips", ["-s", "format", "jpeg", "-Z", "1024", file, "--out", tmp], { stdio: "ignore" });
    const b = await sharp(tmp).rotate().resize(size, size, { fit: "cover" }).jpeg({ quality: 80 }).toBuffer();
    rmSync(tmp, { force: true });
    return b;
  }
}

async function tripContext() {
  const { getCurrentTrip } = await import("../src/server/trips");
  const owner = { githubId: (process.env.OWNER_GITHUB_IDS ?? "").split(",")[0].trim() } as never;
  const t = await getCurrentTrip(owner);
  if (!t) throw new Error("no trip for the owner");
  return t;
}

async function scan() {
  const { exifLocal, fileNameLocal, dayFor } = await import("../src/domain/photo-day");
  const { isScreenshotName, SHEET_CELL, SHEET_COLS, SHEET_MAX } = await import("../src/domain/photo-sort");
  const { posterTime, quicktimeTime } = await import("../src/domain/video");
  const exifr = (await import("exifr")).default;
  const sharp = (await import("sharp")).default;
  mkdirSync(INBOX, { recursive: true });
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const trip = await tripContext();
  const files = listImages(INBOX);
  const rows: Row[] = [];
  const seen = new Set<string>();
  const frames = new Map<number, string>();
  let shrunk = 0;
  let notShrunk = 0;
  for (const file of files) {
    const fingerprint = await fileFingerprint(file);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    let local: string | null = null;
    if (VIDEO.test(file)) {
      const p = probe(file);
      const t = quicktimeTime(p.apple, p.utc);
      local = (t ? exifLocal(t.exifTime, t.exifOffset)?.local : null) ?? fileNameLocal(path.basename(file))?.local ?? null;
      const n = rows.length + 1;
      try {
        const f = poster(file, posterTime(p.durationSec));
        const keep = path.join(OUT, `frame-${n}.jpg`);
        renameSync(f, keep);
        frames.set(n, keep);
      } catch {}
      process.stderr.write(`壓縮影片 ${path.basename(file)}…\n`);
      const copy = shrink(file, p.apple, p.utc);
      if (copy) shrunk++;
      else notShrunk++;
      rows.push({ n, file: path.relative(INBOX, file), fingerprint, local, day: dayFor(local, trip.doc.days), screenshot: false, video: true, alt: copy ? await fileFingerprint(copy) : null });
      continue;
    }
    try {
      const t = (await exifr.parse(file, { pick: ["DateTimeOriginal", "CreateDate", "OffsetTimeOriginal", "OffsetTime"], reviveValues: false })) as Record<string, string> | undefined;
      local = exifLocal(t?.DateTimeOriginal ?? t?.CreateDate, t?.OffsetTimeOriginal ?? t?.OffsetTime)?.local ?? null;
    } catch {}
    local ??= fileNameLocal(path.basename(file))?.local ?? null;
    const screenshot = isScreenshotName(path.basename(file));
    rows.push({ n: rows.length + 1, file: path.relative(INBOX, file), fingerprint, local, day: screenshot ? null : dayFor(local, trip.doc.days), screenshot });
  }
  const inner = SHEET_CELL - 12;
  const sheets: string[] = [];
  for (let s = 0; s * SHEET_MAX < rows.length; s++) {
    const page = rows.slice(s * SHEET_MAX, (s + 1) * SHEET_MAX);
    const height = Math.ceil(page.length / SHEET_COLS) * SHEET_CELL;
    const layers: { input: Buffer; left: number; top: number }[] = [];
    for (const [i, r] of page.entries()) {
      const left = (i % SHEET_COLS) * SHEET_CELL + 6;
      const top = Math.floor(i / SHEET_COLS) * SHEET_CELL + 6;
      let img: Buffer;
      try {
        img = await thumb(r.video ? (frames.get(r.n) ?? "") : path.join(INBOX, r.file), inner);
      } catch {
        img = await sharp({ create: { width: inner, height: inner, channels: 3, background: "#d9d3c4" } }).jpeg().toBuffer();
      }
      layers.push({ input: img, left, top });
      if (r.video)
        layers.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="34" height="30"><rect width="34" height="30" fill="#000" fill-opacity=".6"/><path d="M11 6 L26 15 L11 24 Z" fill="#fff"/></svg>`), left, top: top + inner - 30 });
      const label = `#${r.n}`;
      const w = 14 * label.length + 12;
      layers.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="30"><rect width="100%" height="100%" fill="#000"/><text x="6" y="23" font-family="Helvetica" font-weight="bold" font-size="22" fill="#fff">${label}</text></svg>`), left, top });
    }
    const out = path.join(OUT, `sheet-${s + 1}.jpg`);
    await sharp({ create: { width: SHEET_COLS * SHEET_CELL, height, channels: 3, background: "#faf7f0" } }).composite(layers).jpeg({ quality: 85 }).toFile(out);
    sheets.push(out);
  }
  writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify({ trip: trip.tripId, rows }, null, 1));
  for (const f of frames.values()) rmSync(f, { force: true });
  const videos = rows.filter((r) => r.video).length;
  console.log(JSON.stringify({ inbox: INBOX, files: files.length, unique: rows.length, photos: rows.length - videos, videos, shrunk, notShrunk, screenshots: rows.filter((r) => r.screenshot).length, undated: rows.filter((r) => !r.day && !r.screenshot).length, sheets }, null, 1));
}

async function apply(answerFile: string) {
  const { parseClassification, SCREENSHOT } = await import("../src/domain/photo-sort");
  const { saveLabels } = await import("../src/server/my-photos");
  const manifest = JSON.parse(readFileSync(path.join(OUT, "manifest.json"), "utf8")) as { trip: string; rows: Row[] };
  const got = parseClassification(readFileSync(answerFile, "utf8"), manifest.rows.length);
  const trip = await tripContext();
  if (trip.tripId !== manifest.trip) throw new Error("the manifest belongs to another trip; run scan again");
  const labels = manifest.rows
    .flatMap((r) => [r.fingerprint, ...(r.alt ? [r.alt] : [])].map((fingerprint) => ({ fingerprint, category: r.screenshot ? SCREENSHOT : got.get(r.n), dayDate: r.day })))
    .filter((l): l is { fingerprint: string; category: NonNullable<typeof l.category>; dayDate: string | null } => !!l.category);
  const res = await saveLabels(trip.tripId, trip.doc.days, labels);
  const byDay: Record<string, number> = {};
  const byCat: Record<string, number> = {};
  let videos = 0;
  let missing = 0;
  for (const r of manifest.rows) {
    const c = r.screenshot ? SCREENSHOT : got.get(r.n);
    if (!c) {
      missing++;
      continue;
    }
    if (r.video) videos++;
    byDay[r.day ?? "未分類"] = (byDay[r.day ?? "未分類"] ?? 0) + 1;
    byCat[c] = (byCat[c] ?? 0) + 1;
  }
  console.log(JSON.stringify({ ...res, missing, videos, byDay, byCat }, null, 1));
}

if (process.argv[1]?.endsWith("classify-local.ts")) {
  const [cmd, arg] = process.argv.slice(2);
  (cmd === "scan" ? scan() : cmd === "apply" && arg ? apply(arg) : Promise.reject(new Error("usage: classify-local scan | apply <answers>")))
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
