/*
 * Kai's photo bytes live in a PRIVATE Vercel Blob store (docs/PHOTOS-PLAN.md). This module is the only place
 * that talks to it, so tests mock one module. The SDK reads BLOB_READ_WRITE_TOKEN or the store's OIDC
 * connection itself; this code only checks that one of them is present and never reads their values.
 */

export function blobConfigured(): boolean {
  return !!(process.env.BLOB_READ_WRITE_TOKEN?.trim() || process.env.BLOB_STORE_ID?.trim());
}

/** Stores one JPEG privately; returns the pathname to keep in the row. */
export async function putJpeg(pathname: string, bytes: Uint8Array): Promise<string> {
  const { put } = await import("@vercel/blob");
  const r = await put(pathname, new Blob([bytes as BlobPart], { type: "image/jpeg" }), { access: "private", addRandomSuffix: true, contentType: "image/jpeg" });
  return r.pathname;
}

/** A readable stream of a stored JPEG, or null when it is gone. */
export async function readJpeg(pathname: string): Promise<ReadableStream<Uint8Array> | null> {
  const { get } = await import("@vercel/blob");
  const r = await get(pathname, { access: "private" });
  return r && r.statusCode === 200 ? r.stream : null;
}

/** Deletes stored files; missing ones are not an error. */
export async function deleteBlobs(pathnames: string[]): Promise<void> {
  if (!pathnames.length) return;
  const { del } = await import("@vercel/blob");
  await del(pathnames);
}
