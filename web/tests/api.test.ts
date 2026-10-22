import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { count, eq } from "drizzle-orm";
import { asOwner, asStranger, ctx, req, seededDb, signedOut } from "./helpers";
import * as H from "@/server/handlers";
import * as schema from "@/server/db/schema";
import type { AppDb } from "@/server/db/client";

/* Integration tests on route handlers with an in-memory PGlite database (AC4–AC9). */

let db: AppDb;
beforeEach(async () => {
  ({ db } = await seededDb());
  asOwner();
  process.env.RATE_LIMIT_PER_VOTER = "30";
  process.env.RATE_LIMIT_PER_LINK = "300";
});

const body = async (r: Response) => r.json() as Promise<Record<string, unknown>>;
const current = async () => (await body(await H.getTrip(req("GET", "/api/trip")))) as { versionNo: number; doc: { days: { date: string; items: { id: string; pri: string }[] }[] } };
const op = (base: number, o: Record<string, unknown>) => H.postOp(req("POST", "/api/trip/ops", { baseVersionNo: base, op: o }));
async function countRows(table: typeof schema.trips | typeof schema.tripVersions | typeof schema.shareLinks | typeof schema.interestVotes | typeof schema.rateLimits) {
  return Number((await db.select({ n: count() }).from(table))[0].n);
}

describe("versioning (AC4)", () => {
  it("save creates n+1, restore creates a new version, v1 stays, stale base is 409", async () => {
    const c = await current();
    expect(c.versionNo).toBe(1);
    const r1 = await op(1, { op: "setPartySize", partySize: 3 });
    expect(r1.status).toBe(200);
    expect((await body(r1)).versionNo).toBe(2);
    const r2 = await H.postRestore(req("POST", "/api/trip/restore", { baseVersionNo: 2, versionNo: 1 }));
    expect((await body(r2)).versionNo).toBe(3);
    const versions = (await body(await H.getVersions(req("GET", "/api/trip/versions")))).versions as { versionNo: number; restoredFrom: number | null }[];
    expect(versions.map((v) => v.versionNo)).toEqual([3, 2, 1]);
    expect(versions[0].restoredFrom).toBe(1);
    const v3 = await current();
    const v1doc = (await db.select().from(schema.tripVersions).where(eq(schema.tripVersions.versionNo, 1)))[0].doc;
    expect(v3.doc).toEqual(v1doc);
    const stale = await op(2, { op: "setPartySize", partySize: 4 });
    expect(stale.status).toBe(409);
    expect(await countRows(schema.tripVersions)).toBe(3);
  });

  it("two concurrent writes with the same base: one success, one 409, one new version", async () => {
    const [a, b] = await Promise.all([op(1, { op: "setPartySize", partySize: 3 }), op(1, { op: "setPartySize", partySize: 4 })]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await countRows(schema.tripVersions)).toBe(2);
  });

  it("invalid documents are rejected with 400 and create no version (AC8)", async () => {
    const r = await H.postImport(req("POST", "/api/trip/import", { baseVersionNo: 1, doc: { meta: {} } }));
    expect(r.status).toBe(400);
    const c = await current();
    const dup = structuredClone(c.doc);
    dup.days[0].items.push({ ...dup.days[0].items[0] });
    expect((await H.postImport(req("POST", "/api/trip/import", { baseVersionNo: 1, doc: dup }))).status).toBe(400);
    expect(await countRows(schema.tripVersions)).toBe(1);
    const ok = await H.postImport(req("POST", "/api/trip/import", { baseVersionNo: 1, doc: c.doc }));
    expect(ok.status).toBe(200);
  });

  it("pool scheduling errors are 400 through the API", async () => {
    expect((await op(1, { op: "schedulePackage", key: "kunanyi", date: "2026-11-04" })).status).toBe(400);
    expect((await op(1, { op: "schedulePackage", key: "kunanyi", date: "2026-11-23" })).status).toBe(200);
  });
});

