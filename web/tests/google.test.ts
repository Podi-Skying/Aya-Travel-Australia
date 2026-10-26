import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { asOwner, freshDb, OWNER_ID, req, signedOut } from "./helpers";
import { decodePolyline, findPlaceId, placePhoto } from "@/server/google";
import { getLegs } from "@/server/routes";
import { takeGoogleCall, monthCost, usageSince, hobartDay } from "@/server/usage";
import * as H from "@/server/handlers";

/* docs/PLAN-2026-10-26-google.md — Google is always mocked; no network. */

type Call = { url: string; headers?: Record<string, string>; body?: string };
function mock(responder: (url: string) => unknown) {
  const calls: Call[] = [];
  const f = async (url: string, init?: { headers?: Record<string, string>; body?: string }) => {
    calls.push({ url, headers: init?.headers, body: init?.body });
    return { ok: true, status: 200, json: async () => responder(url) };
  };
  return { f, calls };
}

beforeEach(async () => {
  process.env.OWNER_GITHUB_IDS = OWNER_ID;
  await freshDb();
  process.env.GOOGLE_MAPS_API_KEY = "test-key-not-real";
  process.env.GOOGLE_DAILY_CAP = "50";
});
afterEach(() => {
  delete process.env.GOOGLE_MAPS_API_KEY;
  delete process.env.GOOGLE_DAILY_CAP;
  vi.unstubAllGlobals();
});

