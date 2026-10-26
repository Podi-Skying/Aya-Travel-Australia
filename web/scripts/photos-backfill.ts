import { getCurrentTrip } from "../src/server/trips";
import type { Owner } from "../src/server/owner";
import { commonsPhotos } from "../src/server/commons";
import { getLookup } from "../src/server/cache";
import { googleKey, sameRef, type PlaceRef } from "../src/server/google";
import { galleryPhotos } from "../src/domain/gallery";
import type { Photo } from "../src/domain/schema";

/*
 * Gallery photos backfill (docs/PLAN-2026-10-26-galleries.md), run by hand:
 *   npx tsx --env-file=.env.local scripts/photos-backfill.ts            # coverage report only
 *   npx tsx --env-file=.env.local scripts/photos-backfill.ts --write    # also search Wikimedia Commons once per activity
 * Prints how many activities reach 5 photos for share-link viewers (own + Commons) and for the owner
 * (plus up to 6 live Google photos where a place id is mapped), and lists the rest.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const write = process.argv.includes("--write");
  const owner = { githubId: (process.env.OWNER_GITHUB_IDS ?? "").split(",")[0].trim() } as Owner;
  const cur = await getCurrentTrip(owner);
  if (!cur) throw new Error("no trip");
  const items = [...cur.doc.days.flatMap((d) => d.items), ...cur.doc.attractionPool.flatMap((p) => p.items)].filter((i) => i.mode !== "flight" && !i.name.startsWith("住宿："));
  const rows: { name: string; share: number; owner: number }[] = [];
  let searched = 0;
  for (const i of items) {
    let commons: unknown[] = [];
    if (i.lat != null && i.lng != null) {
      const before = await commonsPhotos(i.id, i.name, i.lat, i.lng, { search: false }).catch(() => null);
      if (before === null && write) {
        // Polite to the Commons API: one search every 1.5 s, one retry after 10 s when refused.
        commons = (await commonsPhotos(i.id, i.name, i.lat, i.lng, { search: true }).catch(async () => {
          await sleep(10_000);
          return commonsPhotos(i.id, i.name, i.lat!, i.lng!, { search: true }).catch(() => []);
        })) ?? [];
        searched++;
        await sleep(1_500);
      } else commons = before ?? [];
    }
    // Same assembly (and de-duplication) as the gallery itself.
    const share = galleryPhotos(i, commons as Photo[]).length;
    const ref = await getLookup<PlaceRef>("place-id", i.id).catch(() => null);
    const google = ref?.value.placeId && sameRef(ref.value, i.name, i.lat, i.lng) && googleKey() ? 6 : 0;
    rows.push({ name: i.name, share, owner: share + google });
  }
  const five = (k: "share" | "owner") => rows.filter((r) => r[k] >= 5).length;
  console.log(`${searched} Commons searches. ${rows.length} activities: ${five("share")} have 5+ photos for share links; for the owner up to ${five("owner")} (an upper bound: Google returns up to 6 live, sometimes fewer).`);
  for (const r of rows.filter((x) => x.owner < 5 || x.share < 5)) console.log(`  under 5 — share ${r.share}, owner up to ${r.owner}: ${r.name}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error((e as Error).message);
    process.exit(1);
  });