describe("auth (AC5)", () => {
  const ownerCalls: [string, () => Promise<Response>][] = [
    ["GET trip", () => H.getTrip(req("GET", "/api/trip"))],
    ["DELETE trip", () => H.deleteTripHandler(req("DELETE", "/api/trip", { confirmTitle: "x" }))],
    ["POST ops", () => op(1, { op: "setPartySize", partySize: 3 })],
    ["POST restore", () => H.postRestore(req("POST", "/api/trip/restore", { baseVersionNo: 1, versionNo: 1 }))],
    ["POST import", () => H.postImport(req("POST", "/api/trip/import", { baseVersionNo: 1, doc: {} }))],
    ["GET versions", () => H.getVersions(req("GET", "/api/trip/versions"))],
    ["GET export", () => H.getExport(req("GET", "/api/trip/export"))],
    ["GET share", () => H.getShare(req("GET", "/api/trip/share"))],
    ["POST share", () => H.postShare(req("POST", "/api/trip/share"))],
    ["DELETE share", () => H.deleteShare(req("DELETE", "/api/trip/share"))],
    ["GET interest", () => H.getInterest(req("GET", "/api/trip/interest"))],
  ];
  for (const [name, call] of ownerCalls) {
    it(`${name}: 401 signed out, 403 for a non-owner`, async () => {
      signedOut();
      expect((await call()).status).toBe(401);
      asStranger();
      expect((await call()).status).toBe(403);
    });
  }

  it("mutations from a foreign Origin are 403", async () => {
    const r = await H.postOp(req("POST", "/api/trip/ops", { baseVersionNo: 1, op: { op: "setPartySize", partySize: 3 } }, { origin: "https://evil.example" }));
    expect(r.status).toBe(403);
    const r2 = await H.postShare(new Request("http://localhost:3000/api/trip/share", { method: "POST", headers: { host: "localhost:3000" } }));
    expect(r2.status).toBe(403);
  });

  it("the next-auth signIn callback only admits the owner's GitHub id", async () => {
    const { authOptions } = await import("@/server/auth");
    const signIn = authOptions.callbacks!.signIn!;
    const call = (id: number) => signIn({ account: { provider: "github" }, profile: { id } } as never);
    expect(await call(32431832)).toBe(true);
    expect(await call(1)).toBe(false);
  });
});

async function newShare() {
  const r = await H.postShare(req("POST", "/api/trip/share"));
  return (await body(r)).token as string;
}

describe("sharing (AC6)", () => {
  it("public doc hides private data after scheduling and confirming; deactivated and unknown tokens are 404", async () => {
    const c = await current();
    const doc = structuredClone(c.doc) as unknown as { stays: Record<string, { address: string }> };
    doc.stays.utas.address = "77 Private Lane, Sandy Bay";
    await H.postImport(req("POST", "/api/trip/import", { baseVersionNo: 1, doc }));
    await op(2, { op: "scheduleItem", key: "mtfield", itemId: "a11", date: "2026-11-12" });
    await op(3, { op: "schedulePackage", key: "kunanyi", date: "2026-11-23" });
    await op(4, { op: "confirmDriver", date: "2026-11-23", window: "07:45–19:15" });
    const token = await newShare();
    const r = await H.getPublic(req("GET", `/api/s/${token}`), ctx(token));
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).not.toMatch(/Zayden|JJ|77 Private Lane|"address"|"driverConfirmation"|07:45/);
    await H.deleteShare(req("DELETE", "/api/trip/share"));
    const gone = await H.getPublic(req("GET", `/api/s/${token}`), ctx(token));
    expect(gone.status).toBe(404);
    expect(Object.keys(await body(gone))).toEqual(["error"]);
    expect((await H.getPublic(req("GET", "/api/s/nope"), ctx("nope"))).status).toBe(404);
  });

  it("a new link deactivates the old one; concurrent creates leave one active link", async () => {
    const t1 = await newShare();
    const t2 = await newShare();
    expect((await H.getPublic(req("GET", "/"), ctx(t1))).status).toBe(404);
    expect((await H.getPublic(req("GET", "/"), ctx(t2))).status).toBe(200);
    await Promise.all([newShare(), newShare(), newShare()]);
    const active = await db.select().from(schema.shareLinks).where(eq(schema.shareLinks.active, true));
    expect(active).toHaveLength(1);
  });
});

