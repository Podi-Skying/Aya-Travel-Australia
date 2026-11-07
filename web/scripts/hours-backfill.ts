import { getCurrentTrip } from "../src/server/trips";
import type { Owner } from "../src/server/owner";
import { getLookup } from "../src/server/cache";
import { findPlaceId, googleKey, placeHours, sameRef, type PlaceRef } from "../src/server/google";
import { listPrice } from "../src/server/usage";
import { isLogistics } from "../src/domain/day-title";

/*
 * Opening hours for the trip's places (Kai 2026-11-07), run by hand:
 *   npx tsx --env-file=.env.local scripts/hours-backfill.ts          # dry run: counts and estimated price
 *   npx tsx --env-file=.env.local scripts/hours-backfill.ts --write  # calls Google, within the daily cap
 * Scheduled stops with a position; add --pool to include the unscheduled places. Places with fresh cached
 * hours are skipped: nothing refreshes them automatically (the owner can refresh one place from its card).
 */

async function main() {
  const write = process.argv.includes("--write");
  if (!googleKey()) throw new Error("GOOGLE_MAPS_API_KEY is not set");
  const owner = { githubId: (process.env.OWNER_GITHUB_IDS ?? "").split(",")[0].trim() } as Owner;
  const cur = await getCurrentTrip(owner);
  if (!cur) throw new Error("no trip");
  const pool = process.argv.includes("--pool") ? cur.doc.attractionPool.flatMap((p) => p.items) : [];
  const items = [...cur.doc.days.flatMap((d) => d.items), ...pool].filter((i) => i.lat != null && i.lng != null && !isLogistics(i) && !i.name.startsWith("住宿：") && i.mode !== "flight");
  const seen = new Set<string>();
  let search = 0;
  let details = 0;
  for (const i of items) {
    if (seen.has(i.id)) continue;
    seen.add(i.id);
    const ref = await getLookup<PlaceRef>("place-id", i.id).catch(() => null);
    if (!ref || !sameRef(ref.value, i.name, i.lat, i.lng)) search++;
    const pid = ref?.value.placeId;
    const h = pid ? await getLookup("place-hours", pid).catch(() => null) : null;
    if (!h?.fresh) details++;
  }
  console.log(`trip v${cur.versionNo}: ${seen.size} places; up to ${search} place searches (US$${listPrice("places_search", search)} list price, 5,000 free a month) and up to ${details} hours lookups (US$${listPrice("place_hours", details)} list price, 1,000 free a month)`);
  if (!write) return console.log("dry run: add --write to call Google");
  let found = 0;
  let calls = 0;
  for (const id of seen) {
    const i = items.find((x) => x.id === id)!;
    try {
      const pid = await findPlaceId(i.id, i.name, i.lat!, i.lng!);
      if (!pid) continue;
      found++;
      await placeHours(pid);
      calls++;
    } catch (e) {
      console.log(`stopped after ${calls} hours lookups: ${(e as Error).message}`);
      break;
    }
  }
  console.log(`done: ${found} places matched, ${calls} hours lookups (cached ones are not billed)`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
