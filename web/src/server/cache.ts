import { and, eq } from "drizzle-orm";
import { getDb, schema } from "./db/client";

/*
 * Key/value lookups that would otherwise be fetched or researched again (PLAN-2026-10-26 §2):
 * live feeds with a TTL, and research notes that Claude sessions read before searching the web.
 */

const { lookupCache } = schema;

export type Lookup<T = unknown> = { value: T; source: string; fetchedAt: Date; expiresAt: Date | null; fresh: boolean };

export async function getLookup<T>(kind: string, key: string, now = new Date()): Promise<Lookup<T> | null> {
  const db = await getDb();
  const r = (await db.select().from(lookupCache).where(and(eq(lookupCache.kind, kind), eq(lookupCache.key, key))).limit(1))[0];
  if (!r) return null;
  return { value: r.value as T, source: r.source, fetchedAt: r.fetchedAt, expiresAt: r.expiresAt, fresh: !r.expiresAt || r.expiresAt > now };
}

export async function putLookup(kind: string, key: string, value: unknown, source: string, ttlMs: number | null, now = new Date()) {
  const db = await getDb();
  const row = { kind, key, value, source, fetchedAt: now, expiresAt: ttlMs == null ? null : new Date(now.getTime() + ttlMs) };
  await db.insert(lookupCache).values(row).onConflictDoUpdate({ target: [lookupCache.kind, lookupCache.key], set: row });
}

export async function listLookups(kind?: string) {
  const db = await getDb();
  const q = db.select().from(lookupCache);
  return kind ? q.where(eq(lookupCache.kind, kind)) : q;
}

/**
 * Returns the cached value while fresh; otherwise fetches, stores and returns it.
 * A failed fetch falls back to the stale value (stale: true) or null.
 */
export async function cached<T>(kind: string, key: string, ttlMs: number, source: string, load: () => Promise<T>): Promise<{ value: T; fetchedAt: Date; stale: boolean } | null> {
  let hit: Lookup<T> | null = null;
  try {
    hit = await getLookup<T>(kind, key);
  } catch {
    /* table missing before the migration runs: behave as a miss */
  }
  if (hit?.fresh) return { value: hit.value, fetchedAt: hit.fetchedAt, stale: false };
  try {
    const value = await load();
    const now = new Date();
    await putLookup(kind, key, value, source, ttlMs, now).catch(() => {});
    return { value, fetchedAt: now, stale: false };
  } catch {
    return hit ? { value: hit.value, fetchedAt: hit.fetchedAt, stale: true } : null;
  }
}
