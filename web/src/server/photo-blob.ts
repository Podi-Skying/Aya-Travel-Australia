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

/** Size and type of a stored file, or null when it is not there. */
export async function blobInfo(pathname: string): Promise<{ size: number; contentType: string } | null> {
  const { head } = await import("@vercel/blob");
  try {
    const r = await head(pathname);
    return { size: r.size, contentType: r.contentType };
  } catch {
    return null;
  }
}

/** A read-only URL for one private file that stops working after `seconds`; the CDN serves ranges for seeking. */
export async function signedReadUrl(pathname: string, seconds: number): Promise<string> {
  const { issueSignedToken, presignUrl } = await import("@vercel/blob");
  const validUntil = Date.now() + seconds * 1000;
  const token = await issueSignedToken({ pathname, operations: ["get"], validUntil });
  const r = await presignUrl(token, { operation: "get", pathname, validUntil, access: "private" });
  return r.presignedUrl;
}

/** A readable stream of any stored file (videos for download), or null when it is gone. */
export async function readBlob(pathname: string): Promise<{ stream: ReadableStream<Uint8Array>; contentType: string; size: number | null } | null> {
  const { get } = await import("@vercel/blob");
  const r = await get(pathname, { access: "private" });
  if (!r || r.statusCode !== 200) return null;
  return { stream: r.stream, contentType: r.blob.contentType, size: r.blob.size ?? null };
}

/**
 * Answers the browser's request for a one-hour token to put one video straight into the store. `check`
 * runs first (owner, path, room left) and returns the largest size allowed; nothing is stored here.
 */
export async function videoUploadToken(request: Request, body: unknown, check: (pathname: string, clientPayload: string | null) => Promise<number>): Promise<unknown> {
  const { handleUpload } = await import("@vercel/blob/client");
  return handleUpload({
    request,
    body: body as Parameters<typeof handleUpload>[0]["body"],
    onBeforeGenerateToken: async (pathname, clientPayload) => ({
      maximumSizeInBytes: await check(pathname, clientPayload),
      allowedContentTypes: ["video/mp4", "video/quicktime", "video/webm"],
      addRandomSuffix: true,
      validUntil: Date.now() + 3600_000,
    }),
  });
}
