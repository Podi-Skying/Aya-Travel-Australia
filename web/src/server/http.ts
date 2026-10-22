import { checkOwner, type Owner } from "./owner";

export const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });

export const fail = (status: number, error: string, extra: Record<string, unknown> = {}) => json({ error, ...extra }, status);

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** Same-origin check for cookie-authenticated mutations (CSRF defence). */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return !!host && new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Reads a JSON body with a size cap. */
export async function readJson(req: Request, maxBytes: number): Promise<unknown> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > maxBytes) throw new HttpError(413, "內容太大");
  const text = await req.text();
  if (new TextEncoder().encode(text).length > maxBytes) throw new HttpError(413, "內容太大");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "JSON 格式錯誤");
  }
}

type OwnerHandler = (req: Request, owner: Owner) => Promise<Response>;

/** Wraps an owner API handler: 401 without session, 403 for non-owner or foreign Origin on mutations. */
export function ownerRoute(handler: OwnerHandler) {
  return async (req: Request): Promise<Response> => {
    const c = await checkOwner();
    if (!c.ok) return c.reason === "unauthenticated" ? fail(401, "請先登入") : fail(403, "沒有權限");
    if (req.method !== "GET" && req.method !== "HEAD" && !sameOrigin(req)) return fail(403, "來源不符");
    try {
      return await handler(req, c.owner);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) return fail(e.status, e.message, e.extra);
  console.error(e);
  return fail(500, "伺服器錯誤");
}
