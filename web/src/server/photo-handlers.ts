import { z } from "zod";
import { errorResponse, fail, HttpError, json, readJson, sameOrigin } from "./http";
import { missingConfig } from "./config";
import { photoViewersEnabled } from "./auth";
import { addViewer, createLink, linkTrip, listViewers, photoAccess, removeViewer, revokeLink, VIEWER_COOKIE, type PhotoAccess } from "./photo-access";
import { deletePhoto, listPhotos, MAX_DISPLAY, MAX_THUMB, patchBody, photoStream, resortPhotos, updatePhoto, uploadMeta, uploadPhoto } from "./my-photos";
import { routeQuota } from "./sharing";

/* Route bodies for /api/my-photos/* and /p/<token> (docs/PHOTOS-PLAN.md), kept outside app/ for tests. */

type Ctx<P> = { params: Promise<P> };

/** One body for everyone who may not see photos, so the answer never tells whether any exist. */
const denied = () => fail(401, "需要登入或照片連結");

async function guard(req: Request, ownerOnly: boolean): Promise<PhotoAccess | Response> {
  const missing = missingConfig("owner");
  if (missing.length) return fail(503, "伺服器設定未完成", { missing });
  const a = await photoAccess(req);
  if (!a || (ownerOnly && a.kind !== "owner")) return denied();
  if (req.method !== "GET" && req.method !== "HEAD" && !sameOrigin(req)) return fail(403, "來源不符");
  return a;
}

const run = (h: () => Promise<Response>) => h().catch(errorResponse);

export async function getMyPhotos(req: Request) {
  return run(async () => {
    const a = await guard(req, false);
    if (a instanceof Response) return a;
    return json({ ...(await listPhotos(a)), viewersEnabled: a.kind === "owner" ? photoViewersEnabled() : undefined });
  });
}

const MAX_UPLOAD = MAX_DISPLAY + MAX_THUMB + 20_000;

export async function postMyPhoto(req: Request) {
  return run(async () => {
    const a = await guard(req, true);
    if (a instanceof Response) return a;
    if (a.kind !== "owner") return denied();
    if (Number(req.headers.get("content-length") ?? "0") > MAX_UPLOAD) throw new HttpError(413, "照片太大");
    if (!(await routeQuota(`photo-upload:${a.owner.githubId}`, 600, false))) throw new HttpError(429, "上傳太頻繁，請稍後再試");
    const form = await req.formData().catch(() => null);
    const display = form?.get("display");
    const thumb = form?.get("thumb");
    const metaRaw = form?.get("meta");
    if (!(display instanceof Blob) || !(thumb instanceof Blob) || typeof metaRaw !== "string") throw new HttpError(400, "缺少照片");
    let parsed: unknown;
    try {
      parsed = JSON.parse(metaRaw);
    } catch {
      throw new HttpError(400, "JSON 格式錯誤");
    }
    const meta = uploadMeta.safeParse(parsed);
    if (!meta.success) throw new HttpError(400, "照片資料格式錯誤");
    const r = await uploadPhoto(a.owner, a.tripId, new Uint8Array(await display.arrayBuffer()), new Uint8Array(await thumb.arrayBuffer()), meta.data);
    return json(r, r.duplicate ? 200 : 201);
  });
}

export async function patchMyPhoto(req: Request, ctx: Ctx<{ id: string }>) {
  return run(async () => {
    const a = await guard(req, true);
    if (a instanceof Response) return a;
    if (a.kind !== "owner") return denied();
    const { id } = await ctx.params;
    const body = patchBody.safeParse(await readJson(req, 4_000));
    if (!body.success) throw new HttpError(400, "格式錯誤");
    return json({ photo: await updatePhoto(a.owner, a.tripId, id, body.data) });
  });
}

export async function deleteMyPhoto(req: Request, ctx: Ctx<{ id: string }>) {
  return run(async () => {
    const a = await guard(req, true);
    if (a instanceof Response) return a;
    const { id } = await ctx.params;
    await deletePhoto(a.tripId, id);
    return json({ ok: true });
  });
}

