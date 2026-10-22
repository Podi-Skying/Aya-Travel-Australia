import path from "node:path";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import * as schema from "./schema";

/*
 * Production uses Neon over WebSockets (interactive transactions are needed for
 * the row locks in PLAN.md 4.3). Without DATABASE_URL, development uses an
 * on-disk PGlite database and tests inject an in-memory one.
 * Both drivers expose the same Drizzle query API; the PGlite type is used for both.
 */

export type AppDb = PgliteDatabase<typeof schema>;

let instance: Promise<AppDb> | null = null;

async function create(): Promise<AppDb> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { Pool } = await import("@neondatabase/serverless");
    const { drizzle } = await import("drizzle-orm/neon-serverless");
    return drizzle({ client: new Pool({ connectionString: url }), schema }) as unknown as AppDb;
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
