import { randomUUID } from "node:crypto";
import { errorResponse, fail, HttpError, json, ownerRoute, readJson } from "./http";
import { missingConfig } from "./config";
import { getPublicHomeTrip, publicHomeEnabled } from "./public-home";
import { applyOwnerOp, deleteTrip, getCurrentTrip, importDoc, listVersions, restoreVersion } from "./trips";
import { createShareLink, deactivateShareLinks, getPublicTrip, interestCounts, myVotes, shareStatus, submitVote, withdrawVote } from "./sharing";
import { alertStatus } from "@/domain/rules";
import { todayStr } from "@/domain/format";
import type { Op } from "@/domain/ops";

/* Route handler bodies, kept outside app/ so integration tests can call them directly. */

const MAX_DOC_BYTES = 1_000_000;
const OFFLINE_VERSION_DOCS = 20;

function num(v: unknown, name: string): number {
  if (typeof v !== "number" || !Number.isInteger(v)) throw new HttpError(400, `缺少或錯誤的 ${name}`);
  return v;
}

export const getTrip = ownerRoute(async (_req, owner) => {
  const cur = await getCurrentTrip(owner);
  if (!cur) return fail(404, "找不到行程");
  return json({ ...cur, alerts: alertStatus(cur.doc, { showWindow: true }), syncedAt: new Date().toISOString() });
});

const OPS = new Set<Op["op"]>([
  "setPriority", "toggleVerify", "confirmDriver", "clearDriver", "setPartySize", "setParticipants",
  "editItem", "addItem", "removeItem", "schedulePackage", "scheduleItem", "unscheduleItem", "moveItem", "setStatus", "snapshot",
]);

export const postOp = ownerRoute(async (req, owner) => {
  const b = (await readJson(req, 20_000)) as { baseVersionNo?: unknown; op?: Record<string, unknown> };
  const base = num(b.baseVersionNo, "baseVersionNo");
  const op = b.op;
  if (!op || typeof op.op !== "string" || !OPS.has(op.op as Op["op"])) return fail(400, "未知的操作");
  // Server-assigned values: the date for "verified" and ids for new items.
  const full = { ...op, ...(op.op === "toggleVerify" ? { today: todayStr() } : {}), ...(op.op === "addItem" ? { newId: "u" + randomUUID().slice(0, 12) } : {}) } as Op;
  const r = await applyOwnerOp(owner, base, full);
  return json(r);
});

export const postRestore = ownerRoute(async (req, owner) => {
  const b = (await readJson(req, 2_000)) as Record<string, unknown>;
  return json(await restoreVersion(owner, num(b.baseVersionNo, "baseVersionNo"), num(b.versionNo, "versionNo")));
});

export const postImport = ownerRoute(async (req, owner) => {
  const b = (await readJson(req, MAX_DOC_BYTES)) as Record<string, unknown>;
  return json(await importDoc(owner, num(b.baseVersionNo, "baseVersionNo"), b.doc));
});

export const getVersions = ownerRoute(async (req, owner) => {
  const withDocs = new URL(req.url).searchParams.get("docs") === "1";
  return json({ versions: await listVersions(owner, { withDocsRecent: withDocs ? OFFLINE_VERSION_DOCS : 0 }) });
});

export const getExport = ownerRoute(async (_req, owner) => {
  const cur = await getCurrentTrip(owner);
  if (!cur) return fail(404, "找不到行程");
  return json(cur.doc, 200, { "content-disposition": `attachment; filename="aya-trip-v${cur.versionNo}.json"` });
});

export const deleteTripHandler = ownerRoute(async (req, owner) => {
  const b = (await readJson(req, 2_000)) as Record<string, unknown>;
  await deleteTrip(owner, typeof b.confirmTitle === "string" ? b.confirmTitle : "");
  return json({ deleted: true });
});

export const getShare = ownerRoute(async (_req, owner) => json(await shareStatus(owner)));
export const postShare = ownerRoute(async (_req, owner) => json(await createShareLink(owner)));
export const deleteShare = ownerRoute(async (_req, owner) => {
  await deactivateShareLinks(owner);
  return json({ active: false });
});

export const getInterest = ownerRoute(async (_req, owner) => {
  const cur = await getCurrentTrip(owner);
  if (!cur) return fail(404, "找不到行程");
  return json(await interestCounts(owner, cur.doc));
});

/* ---------- public ---------- */

type Ctx = { params: Promise<{ token: string }> };

function publicConfigError(): Response | null {
  const missing = missingConfig("public");
  return missing.length ? fail(503, "伺服器設定未完成", { missing }) : null;
}

export async function getPublic(_req: Request, ctx: Ctx) {
  const cfg = publicConfigError();
  if (cfg) return cfg;
  try {
    const { token } = await ctx.params;
    const t = await getPublicTrip(token);
    if (!t) return fail(404, "分享連結無效或已停用");
    return json({ ...t, alerts: alertStatus(t.doc as never, { showWindow: false }), syncedAt: new Date().toISOString() });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Public home data (PUBLIC_HOME=1 only): same redacted document as share links. */
export async function getPublicHome() {
  if (!publicHomeEnabled()) return fail(404, "公開瀏覽未開啟");
  const cfg = publicConfigError();
  if (cfg) return cfg;
  try {
    const t = await getPublicHomeTrip();
    if (!t) return fail(404, "找不到行程");
    return json({ ...t, alerts: alertStatus(t.doc as never, { showWindow: false }), syncedAt: new Date().toISOString() });
  } catch (e) {
    return errorResponse(e);
  }
}

const VOTE_BYTES = 2_000;

export async function postVote(req: Request, ctx: Ctx) {
  const cfg = publicConfigError();
  if (cfg) return cfg;
  try {
    const { token } = await ctx.params;
    return json(await submitVote(token, await readJson(req, VOTE_BYTES)));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function deleteVote(req: Request, ctx: Ctx) {
  const cfg = publicConfigError();
  if (cfg) return cfg;
  try {
    const { token } = await ctx.params;
    return json(await withdrawVote(token, await readJson(req, VOTE_BYTES)));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function postMyVotes(req: Request, ctx: Ctx) {
  const cfg = publicConfigError();
  if (cfg) return cfg;
  try {
    const { token } = await ctx.params;
    return json({ votes: await myVotes(token, await readJson(req, VOTE_BYTES)) });
  } catch (e) {
    return errorResponse(e);
  }
}