describe("google routes", () => {
  it("decodes Google polylines", () => {
    expect(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@")).toEqual([
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ]);
  });

  it("stores computed legs in route_cache and never calls Google again for the same legs", async () => {
    const { f, calls } = mock(() => ({ routes: [{ legs: [{ distanceMeters: 5000, duration: "600s", polyline: { encodedPolyline: "_p~iF~ps|U_ulLnnqC" } }] }] }));
    const pts: [number, number][] = [[-42.88, 147.33], [-42.12, 148.05]];
    const first = await getLegs(pts, { compute: true, provider: "google", gfetch: f });
    expect(first.legs[0]).toMatchObject({ distanceM: 5000, durationS: 600, source: "google-routes" });
    expect(calls[0].headers?.["X-Goog-FieldMask"]).toBe("routes.legs.distanceMeters,routes.legs.duration,routes.legs.polyline.encodedPolyline");
    await getLegs(pts, { compute: true, provider: "google", gfetch: f });
    await getLegs(pts, { compute: false, provider: "google", gfetch: f });
    expect(calls).toHaveLength(1);
  });

  it("a page view (guest or owner) of a cached day makes no Google call", async () => {
    const { f } = mock(() => ({ routes: [{ legs: [{ distanceMeters: 5000, duration: "600s" }] }] }));
    const pts: [number, number][] = [[-42.88, 147.33], [-42.12, 148.05]];
    await getLegs(pts, { compute: true, provider: "google", gfetch: f });
    const spy = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", spy);
    for (const who of [signedOut, asOwner]) {
      who();
      const r = await H.postRoutes(req("POST", "/api/routes", { points: pts }));
      expect(r.status).toBe(200);
      expect(((await r.json()) as { legs: { source: string }[] }).legs[0].source).toBe("google-routes");
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("upgrades OSRM legs to Google only when asked", async () => {
    const pts: [number, number][] = [[-42.88, 147.33], [-42.12, 148.05]];
    const osrm = async () => ({ ok: true, json: async () => ({ code: "Ok", routes: [{ legs: [{ distance: 1, duration: 1, steps: [] }] }] }) });
    await getLegs(pts, { compute: true, provider: "osrm", fetch: osrm });
    const { f, calls } = mock(() => ({ routes: [{ legs: [{ distanceMeters: 9, duration: "9s" }] }] }));
    await getLegs(pts, { compute: true, provider: "google", gfetch: f });
    expect(calls).toHaveLength(0);
    const up = await getLegs(pts, { compute: true, provider: "google", upgrade: true, gfetch: f });
    expect(up.legs[0]?.source).toBe("google-routes");
    expect(calls).toHaveLength(1);
  });
});

describe("explicit compute", () => {
  it("an owner page view never computes a missing leg; the 計算道路路線 action does", async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify({ routes: [{ legs: [{ distanceMeters: 7, duration: "7s" }] }] }), { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", spy);
    asOwner();
    const pts = [[-42.88, 147.33], [-42.5, 147.9]];
    const view = await H.postRoutes(req("POST", "/api/routes", { points: pts }));
    expect(((await view.json()) as { legs: unknown[] }).legs[0]).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    const act = await H.postRoutes(req("POST", "/api/routes", { points: pts, compute: true }));
    expect(((await act.json()) as { legs: { source: string }[] }).legs[0].source).toBe("google-routes");
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("google places", () => {
  it("finds a location-checked place id once, then reads it from lookup_cache", async () => {
    const { f, calls } = mock(() => ({ places: [{ id: "ChIJabcdefghijk", location: { latitude: -40.761, longitude: 145.291 }, displayName: { text: "The Nut" } }] }));
    expect(await findPlaceId("g37", "Stanley The Nut", -40.76, 145.29, f)).toBe("ChIJabcdefghijk");
    expect(await findPlaceId("g37", "Stanley The Nut", -40.76, 145.29, f)).toBe("ChIJabcdefghijk");
    expect(calls).toHaveLength(1);
    await findPlaceId("g37", "Stanley Highfield", -40.76, 145.29, f); // renamed: looked up again
    expect(calls).toHaveLength(2);
    await findPlaceId("g37", "Stanley Highfield", -40.9, 145.29, f); // moved: looked up again
    expect(calls).toHaveLength(3);
    expect(calls[0].headers?.["X-Goog-FieldMask"]).toBe("places.id,places.location,places.displayName");
    // A match far from the activity is not used.
    const far = mock(() => ({ places: [{ id: "ChIJfarawayplace", location: { latitude: -42.0, longitude: 147.0 } }] }));
    expect(await findPlaceId("x1", "Somewhere", -40.76, 145.29, far.f)).toBeNull();
  });

  it("resolves a photo live with attributions, using the key only in headers", async () => {
    const { f, calls } = mock((url) =>
      url.includes("/media")
        ? { photoUri: "https://lh3.googleusercontent.com/p/abc" }
        : { photos: [{ name: "places/ChIJabcdefghijk/photos/xyz", googleMapsUri: "https://maps.google.com/?cid=1", authorAttributions: [{ displayName: "A. Person", uri: "//maps.google.com/contrib/1" }] }] },
    );
    const p = await placePhoto("ChIJabcdefghijk", 1200, f);
    expect(p).toEqual({ photoUri: "https://lh3.googleusercontent.com/p/abc", attributions: [{ name: "A. Person", uri: "https://maps.google.com/contrib/1" }], mapsUri: "https://maps.google.com/?cid=1" });
    expect(calls.every((c) => !c.url.includes("test-key-not-real"))).toBe(true);
    expect(JSON.stringify(p)).not.toContain("test-key-not-real");
    expect(calls[0].headers?.["X-Goog-FieldMask"]).toBe("photos");
  });
});

describe("usage guard and report", () => {
  it("refuses calls past the daily cap and logs them per API", async () => {
    process.env.GOOGLE_DAILY_CAP = "2";
    expect(await takeGoogleCall("routes")).toBe(true);
    expect(await takeGoogleCall("place_photo")).toBe(true);
    expect(await takeGoogleCall("routes")).toBe(false);
    // Concurrent reservations at the cap: none slips through.
    expect((await Promise.all([takeGoogleCall("routes"), takeGoogleCall("routes")])).some(Boolean)).toBe(false);
    const d = (await usageSince(hobartDay()))[0];
    expect(d.apis).toMatchObject({ routes: { calls: 1 }, place_photo: { calls: 1 } });
    expect((await monthCost(hobartDay().slice(0, 7))).usd).toBe(0); // within free monthly calls
  });

  it("the daily usage endpoint returns numbers only, without login", async () => {
    signedOut();
    await takeGoogleCall("routes");
    const r = await H.getUsageDaily(req("GET", `/api/usage/daily?date=${hobartDay()}`));
    expect(r.status).toBe(200);
    const body = (await r.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ date: hobartDay(), calls: 1, apis: { routes: { calls: 1, hits: 0 } } });
    expect(JSON.stringify(body)).not.toMatch(/key|test-key|place|name/i);
  });

  it("the owner status reports whether a key is set, never the key", async () => {
    asOwner();
    const r = await H.getGoogleStatus(req("GET", "/api/google/status"));
    const text = await r.text();
    expect(JSON.parse(text).keyPresent).toBe(true);
    expect(text).not.toContain("test-key-not-real");
    signedOut();
    expect((await H.getGoogleStatus(req("GET", "/api/google/status"))).status).toBe(401);
  });
});