export async function postResort(req: Request) {
  return run(async () => {
    const a = await guard(req, true);
    if (a instanceof Response) return a;
    if (a.kind !== "owner") return denied();
    return json({ changed: await resortPhotos(a.owner, a.tripId) });
  });
}

export async function getMyPhotoFile(req: Request, ctx: Ctx<{ id: string; size: string }>) {
  return run(async () => {
    const a = await guard(req, false);
    if (a instanceof Response) return a;
    const { id, size } = await ctx.params;
    if (size !== "thumb" && size !== "full") return fail(404, "找不到");
    const stream = await photoStream(a, id, size);
    if (!stream) return fail(404, "找不到");
    return new Response(stream, {
      headers: { "content-type": "image/jpeg", "x-content-type-options": "nosniff", "cache-control": "private, max-age=3600", "x-robots-tag": "noindex" },
    });
  });
}

/* ---------- who may see them (owner) ---------- */

const viewerBody = z.object({ kind: z.enum(["github", "email"]), value: z.string().min(1).max(200), label: z.string().max(60).default("") }).strict();

export async function getViewers(req: Request) {
  return run(async () => {
    const a = await guard(req, true);
    if (a instanceof Response) return a;
    if (a.kind !== "owner") return denied();
    return json({ enabled: photoViewersEnabled(), ...(await listViewers(a.owner)) });
  });
}

export async function postViewer(req: Request) {
  return run(async () => {
    const a = await guard(req, true);
    if (a instanceof Response) return a;
    if (a.kind !== "owner") return denied();
    const b = viewerBody.safeParse(await readJson(req, 2_000));
    if (!b.success) throw new HttpError(400, "格式錯誤");
    if (b.data.kind === "github" && !/^\d{1,20}$/.test(b.data.value.trim())) throw new HttpError(400, "GitHub 帳號要填數字 id");
    if (b.data.kind === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.data.value.trim())) throw new HttpError(400, "Email 格式錯誤");
    return json({ viewer: await addViewer(a.owner, b.data.kind, b.data.value, b.data.label) }, 201);
  });
}

export async function deleteViewer(req: Request, ctx: Ctx<{ id: string }>) {
  return run(async () => {
    const a = await guard(req, true);
    if (a instanceof Response) return a;
    if (a.kind !== "owner") return denied();
    const { id } = await ctx.params;
    if (/^[0-9a-f-]{36}$/.test(id)) await removeViewer(a.owner, id);
    return json({ ok: true });
  });
}

export async function postLink(req: Request) {
  return run(async () => {
    const a = await guard(req, true);
    if (a instanceof Response) return a;
    if (a.kind !== "owner") return denied();
    const b = z.object({ label: z.string().max(60).default("") }).strict().safeParse(await readJson(req, 1_000));
    if (!b.success) throw new HttpError(400, "格式錯誤");
    const l = await createLink(a.owner, b.data.label);
    if (!l) throw new HttpError(404, "找不到行程");
    return json({ id: l.id, url: `${new URL(req.url).origin}/p/${l.token}` }, 201);
  });
}

export async function deleteLink(req: Request, ctx: Ctx<{ id: string }>) {
  return run(async () => {
    const a = await guard(req, true);
    if (a instanceof Response) return a;
    if (a.kind !== "owner") return denied();
    const { id } = await ctx.params;
    if (/^[0-9a-f-]{36}$/.test(id)) await revokeLink(a.owner, id);
    return json({ ok: true });
  });
}

/** /p/<token>: a valid link sets the viewer cookie and opens /photos; anything else gets one plain answer. */
export async function openViewerLink(req: Request, ctx: Ctx<{ token: string }>) {
  return run(async () => {
    const { token } = await ctx.params;
    const origin = new URL(req.url).origin;
    if (!photoViewersEnabled() || !(await linkTrip(token))) return Response.redirect(`${origin}/photos?link=invalid`, 303);
    const secure = origin.startsWith("https:") ? "; Secure" : "";
    return new Response(null, {
      status: 303,
      headers: {
        location: `${origin}/photos`,
        "set-cookie": `${VIEWER_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 3600}${secure}`,
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      },
    });
  });
}
