import { writeFileSync } from "node:fs";
import { getCurrentTrip, writeVersion } from "@/server/trips";
import type { Owner } from "@/server/owner";
import { parseTripDoc, type TripOption } from "@/domain/schema";
import { applyOp } from "@/domain/ops";
import { optionCard, dayNightLabel } from "@/domain/options";

const [dir, flag] = process.argv.slice(2);
const owner = { githubId: (process.env.OWNER_GITHUB_IDS ?? "").split(",")[0].trim() } as Owner;
const cur = (await getCurrentTrip(owner))!;
const options: TripOption[] = [
  {
    key: "east-3d2n", group: "east", title: "東海岸三天兩夜", region: "東海岸", themes: ["hike", "town"], chosen: false, start: "2026-11-09",
    summary: "酒杯灣步道、Honeymoon Bay 夕陽、火焰灣橘色岩石，住 Bicheno 和朗塞斯頓，回程經 Ross 小鎮。",
    days: [
      { title: "東海岸：Swansea → 酒杯灣 → Bicheno", stay: "coles", driveHrs: 3, itemIds: ["a38", "a39", "a40", "h09"] },
      { title: "火焰灣 → 朗塞斯頓", stay: "lst", driveHrs: 4, itemIds: ["a41", "a42", "h10"] },
      { title: "卡塔拉克特峽谷 → Ross → 回荷巴特", stay: "utas", driveHrs: 2.5, itemIds: ["a43", "a44"] },
    ],
  },
  {
    key: "nw-cradle-3d2n", group: "northwest", title: "搖籃山＋Stanley＋Penguin 三天兩夜", region: "西北海岸", themes: ["hike", "wildlife", "town"], chosen: false, start: "2026-11-16",
    summary: "夜看袋獾、鴿子湖環湖、Ronny Creek 看袋熊，再到 Stanley 的 The Nut 和 Penguin 小鎮。",
    days: [
      { title: "前往搖籃山・夜看袋獾", stay: "cradle", driveHrs: 4.5, itemIds: ["a49", "a50", "a52", "h16"] },
      { title: "鴿子湖 → 西北海岸 Stanley", stay: "stanley", driveHrs: 2.5, itemIds: ["a51", "g36", "g37", "h17"] },
      { title: "Stanley → Penguin 小鎮 → 回荷巴特", stay: "utas", driveHrs: 5, itemIds: ["g38", "a53"] },
    ],
  },
  {
    key: "nw-stanley-2d1n", group: "northwest", title: "只去 Stanley＋Penguin 兩天一夜", region: "西北海岸", themes: ["town"], chosen: false, start: "2026-11-16",
    summary: "不去搖籃山：直接開到 Penguin 和 Stanley 住一晚，隔天回荷巴特，第三天在荷巴特休息。",
    days: [
      { title: "荷巴特 → Penguin → Stanley", stay: "stanley", driveHrs: 5, itemIds: ["g38", "g37", "h17"] },
      { title: "Stanley → 回荷巴特", stay: "utas", driveHrs: 5, itemIds: ["a53"] },
      { title: "荷巴特休息日", stay: "utas", driveHrs: 0, noDriver: true, itemIds: [] },
    ],
  },
];
const doc = structuredClone(cur.doc) as typeof cur.doc;
doc.skyWatch ??= { links: [], posts: [] };
if (!doc.skyWatch.links.some((l) => l.url === "https://www.facebook.com/groups/auroraaustralis"))
  doc.skyWatch.links.push({ id: "fb-aurora", kind: "aurora", label: "Aurora Australis 南極光社團（Facebook）", url: "https://www.facebook.com/groups/auroraaustralis" });
doc.tripOptions = options;
const p = parseTripDoc(doc);
if (!p.ok) throw new Error(JSON.stringify(p.errors));
const ids = (d: typeof p.doc) => [...d.days.flatMap((x) => x.items.map((i) => i.id)), ...d.attractionPool.flatMap((x) => x.items.map((i) => i.id))].sort().join();
for (const o of p.doc.tripOptions) {
  const c = optionCard(p.doc, o, p.doc.partySize);
  console.log(o.key, dayNightLabel(c), "drive", c.driveHrs, "cost", c.cost, "stays", c.stays.map((s) => `${s.key}×${s.nights}@${s.nightly}`).join(" "), "photo", !!c.photo, "people", c.people.join());
  console.log("   ", c.items.map((d) => d.map((i) => i.name).join(" / ")).join(" | "));
  const r = applyOp(p.doc, { op: "applyOption", key: o.key });
  if (!r.ok) throw new Error(o.key + ": " + r.error);
  const r2 = parseTripDoc(r.doc);
  console.log("    apply ok, schema", r2.ok, "ids same", ids(r.doc) === ids(p.doc));
}
// A → B → A round trip on the real document.
let x = p.doc;
for (const k of ["nw-cradle-3d2n", "nw-stanley-2d1n", "nw-cradle-3d2n"]) {
  const r = applyOp(x, { op: "applyOption", key: k });
  if (!r.ok) throw new Error(r.error);
  x = r.doc;
}
console.log("round trip ids same", ids(x) === ids(p.doc), "11/18 items", x.days.find((d) => d.date === "2026-11-18")!.items.map((i) => i.id).join());
console.log("v", cur.versionNo);
if (flag === "--dump") writeFileSync(`${dir}/preview-doc.json`, JSON.stringify(p.doc));
if (flag === "--write") {
  writeFileSync(`${dir}/trip-v${cur.versionNo}-before-options.json`, JSON.stringify(cur.doc));
  const r = await writeVersion(owner, cur.versionNo, async () => ({ doc: p.doc, summary: "新增多日行程方案（東海岸、西北海岸兩案）與極光／藍眼淚區" }));
  console.log("wrote v", r.versionNo);
}
process.exit(0);
