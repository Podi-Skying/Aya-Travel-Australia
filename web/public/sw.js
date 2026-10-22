/*
 * Offline support (FR-24, PLAN.md 4.8). Cache name is tied to the build id passed
 * in the registration URL, so a new deploy replaces old cached assets.
 * Navigations and trip JSON: network first, cache fallback. Static assets: cache first.
 * Never cached: auth routes, mutations, redirects and error responses.
 */
const VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
const CACHE = `aya-${VERSION}`;
const PRECACHE = ["/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("aya-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function cacheable(res) {
  return res && res.ok && res.type === "basic" && !res.redirected;
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (cacheable(res)) cache.put(req, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(req, { ignoreVary: true });
    if (!hit) throw e;
    // Mark cached fallbacks so the page can say it is showing an offline copy.
    const headers = new Headers(hit.headers);
    headers.set("x-aya-offline", "1");
    return new Response(hit.body, { status: hit.status, statusText: hit.statusText, headers });
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (cacheable(res)) cache.put(req, res.clone());
  return res;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/auth")) return;
  if (req.mode === "navigate") return event.respondWith(networkFirst(req));
  if (url.pathname === "/api/trip" || url.pathname === "/api/trip/versions" || /^\/api\/s\/[^/]+$/.test(url.pathname)) return event.respondWith(networkFirst(req));
  if (url.pathname.startsWith("/_next/static/") || PRECACHE.includes(url.pathname)) return event.respondWith(cacheFirst(req));
});
