/*
 * A small uncompressed (STORE) ZIP writer for the photo export. JPEGs do not shrink when deflated, so storing
 * them is as small and much cheaper. The caller computes each file's CRC from its bytes and may then pass the
 * bytes on as a Blob, so the archive is assembled from parts without one big copy in memory.
 * Limits: classic ZIP (no ZIP64), so under 4 GB and 65,535 files; the export stays far below both.
 */

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 of bytes, continuing from `prev` (pass the previous result to hash in pieces). */
export function crc32(bytes: Uint8Array, prev = 0): number {
  let c = ~prev >>> 0;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

export const ZIP_MAX_BYTES = 0xfffffffe;
export const ZIP_MAX_FILES = 0xffff;

function dosTime(d: Date) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = (Math.max(0, d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

type Part = Uint8Array<ArrayBuffer> | Blob;

export class ZipWriter {
  private parts: Part[] = [];
  private central: Uint8Array<ArrayBuffer>[] = [];
  private offset = 0;
  private count = 0;
  private enc = new TextEncoder();

  /** Adds one file. `data` may be a Blob holding exactly `size` bytes whose CRC is `crc`. */
  add(name: string, data: Uint8Array | Blob, crc: number, size: number, when = new Date()) {
    if (this.count + 1 > ZIP_MAX_FILES || this.offset + size + 30 + name.length * 3 > ZIP_MAX_BYTES) throw new Error("zip-too-big");
    const nameBytes = this.enc.encode(name);
    const { time, date } = dosTime(when);
    const local = new Uint8Array(30 + nameBytes.length);
    const v = new DataView(local.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, 0x0800, true); // UTF-8 names
    v.setUint16(8, 0, true); // STORE
    v.setUint16(10, time, true);
    v.setUint16(12, date, true);
    v.setUint32(14, crc, true);
    v.setUint32(18, size, true);
    v.setUint32(22, size, true);
    v.setUint16(26, nameBytes.length, true);
    v.setUint16(28, 0, true);
    local.set(nameBytes, 30);

    const cd = new Uint8Array(46 + nameBytes.length);
    const w = new DataView(cd.buffer);
    w.setUint32(0, 0x02014b50, true);
    w.setUint16(4, 20, true);
    w.setUint16(6, 20, true);
    w.setUint16(8, 0x0800, true);
    w.setUint16(10, 0, true);
    w.setUint16(12, time, true);
    w.setUint16(14, date, true);
    w.setUint32(16, crc, true);
    w.setUint32(20, size, true);
    w.setUint32(24, size, true);
    w.setUint16(28, nameBytes.length, true);
    w.setUint32(42, this.offset, true);
    cd.set(nameBytes, 46);

    this.parts.push(local, data instanceof Blob ? data : new Uint8Array(data));
    this.central.push(cd);
    this.offset += local.length + size;
    this.count++;
  }

  /** The archive's parts, ready for `new Blob(parts, { type: "application/zip" })`. */
  finish(): Part[] {
    const cdSize = this.central.reduce((n, c) => n + c.length, 0);
    const end = new Uint8Array(22);
    const v = new DataView(end.buffer);
    v.setUint32(0, 0x06054b50, true);
    v.setUint16(8, this.count, true);
    v.setUint16(10, this.count, true);
    v.setUint32(12, cdSize, true);
    v.setUint32(16, this.offset, true);
    return [...this.parts, ...this.central, end];
  }
}
