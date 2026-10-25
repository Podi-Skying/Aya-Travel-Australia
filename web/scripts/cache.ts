import { getLookup, listLookups, putLookup } from "../src/server/cache";

/*
 * Research cache for Claude sessions (PLAN-2026-10-26 §2): check here before searching the web
 * again for prices, drive times or sources, and store what a search found.
 *
 *   npx tsx --env-file=.env.local scripts/cache.ts list [kind]
 *   npx tsx --env-file=.env.local scripts/cache.ts get <kind> <key>
 *   npx tsx --env-file=.env.local scripts/cache.ts put <kind> <key> '<json>' --source "<where>" [--ttl-days N]
 */

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "list") {
    for (const r of await listLookups(rest[0]))
      console.log(`${r.kind}\t${r.key}\t${r.fetchedAt.toISOString().slice(0, 10)}\t${r.expiresAt ? `expires ${r.expiresAt.toISOString().slice(0, 10)}` : "no expiry"}\t${r.source}`);
  } else if (cmd === "get" && rest.length >= 2) {
    const r = await getLookup(rest[0], rest[1]);
    console.log(r ? JSON.stringify({ ...r, value: r.value }, null, 2) : "not cached");
  } else if (cmd === "put" && rest.length >= 3) {
    const [kind, key, raw] = rest;
    const opt = (name: string) => {
      const i = rest.indexOf(name);
      return i >= 0 ? rest[i + 1] : undefined;
    };
    const source = opt("--source");
    if (!source) throw new Error("--source is required");
    const days = opt("--ttl-days");
    await putLookup(kind, key, JSON.parse(raw), source, days ? Number(days) * 86_400_000 : null);
    console.log("stored", kind, key);
  } else {
    console.log("usage: cache.ts list [kind] | get <kind> <key> | put <kind> <key> '<json>' --source <s> [--ttl-days n]");
    process.exitCode = 2;
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
