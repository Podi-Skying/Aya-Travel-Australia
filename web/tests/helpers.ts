import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { vi } from "vitest";
import * as schema from "@/server/db/schema";
import { setDb, type AppDb } from "@/server/db/client";
import { createTrip } from "@/server/trips";
import { buildSeed, SEED_SUMMARY } from "../scripts/seed-2026-11";
import { loadLegacyData } from "../scripts/legacy";

export const OWNER_ID = "32431832";
export const ORIGIN = "http://localhost:3000";

export const session = { githubId: null as string | null };

vi.mock("@/server/session", () => ({ getSessionGithubId: async () => session.githubId }));

export async function freshDb(): Promise<AppDb> {
  const db = drizzle({ client: new PGlite(), schema });
  await migrate(db, { migrationsFolder: path.join(__dirname, "..", "drizzle") });
  setDb(db);
  return db;
}

export function seedDoc() {
  return buildSeed(loadLegacyData());
}

export async function seededDb() {
  process.env.OWNER_GITHUB_IDS = OWNER_ID;
  const db = await freshDb();
  const tripId = await createTrip(db, OWNER_ID, seedDoc(), SEED_SUMMARY);
  return { db, tripId };
}

export function asOwner() {
  session.githubId = OWNER_ID;
}
export function asStranger() {
  session.githubId = "999";
}
export function signedOut() {
  session.githubId = null;
}

export function req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}${url}`, {
    method,
    headers: { host: "localhost:3000", origin: ORIGIN, "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export const ctx = (token: string) => ({ params: Promise.resolve({ token }) });