describe("interest (AC7)", () => {
  const vote = (t: string, b: Record<string, unknown>) => H.postVote(req("POST", `/api/s/${t}/interest`, b), ctx(t));
  const unvote = (t: string, b: Record<string, unknown>) => H.deleteVote(req("DELETE", `/api/s/${t}/interest`, b), ctx(t));
  const counts = async () => (await body(await H.getInterest(req("GET", "/api/trip/interest")))) as { current: { itemId: string; dayDate: string; count: number }[]; moved: { itemId: string; count: number }[] };

  it("counts, withdraws, moves and validates", async () => {
    const t = await newShare();
    const A = randomUUID();
    const B = randomUUID();
    const item = { itemId: "a35", dayDate: "2026-11-07" };
    expect((await vote(t, { voterKey: A, ...item, nickname: "小A" })).status).toBe(200);
    expect((await vote(t, { voterKey: B, ...item })).status).toBe(200);
    let c = await counts();
    expect(c.current.find((x) => x.itemId === "a35")!.count).toBe(2);
    expect(JSON.stringify(c)).not.toMatch(/小A|voter/i);
    expect((await vote(t, { voterKey: A, ...item, nickname: "A2" })).status).toBe(200);
    c = await counts();
    expect(c.current.find((x) => x.itemId === "a35")!.count).toBe(2);
    expect((await unvote(t, { voterKey: B, ...item })).status).toBe(200);
    c = await counts();
    expect(c.current.find((x) => x.itemId === "a35")!.count).toBe(1);

    // Owner moves a35 to 11/14 by unscheduling is not possible (not from pool); use import with a date move.
    const cur = await current();
    const doc = structuredClone(cur.doc);
    const from = doc.days.find((d) => d.date === "2026-11-07")!;
    const it = from.items.find((i) => i.id === "a35")!;
    from.items = from.items.filter((i) => i !== it);
    doc.days.find((d) => d.date === "2026-11-14")!.items.push(it);
    expect((await H.postImport(req("POST", "/api/trip/import", { baseVersionNo: cur.versionNo, doc }))).status).toBe(200);
    expect((await vote(t, { voterKey: A, itemId: "a35", dayDate: "2026-11-14" })).status).toBe(200);
    c = await counts();
    expect(c.current.find((x) => x.itemId === "a35")!.count).toBe(1);
    expect(c.moved.find((x) => x.itemId === "a35")!.count).toBe(1);
    expect((await unvote(t, { voterKey: A, ...item })).status).toBe(200);

    expect((await vote(t, { voterKey: A, itemId: "a04", dayDate: "2026-11-23" })).status).toBe(400); // pool item
    expect((await vote(t, { voterKey: A, itemId: "zz", dayDate: "2026-11-07" })).status).toBe(400);
    expect((await vote(t, { voterKey: A, itemId: "a36", dayDate: "2026-11-07" })).status).toBe(400); // wrong date
    expect((await vote(t, { voterKey: A, itemId: "a35", dayDate: "2026-11-14", nickname: "一二三四五六七八九十一二三四五六七八九十一" })).status).toBe(400);
    expect((await vote(t, { voterKey: "not-a-uuid", itemId: "a35", dayDate: "2026-11-14" })).status).toBe(400);
    expect((await unvote(t, { voterKey: B, itemId: "a35", dayDate: "2026-11-14" })).status).toBe(404);
  });

  it("per-voter limit under a concurrent burst", async () => {
    process.env.RATE_LIMIT_PER_VOTER = "30";
    const t = await newShare();
    const A = randomUUID();
    const rs = await Promise.all(Array.from({ length: 40 }, () => vote(t, { voterKey: A, itemId: "a35", dayDate: "2026-11-07" })));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(30);
    expect(rs.filter((r) => r.status === 429)).toHaveLength(10);
  });

  it("per-link limit under a concurrent burst", async () => {
    process.env.RATE_LIMIT_PER_LINK = "5";
    const t = await newShare();
    const rs = await Promise.all(Array.from({ length: 9 }, () => vote(t, { voterKey: randomUUID(), itemId: "a35", dayDate: "2026-11-07" })));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(5);
    expect(rs.filter((r) => r.status === 429)).toHaveLength(4);
  });
});

describe("request size (inspection R-05)", () => {
  it("stops reading an oversized body without Content-Length", async () => {
    const t = await newShare();
    let pulled = 0;
    const big = new ReadableStream<Uint8Array>({
      pull(ctrl) {
        pulled++;
        if (pulled > 1000) return ctrl.close();
        ctrl.enqueue(new Uint8Array(1024).fill(32));
      },
    });
    const r = new Request("http://localhost:3000/api/s/x/interest", { method: "POST", body: big, duplex: "half" } as RequestInit);
    const res = await H.postVote(r, ctx(t));
    expect(res.status).toBe(413);
    expect(pulled).toBeLessThan(10);
  });
});

describe("delete (AC9)", () => {
  it("removes the trip and all associated rows; the public link is 404", async () => {
    const t = await newShare();
    await H.postVote(req("POST", `/api/s/${t}/interest`, { voterKey: randomUUID(), itemId: "a35", dayDate: "2026-11-07" }), ctx(t));
    expect(await countRows(schema.rateLimits)).toBeGreaterThan(0);
    expect((await H.deleteTripHandler(req("DELETE", "/api/trip", { confirmTitle: "錯的名字" }))).status).toBe(400);
    const c = await current();
    expect((await H.deleteTripHandler(req("DELETE", "/api/trip", { confirmTitle: (c.doc as unknown as { meta: { title: string } }).meta.title }))).status).toBe(200);
    for (const tb of [schema.trips, schema.tripVersions, schema.shareLinks, schema.interestVotes, schema.rateLimits]) expect(await countRows(tb)).toBe(0);
    expect((await H.getPublic(req("GET", "/"), ctx(t))).status).toBe(404);
  });
});
