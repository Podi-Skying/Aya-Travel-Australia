import { getCurrentTrip } from "../src/server/trips";
import type { Owner } from "../src/server/owner";
import { getLookup } from "../src/server/cache";
import { findPlaceId, googleKey, sameRef, type PlaceRef } from "../src/server/google";
import { getLegs, type Pt } from "../src/server/routes";
import { routeStops, stopsOf, type Stop } from "../src/components/useLegs";
import { dayEnds } from "../src/domain/home-pins";
import { listPrice } from "../src/server/usage";

/*
 * One-time Google backfill (docs/PLAN-2026-10-26-google.md), run by hand after the key is set:
 *   npx tsx --env-file=.env.local scripts/google-backfill.ts           # dry run: counts and estimate
 *   npx tsx --env-file=.env.local scripts/google-backfill.ts --write   # calls Google, within the daily cap
 * Finds place ids for activities with a position, and stores every driving leg of the scheduled days
 * and of the recommended plans in route_cache.
 */

async function main() {
  const write = process.argv.includes("--write");
  if (!googleKey()) throw new Error("GOOGLE_MAPS_API_KEY is not set");
  const owner = { githubId: (process.env.OWNER_GITHUB_IDS ?? "").split(",")[0].trim() } as Owner;
  const cur = await getCurrentTrip(owner);
  if (!cur) throw new Error("no trip");
  const doc = cur.doc;

  // Places: activities (days and pool) with coordinates but no photo of their own.
  // Every activity with a position (galleries add Google photos even where an own photo exists).
  const items = [...doc.days.flatMap((d) => d.items), ...doc.attractionPool.flatMap((p) => p.items)].filter((i) => i.lat != null && i.lng != null);
  const todo: typeof items = [];
  // Missing mappings, and mappings made for an old name or position.
  for (const i of items) {
    const hit = await getLookup<PlaceRef>("place-id", i.id).catch(() => null);
    if (!hit || !sameRef(hit.value, i.name, i.lat, i.lng)) todo.push(i);
  }

  // Routes: each run of consecutive drive legs, in chunks of at most 25 points.
  // Scheduled days, plus each recommended plan's days so their routes are ready when a plan is applied.
  const all = [...doc.days.flatMap((d) => d.items), ...doc.attractionPool.flatMap((p) => p.items)];
  const dayLists = [
    ...doc.days.map((d) => ({ seg: d.seg, items: d.items, date: d.date as string | undefined })),
    ...(doc.tripOptions ?? []).flatMap((o) => o.days.map((od) => ({ seg: "tas", items: od.itemIds.map((id) => all.find((i) => i.id === id)).filter((i): i is (typeof all)[number] => !!i).sort((x, y) => x.time.localeCompare(y.time)), date: undefined }))),
  ];
  const runs: Pt[][] = [];
  for (const d of dayLists) {
    // Scheduled days run from last night's stay to tonight's (Kai 2026-10-26), so those legs are stored too.
    const stops: Stop[] = d.date ? routeStops(d.items, dayEnds(doc, d.date)) : stopsOf(d.items, (i) => i.lat! > -40 === (d.seg === "syd"));
    let run: Pt[] = [];
    stops.forEach((s, k) => {
      if (k && s.drive) {
        if (!run.length) run.push(stops[k - 1].pt);
        run.push(s.pt);
      } else if (run.length) {
        runs.push(run);
        run = [];
      }
    });
    if (run.length) runs.push(run);
  }
  const chunks = runs.flatMap((r) => {
    const out: Pt[][] = [];
    for (let a = 0; a < r.length - 1; a += 24) out.push(r.slice(a, a + 25));
    return out;
  });
  const pending: Pt[][] = [];
  for (const c of chunks) {
    const r = await getLegs(c, { compute: false });
    if (r.legs.some((l) => !l || (l.source !== "google-routes" && l.source !== "same-place"))) pending.push(c);
  }

  console.log(`trip v${cur.versionNo}: ${todo.length} activities need a place id (of ${items.length} with a position); ${pending.length} of ${chunks.length} driving runs need Google routes`);
  console.log(`estimated list price: places search US$${listPrice("places_search", todo.length)} (Text Search Pro, 5,000 free a month), routes US$${listPrice("routes", pending.length)} before free monthly calls`);
  if (!write) return console.log("dry run: add --write to call Google");

  let places = 0,
    found = 0,
    routes = 0,
    legs = 0;
  for (const i of todo) {
    try {
      const id = await findPlaceId(i.id, i.name, i.lat!, i.lng!);
      places++;
      if (id) found++;
    } catch (e) {
      console.log(`stopped at places (${places} done): ${(e as Error).message}`);
      break;
    }
  }
  for (const c of pending) {
    try {
      const r = await getLegs(c, { compute: true, upgrade: true, provider: "google" });
      routes++;
      legs += r.computed;
    } catch (e) {
      console.log(`stopped at routes (${routes} done): ${(e as Error).message}`);
      break;
    }
  }
  console.log(`done: ${places} place searches (${found} found), ${routes} route calls (${legs} legs stored in route_cache)`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error((e as Error).message);
    process.exit(1);
  });
