import path from "node:path";

/*
 * Applies drizzle/ migrations to Neon over the direct (unpooled) connection, as Neon
 * advises for migrations, or to the local PGlite database when no URL is set.
 */

async function main() {
  const folder = path.resolve(__dirname, "..", "drizzle");
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (url) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const { pgConnectionString } = await import("../src/server/db/client");
    const pool = new Pool({ connectionString: pgConnectionString(url) });
    await migrate(drizzle({ client: pool }), { migrationsFolder: folder });
    await pool.end();
  } else {
    const { getDb } = await import("../src/server/db/client");
    await getDb(); // the local client migrates on open
  }
  console.log("migrations applied");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
