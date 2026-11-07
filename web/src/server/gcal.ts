import { createHash, createSign } from "node:crypto";
import type { TripDoc } from "@/domain/schema";
import { calendarEvents } from "@/domain/gcal-events";
import { getLookup, putLookup } from "./cache";

/*
 * One-way push to a dedicated Google Calendar (Kai 2026-11-01). Off unless GOOGLE_CALENDAR_ID and
 * GOOGLE_CALENDAR_SA_JSON are set. Only events this site created (marked with `ayaId`) are ever changed.
 * Credentials and tokens are never logged, returned or stored; errors keep only a status code.
 */

type Fetch = typeof fetch;
type Config = { calendarId: string; email: string; key: string };
type Remote = { id: string; extendedProperties?: { private?: { ayaId?: string; ayaHash?: string } } };
export type SyncResult = { at: string; events: number; created: number; updated: number; deleted: number; versionNo?: number; error?: string };

const API = "https://www.googleapis.com/calendar/v3";
const FAILURE_BACKOFF_MS = 30 * 60 * 1000;
const b64u = (s: string | Buffer) => Buffer.from(s).toString("base64url");

export function calendarConfig(): Config | null {
  const calendarId = process.env.GOOGLE_CALENDAR_ID?.trim();
  const raw = process.env.GOOGLE_CALENDAR_SA_JSON?.trim();
  if (!calendarId || !raw) return null;
  try {
    const json = JSON.parse(raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8")) as { client_email?: string; private_key?: string };
    return json.client_email && json.private_key ? { calendarId, email: json.client_email, key: json.private_key } : null;
  } catch {
    return null;
  }
}

async function accessToken(cfg: Config, f: Fetch): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64u(JSON.stringify({ iss: cfg.email, scope: "https://www.googleapis.com/auth/calendar.events", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const sig = createSign("RSA-SHA256").update(`${head}.${claims}`).sign(cfg.key).toString("base64url");
  const r = await f("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claims}.${sig}` }) });
  if (!r.ok) throw new Error(`Google 登入失敗（${r.status}）`);
  return ((await r.json()) as { access_token: string }).access_token;
}

export async function syncCalendar(doc: TripDoc, opts: { fetch?: Fetch; siteUrl?: string; versionNo?: number } = {}): Promise<SyncResult | null> {
  const cfg = calendarConfig();
  if (!cfg) return null;
  const f = opts.fetch ?? fetch;
  const res: SyncResult = { at: new Date().toISOString(), events: 0, created: 0, updated: 0, deleted: 0, versionNo: opts.versionNo };
  try {
    const token = await accessToken(cfg, f);
    const base = `${API}/calendars/${encodeURIComponent(cfg.calendarId)}/events`;
    const call = async (url: string, init: RequestInit = {}) => {
      for (let attempt = 0; ; attempt++) {
        const r = await f(url, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" } });
        if ((r.status === 429 || r.status === 403) && attempt < 3) {
          await new Promise((ok) => setTimeout(ok, 500 * 2 ** attempt));
          continue;
        }
        if (!r.ok) throw new Error(`Google 日曆錯誤（${r.status}）`);
        return r;
      }
    };
    const ours = new Map<string, Remote>();
    let page = "";
    do {
      const r = await call(`${base}?maxResults=2500&showDeleted=false&singleEvents=false&fields=${encodeURIComponent("items(id,extendedProperties),nextPageToken")}${page ? `&pageToken=${encodeURIComponent(page)}` : ""}`);
      const data = (await r.json()) as { items?: Remote[]; nextPageToken?: string };
      for (const e of data.items ?? []) {
        const id = e.extendedProperties?.private?.ayaId;
        if (id) ours.set(id, e);
      }
      page = data.nextPageToken ?? "";
    } while (page);
    // Google opening hours stay out of the calendar: copied there they would outlive Google's 30-day limit.
    const wanted = calendarEvents(doc, opts.siteUrl);
    res.events = wanted.length;
    for (const { key, body } of wanted) {
      const hash = createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 32);
      const remote = ours.get(key);
      ours.delete(key);
      if (remote?.extendedProperties?.private?.ayaHash === hash) continue;
      const payload = JSON.stringify({ ...body, extendedProperties: { private: { ayaId: key, ayaHash: hash } } });
      if (remote) {
        await call(`${base}/${encodeURIComponent(remote.id)}`, { method: "PUT", body: payload });
        res.updated++;
      } else {
        await call(base, { method: "POST", body: payload });
        res.created++;
      }
    }
    for (const stale of ours.values()) {
      await call(`${base}/${encodeURIComponent(stale.id)}`, { method: "DELETE" });
      res.deleted++;
    }
  } catch (e) {
    res.error = e instanceof Error && /^Google /.test(e.message) ? e.message : "同步失敗";
  }
  await putLookup("gcal", "status", res, "calendar sync", null).catch(() => undefined);
  return res;
}

/** 已同步 only when the last sync worked and reached this version of the trip. */
export async function calendarStatus(versionNo?: number): Promise<{ enabled: boolean; synced: boolean; last: SyncResult | null }> {
  if (!calendarConfig()) return { enabled: false, synced: false, last: null };
  const r = await getLookup<SyncResult>("gcal", "status").catch(() => null);
  const last = r?.value ?? null;
  return { enabled: true, synced: !!last && !last.error && last.versionNo === versionNo, last };
}

/** After a successful trip write: push in the background, without slowing the save. Off without settings. */
export async function scheduleCalendarSync(doc: TripDoc, versionNo: number): Promise<void> {
  if (!calendarConfig()) return;
  try {
    const { after } = await import("next/server");
    after(() => syncCalendar(doc, { siteUrl: process.env.NEXTAUTH_URL, versionNo }).then(() => undefined));
  } catch {
    /* outside a request (scripts): the owner's 同步 button covers it */
  }
}

/** Whether a page view should start a catch-up: the calendar is behind, and the last try did not just fail. */
export function needsCatchUp(last: SyncResult | null, versionNo: number, now = Date.now()): boolean {
  if (last && !last.error && last.versionNo === versionNo) return false;
  if (last?.error && now - Date.parse(last.at) < FAILURE_BACKOFF_MS) return false;
  return true;
}

/**
 * Called on page views, by anyone: trip writes made outside a request reach the calendar on their own. Never
 * blocks the page or shows the viewer anything. The atomic counter lets one sync start per 10-minute window.
 */
export async function catchUpCalendar(): Promise<void> {
  if (!calendarConfig()) return;
  try {
    const [{ after }, { getCurrentTrip }, { ownerIds }, { routeQuota }] = await Promise.all([import("next/server"), import("./trips"), import("./auth"), import("./sharing")]);
    const id = ownerIds()[0];
    if (!id) return;
    after(async () => {
      const cur = await getCurrentTrip({ githubId: id } as never);
      if (!cur) return;
      const last = (await getLookup<SyncResult>("gcal", "status"))?.value ?? null;
      if (!needsCatchUp(last, cur.versionNo)) return;
      if (!(await routeQuota("gcal-catch-up", 1, false))) return;
      await syncCalendar(cur.doc as TripDoc, { siteUrl: process.env.NEXTAUTH_URL, versionNo: cur.versionNo });
    });
  } catch {
    /* a page view must never fail because of the calendar */
  }
}

