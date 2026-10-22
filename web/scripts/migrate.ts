import path from "node:path";

/* Applies drizzle/ migrations to DATABASE_URL (Neon), or to the local PGlite database when unset. */

async function main() {
  const folder = path.resolve(__dirname, "..", "drizzle");
  if (process.env.DATABASE_URL) {
    const { Pool } = await import("@neondatabase/serverless");
    const { drizzle } = await import("drizzle-orm/neon-serverless");
    const { migrate } = await import("drizzle-orm/neon-serverless/migrator");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
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
