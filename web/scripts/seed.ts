import { eq } from "drizzle-orm";
import { getDb, schema } from "../src/server/db/client";
import { createTrip } from "../src/server/trips";
import { ownerIds } from "../src/server/auth";
import { loadLegacyData } from "./legacy";
import { buildSeed, SEED_SUMMARY } from "./seed-2026-11";

/* Creates the owner's trip as version 1 (PLAN.md 4.9). Refuses to run twice. */

async function main() {
  const owner = ownerIds()[0];
  if (!owner) throw new Error("OWNER_GITHUB_IDS is not set");
  const db = await getDb();
  const existing = await db.select({ id: schema.trips.id }).from(schema.trips).where(eq(schema.trips.ownerGithubId, owner)).limit(1);
  if (existing.length) {
    console.log("trip already exists; nothing to do");
    return;
  }
  const id = await createTrip(db, owner, buildSeed(loadLegacyData()), SEED_SUMMARY);
  console.log(`created trip ${id} for GitHub user ${owner}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
