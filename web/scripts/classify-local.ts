import { execFileSync } from "node:child_process";
import { mkdirSync, openSync, readdirSync, readFileSync, readSync, closeSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/*
 * Classifies Kai's trip photos on his Mac (docs/PHOTOS-PLAN.md, "Local classification"). Photos stay in the
 * inbox folder outside the repository; this script only reads them.
 *
 *   npm run photos:scan              read the inbox, write numbered contact sheets + manifest to a temp folder
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

type Row = { n: number; file: string; fingerprint: string; local: string | null; day: string | null; screenshot: boolean };

function listImages(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith(".")) continue;
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...listImages(p));
    else if (IMAGE.test(name)) out.push(p);
  }
  return out;
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
  const exifr = (await import("exifr")).default;
  const sharp = (await import("sharp")).default;
  mkdirSync(INBOX, { recursive: true });
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const trip = await tripContext();
  const files = listImages(INBOX);
  const rows: Row[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const fingerprint = await fileFingerprint(file);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    let local: string | null = null;
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
        img = await thumb(path.join(INBOX, r.file), inner);
      } catch {
        img = await sharp({ create: { width: inner, height: inner, channels: 3, background: "#d9d3c4" } }).jpeg().toBuffer();
      }
      layers.push({ input: img, left, top });
      const label = `#${r.n}`;
      const w = 14 * label.length + 12;
      layers.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="30"><rect width="100%" height="100%" fill="#000"/><text x="6" y="23" font-family="Helvetica" font-weight="bold" font-size="22" fill="#fff">${label}</text></svg>`), left, top });
    }
    const out = path.join(OUT, `sheet-${s + 1}.jpg`);
    await sharp({ create: { width: SHEET_COLS * SHEET_CELL, height, channels: 3, background: "#faf7f0" } }).composite(layers).jpeg({ quality: 85 }).toFile(out);
    sheets.push(out);
  }
  writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify({ trip: trip.tripId, rows }, null, 1));
  console.log(JSON.stringify({ inbox: INBOX, photos: files.length, unique: rows.length, screenshots: rows.filter((r) => r.screenshot).length, undated: rows.filter((r) => !r.day && !r.screenshot).length, sheets }, null, 1));
}

async function apply(answerFile: string) {
  const { parseClassification, SCREENSHOT } = await import("../src/domain/photo-sort");
  const { saveLabels } = await import("../src/server/my-photos");
  const manifest = JSON.parse(readFileSync(path.join(OUT, "manifest.json"), "utf8")) as { trip: string; rows: Row[] };
  const got = parseClassification(readFileSync(answerFile, "utf8"), manifest.rows.length);
  const trip = await tripContext();
  if (trip.tripId !== manifest.trip) throw new Error("the manifest belongs to another trip; run scan again");
  const labels = manifest.rows
    .map((r) => ({ fingerprint: r.fingerprint, category: r.screenshot ? SCREENSHOT : got.get(r.n), dayDate: r.day }))
    .filter((l): l is { fingerprint: string; category: NonNullable<typeof l.category>; dayDate: string | null } => !!l.category);
  const res = await saveLabels(trip.tripId, trip.doc.days, labels);
  const byDay: Record<string, number> = {};
  const byCat: Record<string, number> = {};
  for (const r of manifest.rows) {
    const c = r.screenshot ? SCREENSHOT : got.get(r.n);
    if (!c) continue;
    byDay[r.day ?? "未分類"] = (byDay[r.day ?? "未分類"] ?? 0) + 1;
    byCat[c] = (byCat[c] ?? 0) + 1;
  }
  console.log(JSON.stringify({ ...res, missing: manifest.rows.length - labels.length, byDay, byCat }, null, 1));
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
