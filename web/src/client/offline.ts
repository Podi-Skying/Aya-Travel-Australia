import { get, set } from "idb-keyval";

/*
 * Local copy for offline viewing (FR-24, FR-25, PLAN.md 4.8): the last fetched
 * document, its sync time, last-known alert status and, for the owner, the
 * version list with documents for the 20 most recent versions plus version 1.
 */

export const OFFLINE_VERSION_DOCS = 20;

export type VersionMeta = { versionNo: number; summary: string; createdAt: string; restoredFrom: number | null; doc?: unknown };

export type Snapshot<Doc = unknown, Alerts = unknown> = {
  doc: Doc;
  versionNo: number;
  lastSyncAt: string;
  alerts: Alerts;
  versions?: VersionMeta[];
};

export function trimVersions(versions: VersionMeta[], keep = OFFLINE_VERSION_DOCS): VersionMeta[] {
  const recent = new Set([...versions].sort((a, b) => b.versionNo - a.versionNo).slice(0, keep).map((v) => v.versionNo));
  return versions.map((v) => {
    if (recent.has(v.versionNo) || v.versionNo === 1) return v;
    const rest = { ...v };
    delete rest.doc;
    return rest;
  });
}

export const keyFor = (mode: "owner" | "public", token?: string) => (mode === "owner" ? "trip:owner" : `trip:share:${token}`);

export async function saveSnapshot(key: string, s: Snapshot): Promise<void> {
  try {
    await set(key, { ...s, versions: s.versions ? trimVersions(s.versions) : undefined });
  } catch {
    /* storage unavailable (private mode): offline copy is best-effort */
  }
}

export async function loadSnapshot<D, A>(key: string): Promise<Snapshot<D, A> | null> {
  try {
    return ((await get(key)) as Snapshot<D, A> | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function mergeVersions(key: string, versions: VersionMeta[]): Promise<void> {
  const cur = await loadSnapshot(key);
  if (cur) await saveSnapshot(key, { ...cur, versions });
}
