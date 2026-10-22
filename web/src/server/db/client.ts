import path from "node:path";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import * as schema from "./schema";

/*
 * With DATABASE_URL (Neon, pooled), the app uses node-postgres, as Neon recommends
 * for Vercel Fluid compute; attachDatabasePool lets Vercel close idle connections
 * before a function instance is suspended. Interactive transactions (row locks in
 * PLAN.md 4.3) work through the pooler. Without DATABASE_URL, development uses an
 * on-disk PGlite database and tests inject an in-memory one.
 * Both drivers expose the same Drizzle query API; the PGlite type is used for both.
 */

export type AppDb = PgliteDatabase<typeof schema>;

/** Neon strings say sslmode=require; pg treats it as verify-full today and warns. Say so explicitly. */
export function pgConnectionString(url: string): string {
  return url.replace(/([?&])sslmode=(require|prefer|verify-ca)\b/, "$1sslmode=verify-full");
}

let instance: Promise<AppDb> | null = null;

async function create(): Promise<AppDb> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const pool = new Pool({ connectionString: pgConnectionString(url), max: 5, idleTimeoutMillis: 5_000 });
    if (process.env.VERCEL) {
      const { attachDatabasePool } = await import("@vercel/functions");
      attachDatabasePool(pool);
    }
    return drizzle({ client: pool, schema }) as unknown as AppDb;
  }
  if (process.env.VERCEL) throw new Error("DATABASE_URL is required on Vercel");
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const dir = process.env.PGLITE_DIR ?? path.join(process.cwd(), ".pglite");
  const db = drizzle({ client: new PGlite(dir), schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  return db;
}

export function getDb(): Promise<AppDb> {
  instance ??= create();
  return instance;
}

/** Tests only. */
export function setDb(db: AppDb | null) {
  instance = db ? Promise.resolve(db) : null;
}

export { schema };
