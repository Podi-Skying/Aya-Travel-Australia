import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { calendarEvents } from "@/domain/gcal-events";
import { calendarConfig, syncCalendar } from "@/server/gcal";
import { seedDoc } from "./helpers";

vi.mock("@/server/cache", () => ({ putLookup: vi.fn(async () => undefined), getLookup: vi.fn(async () => null) }));

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const SECRET = "sa@test.iam";

/** A small fake of the Calendar API that also records every response body and log line for leak checks. */
function fakeGoogle(seed: { id: string; extendedProperties?: unknown; summary?: string }[] = []) {
  const events = new Map(seed.map((e) => [e.id, e as Record<string, unknown>]));
  let n = 0;
  const f = (async (url: string, init?: RequestInit) => {
    if (url.includes("oauth2")) return Response.json({ access_token: "tok" });
    const id = /events\/([^?]+)/.exec(url)?.[1];
    const m = init?.method ?? "GET";
    if (m === "GET") return Response.json({ items: [...events.values()] });
    if (m === "POST") {
      const eid = `e${++n}`;
      events.set(eid, { id: eid, ...JSON.parse(String(init!.body)) });
      return Response.json({ id: eid });
    }
    if (m === "PUT") {
      events.set(decodeURIComponent(id!), { id, ...JSON.parse(String(init!.body)) });
      return Response.json({});
    }
    if (m === "DELETE") {
      events.delete(decodeURIComponent(id!));
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 400 });
  }) as typeof fetch;
  return { f, events };
}

const doc = () => {
  const d = seedDoc();
  d.days[0].items = [{ ...d.days[0].items[0], id: "one", name: "A", time: "10:00", dur: 60, note: "n" }, { ...d.days[0].items[0], id: "two", name: "B", time: "12:00", dur: 0 }];
  return d;
};

describe("calendar events", () => {
  it("uses the duration, else the next stop, else an hour, and each day's zone", () => {
    const d = doc();
    d.days[0].seg = "syd";
    d.days[0].items.push({ ...d.days[0].items[0], id: "three", time: "14:30", dur: 0 });
    const ev = calendarEvents(d);
    const by = (k: string) => ev.find((e) => e.key === k)!.body as { start: { dateTime: string; timeZone: string }; end: { dateTime: string } };
    expect(by("one").end.dateTime.slice(11, 16)).toBe("11:00");
    expect(by("one").start.timeZone).toBe("Australia/Sydney");
    expect(by("two").end.dateTime.slice(11, 16)).toBe("14:30");
    expect(by("three").end.dateTime.slice(11, 16)).toBe("15:30");
    expect(ev.some((e) => e.key.startsWith("stay:"))).toBe(true);
  });
});

describe("syncCalendar", () => {
  beforeEach(() => {
    process.env.GOOGLE_CALENDAR_ID = "cal@test";
    process.env.GOOGLE_CALENDAR_SA_JSON = JSON.stringify({ client_email: SECRET, private_key: privateKey });
  });
  afterEach(() => {
    delete process.env.GOOGLE_CALENDAR_ID;
    delete process.env.GOOGLE_CALENDAR_SA_JSON;
  });

  it("is off without settings", async () => {
    delete process.env.GOOGLE_CALENDAR_ID;
    expect(calendarConfig()).toBeNull();
    const f = vi.fn();
    expect(await syncCalendar(doc(), { fetch: f as never })).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("reads base64 settings", () => {
    process.env.GOOGLE_CALENDAR_SA_JSON = Buffer.from(JSON.stringify({ client_email: SECRET, private_key: privateKey })).toString("base64");
    expect(calendarConfig()?.email).toBe(SECRET);
  });

  it("creates once, skips unchanged, updates a moved stop, deletes a removed one, never duplicates", async () => {
    const g = fakeGoogle();
    const d = doc();
    const first = (await syncCalendar(d, { fetch: g.f }))!;
    expect(first.error).toBeUndefined();
    expect(first.created).toBe(first.events);
    const size = g.events.size;
    const again = (await syncCalendar(d, { fetch: g.f }))!;
    expect([again.created, again.updated, again.deleted]).toEqual([0, 0, 0]);
    expect(g.events.size).toBe(size);
    d.days[0].items[0].time = "09:00";
    expect((await syncCalendar(d, { fetch: g.f }))!.updated).toBe(1);
    d.days[0].items = d.days[0].items.slice(1);
    const gone = (await syncCalendar(d, { fetch: g.f }))!;
    expect(gone.deleted).toBe(1);
    expect(g.events.size).toBe(size - 1);
  });

  it("leaves events it did not create alone", async () => {
    const g = fakeGoogle([{ id: "mine", summary: "Kai's own" }]);
    const r = (await syncCalendar(doc(), { fetch: g.f }))!;
    expect(r.deleted).toBe(0);
    expect(g.events.has("mine")).toBe(true);
  });

  it("keeps credentials out of the result and logs when Google fails", async () => {
    const log = vi.spyOn(console, "log");
    const err = vi.spyOn(console, "error");
    const f = (async () => new Response(`bad ${privateKey}`, { status: 401 })) as typeof fetch;
    const r = (await syncCalendar(doc(), { fetch: f }))!;
    expect(r.error).toBe("Google 登入失敗（401）");
    const seen = JSON.stringify([r, log.mock.calls, err.mock.calls]);
    expect(seen).not.toContain("PRIVATE KEY");
    expect(seen).not.toContain(SECRET);
  });
});
