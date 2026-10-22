/* Small fetch wrapper. Network failures become { offline: true } so the UI can say so. */

export type ApiResult<T> = { ok: true; status: number; data: T; cached?: boolean } | { ok: false; status: number; error: string; offline?: boolean; data?: Record<string, unknown> };

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? "GET",
      headers: init.body === undefined ? undefined : { "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    return { ok: false, status: 0, error: "目前離線，無法連線到伺服器", offline: true };
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (res.ok) return { ok: true, status: res.status, data: data as T, cached: res.headers.get("x-aya-offline") === "1" };
  const d = (data ?? {}) as Record<string, unknown>;
  return { ok: false, status: res.status, error: typeof d.error === "string" ? d.error : `錯誤 ${res.status}`, data: d };
}

export function registerServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  if (process.env.NODE_ENV !== "production") return;
  const v = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";
  navigator.serviceWorker.register(`/sw.js?v=${encodeURIComponent(v)}`).catch(() => {});
}
