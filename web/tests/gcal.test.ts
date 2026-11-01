import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { calendarEvents } from "@/domain/gcal-events";
import { calendarConfig, needsCatchUp, syncCalendar } from "@/server/gcal";
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

describe("catching up from page views", () => {
  const at = Date.parse("2026-11-02T00:00:00Z");
  const rec = (o: object) => ({ at: new Date(at - 60_000).toISOString(), events: 1, created: 0, updated: 0, deleted: 0, versionNo: 7, ...o });
  it("runs when the calendar is behind or was never synced", () => {
    expect(needsCatchUp(null, 7, at)).toBe(true);
    expect(needsCatchUp(rec({ versionNo: 6 }), 7, at)).toBe(true);
  });
  it("does nothing when up to date", () => {
    expect(needsCatchUp(rec({}), 7, at)).toBe(false);
  });
  it("backs off after a failure, then tries again", () => {
    expect(needsCatchUp(rec({ error: "Google 日曆錯誤（403）" }), 7, at)).toBe(false);
    expect(needsCatchUp(rec({ error: "x" }), 8, at)).toBe(false);
    expect(needsCatchUp(rec({ error: "x" }), 7, at + 31 * 60_000)).toBe(true);
  });
  it("stops at once without settings", async () => {
    const { catchUpCalendar } = await import("@/server/gcal");
    delete process.env.GOOGLE_CALENDAR_ID;
    await expect(catchUpCalendar()).resolves.toBeUndefined();
  });
});

describe("calendar events in English", () => {
  it("no title, description or location holds Chinese or Japanese", () => {
    const d = doc();
    d.days[0].items[0] = { ...d.days[0].items[0], name: "雪梨月神公園", en: undefined, note: "中文", ownerNote: "只有中文", tr: { en: { name: "Luna Park", note: "English note" }, ja: { name: "ルナパーク" } } } as never;
    d.days[0].items[1] = { ...d.days[0].items[1], name: "沒有翻譯", en: undefined, note: "沒有翻譯", tr: undefined } as never;
    const ev = calendarEvents(d, "https://x.test");
    const first = ev.find((e) => e.key === "one")!.body as { summary: string; description: string };
    expect(first.summary).toBe("Luna Park");
    expect(first.description).toContain("English note");
    expect(ev.find((e) => e.key === "two")!.body.summary).toBe("Activity");
    for (const e of ev) {
      const { summary, description, location } = e.body as Record<string, string>;
      expect(`${summary} ${description ?? ""} ${location ?? ""}`, e.key).not.toMatch(/[\u3040-\u30ff\u3400-\u9fff]/);
    }
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

  it("records the synced version, and 已同步 lasts until the trip moves on", async () => {
    const { getLookup } = await import("@/server/cache");
    const { calendarStatus } = await import("@/server/gcal");
    vi.mocked(getLookup).mockResolvedValue({ value: { at: "x", events: 1, created: 1, updated: 0, deleted: 0, versionNo: 7 } } as never);
    expect((await calendarStatus(7)).synced).toBe(true);
    expect((await calendarStatus(8)).synced).toBe(false);
    vi.mocked(getLookup).mockResolvedValue({ value: { at: "x", events: 1, created: 0, updated: 0, deleted: 0, versionNo: 7, error: "Google 日曆錯誤（403）" } } as never);
    expect((await calendarStatus(7)).synced).toBe(false);
    vi.mocked(getLookup).mockResolvedValue(null as never);
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
