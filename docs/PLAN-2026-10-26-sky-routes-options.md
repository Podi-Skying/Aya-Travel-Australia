# Plan 2026-10-26: sky watch, route cache, trip option cards

Scope: the owner trip app (`/plan`, `/s/[token]`) only. The walk home page `/` and `/journey` do not change.
Builder: Claude (host). Plan reviewer and final inspector: Codex.

Kai's request: "1. 鑲嵌fb的極光與藍眼淚的社團最新資訊 2. 路線全部紀錄在資料庫避免每次重新查詢消耗token 3. 兩天一夜或三天兩夜的行程做成個別的行程方案卡片"

## Recon findings (current state)

- Routes are never computed by an API.
  - `day.driveHrs` and item times are hand-written numbers. Claude researched them in earlier sessions and stored them in the trip document.
  - Map lines are straight polylines between item coordinates: `MapViews.tsx:113` and `Places.tsx:200`.
  - `Places.tsx:68` `driveMinutes()` estimates minutes from straight-line km on every render. This runs on the client and costs nothing.
  - So "re-querying burns tokens" means that Claude re-does web research in new sessions (drive times, prices, fuel, photos). It does not refer to any runtime API.
- The DB has only `trips`, `trip_versions`, `share_links`, `interest_votes` and `rate_limits`. Migration `drizzle/0000_init.sql` is applied by `scripts/migrate.ts`. Local runs and tests use PGlite and migrate on open.
- Facebook:
  - The Groups API was removed in April 2024.
  - The Page Plugin embeds only public Pages, not Groups.
  - No embed is possible, and scraping is excluded.
- Days 11/9–11 (East Coast) and 11/16–18 (Cradle → Stanley → Penguin) still have titles, stays and drive hours, but no items. Kai cleared them in v86.
  - Their former items sit in pool package `removed-tas`: a37–a56 and the stay markers h09, h10, h16, h17.
  - Region packages `g-tas-*` hold more places, e.g. g37 Stanley and g38 Penguin.

## 1. 極光與藍眼淚 (sky watch) in 資訊與警示

### Data

New optional document field, validated by Zod:

```ts
skyWatch: {
  links: { id, kind: "aurora" | "bio", label (≤60), url (https) }[] (≤10),
  posts: { id, kind, url (https, optional), text (≤500), date (YYYY-MM-DD), photoUrl (https, optional) }[] (≤100),
}
```

- Default: `{ links: [], posts: [] }`.
- It lives in the trip document, so it is in the DB, versioned and undoable.
- New owner ops: `addSkyLink`, `removeSkyLink`, `addSkyPost`, `removeSkyPost`.
- The server assigns ids, as `addItem` does.
- The ops are added to `OPS` in `handlers.ts`.

### Privacy

- Links and posts are shown to guests.
- `toPublicDoc` already scrubs driver names and `peopleNames` from all strings, so post text is covered.
- `assertPublicSafe` throws if any of those names survives.
- Photos in posts follow the existing rule: removed unless `photos: true`. I extend the `scrub` key list to cover `photoUrl`.

### Live data (new table `lookup_cache`)

- Kp forecast:
  - Source: NOAA SWPC `https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json`. It is public and needs no key.
  - The BOM Space Weather API needs a registered API key, so it is not used now. I will tell Kai.
- Server function `getSkyOutlook()`:
  - Reads `lookup_cache` (`kind = "kp-forecast"`, `key = "noaa-3day"`).
  - If the row is missing or older than 3 hours, it refetches with a 5 s timeout, stores the result and returns it.
  - On a fetch failure it returns the stale cached value with `stale: true`, or `null`.
- `GET /api/sky` is public and read-mostly. It normally refreshes once per 3 h; the CDN coalesces concurrent visitors.
  - It returns `{ kp: { time, kp, observed|predicted }[], fetchedAt, stale, source }`.
  - It is cached at the edge with `s-maxage=600`.
- Moon and darkness:
  - Computed on the client for Hobart (-42.88, 147.33) for each Tasmania night of the trip, using the `suncalc` package (MIT, no network).
  - Shown: moon illumination %, astronomical dusk and dawn (Australia/Hobart time), and the hours of real darkness with the moon below the horizon.
  - These are pure calculations, so nothing is cached.

### UI

A new card 「極光與藍眼淚」 in `Info.tsx` with three parts:

1. **社團連結**: link cards that open in a new tab with `rel="noopener noreferrer"`.
   - With no links: "Kai 提供社團網址後會顯示在這裡".
   - The owner sees an add form (kind, label, URL) and a remove button.
2. **最新消息（Kai 整理）**: posts newest first by date.
   - Each post shows the date, a kind badge, its text, an optional photo (owner and share links only) and a 「原文」 link.
   - The owner sees an add form and a remove button.
3. **今晚看得到嗎**:
   - The next 3 days of Kp from NOAA, with a chance label for Tasmania: Kp ≥ 6 「機會高」, 5 「可能（往南看、遠離光害）」, < 5 「低」.
   - Kp per night: for each upcoming night, the highest Kp among the 3-hour slots that overlap that night's astronomical darkness (dusk to dawn, Hobart). It is shown with the slot time, never as a calendar-day maximum.
  - A moon/darkness table for all remaining Tasmania nights of the trip, scrollable.
   - The source and fetch time; 「資料可能延遲」 when stale.
   - Blue tears have no official forecast, so the card says that sightings come only from posts.

## 2. Route cache and lookup cache

### Migration `drizzle/0001_caches.sql` (Drizzle schema + generated SQL)

```
route_cache(
  id uuid pk,
  from_lat, from_lng, to_lat, to_lng  double precision   -- rounded to 5 dp
  mode text ('driving'),
  distance_m integer, duration_s integer,
  geometry jsonb ([lat,lng][] rounded to 5 dp),
  source text ('osrm-demo'), computed_at timestamptz,
  unique(from_lat, from_lng, to_lat, to_lng, mode)
)
lookup_cache(
  kind text, key text, value jsonb, source text,
  fetched_at timestamptz, expires_at timestamptz null,
  primary key(kind, key)
)
```

- Coordinates are already public in the guest document.
- These tables are global and not tied to a trip, so guests learn nothing new from them.

### Route service

`src/server/routes.ts`: `getLegs(points, { compute })`.

1. Round the points and look up every consecutive pair in `route_cache` with one query.
2. If `compute` is set and some pairs are missing:
   - Call OSRM once for the whole point list: `router.project-osrm.org/route/v1/driving/{lng,lat;...}?overview=false&steps=true&geometries=geojson`. Timeout 8 s.
   - Store every leg (distance, duration, and geometry concatenated from its steps) with `ON CONFLICT DO NOTHING`.
3. Return legs in order. Missing legs are `null`.
4. With `refresh: true`, the owner forces recomputation for the given points (`ON CONFLICT DO UPDATE`).

- OSRM demo policy allows light use with attribution, so the map shows "Routes © OSRM, data © OpenStreetMap".
- Limit: at most 25 points per request.

### API

- `POST /api/routes` body `{ points: [lat,lng][], refresh?: boolean }`.
- Guests and share links (unauthenticated): read the cache only (`compute: false`).
- The owner session: `compute: true`.
- Rate limit, using the `rate_limits` table, before any DB query:
  - Owner: 30 computes per 10 minutes, key `routes:<owner>`.
  - Everyone else: 120 cache reads per 10 minutes, key `routes-ip:<sha256(first x-forwarded-for entry)>`. Vercel sets this header.
- If storing a computed leg fails (for example, the table is missing before the migration), the computed legs are still returned, with `cached: false`.

### Client

- The maps (`Places.tsx` selected day and `MapViews.tsx` DayMap) ask for legs only for consecutive stop pairs whose destination activity has mode `drive`. Bus, walk and ferry legs stay straight and never get car times. Runs of consecutive drive legs are sent as one point list.
- When a leg exists, the map draws its road geometry instead of the straight segment.
- Missing legs stay straight.
- The day header gains 「實際道路：約 X 公里・Y 小時車程（OSRM 計算）」 when every leg is cached.
- `driveHrs` (the planning figure) is unchanged. Budget fuel still uses `driveHrs`, so no budget changes come from this.

### Research cache for Claude sessions

- `scripts/cache.ts` with `get <kind> <key>`, `put <kind> <key> <json> --source <s> [--ttl-days n]` and `list [kind]`. It reads and writes `lookup_cache`.
- I seed it with the research already done:
  - The fuel price (FuelCheck TAS 2026-10-24).
  - The stay prices of the suggested stays (from the doc).
  - The NOAA source note.
- Photo lookups are already stored on items (`item.photo`) and are not repeated, so photos need no new cache. I document this.
- `docs/DESIGN.md` and the project's `README` get a short "check `lookup_cache` before web research" rule, and I save a memory note so later sessions follow it.

## 3. Trip option cards (多日行程方案)

### Data

New optional document field:

```ts
tripOptions: {
  key, group (e.g. "east", "northwest"), title (≤60), summary (≤300), photoUrl?, chosen: boolean,
  start: date,
  days: { title (≤60), stay (stays key), driveHrs (0–12), noDriver?: boolean, itemIds: string[] }[] (1–4)
}[] (≤12)
```

- Options refer to existing item ids (pool or days). They never copy items, so the "no duplicate item id" rule holds.
- Schema checks:
  - Each `itemIds` entry exists somewhere in the document.
  - The option's date range is inside the trip.
  - At most one option per group is `chosen`.
- If an option references an item that was later deleted, the check fails and the op is rejected. `removeItem` also strips the id from every option (handled in the `removeItem` op).

### Derived card data (`src/domain/options.ts`, pure)

- Days and nights: `days.length` and the count of days whose stay is not the home base (`utas`) or `none`.
- Route summary: day titles joined with →.
- Drive hours: the sum.
- Stays: key → name, nightly price, number of nights.
- Cost estimate:
  - The items' costs for the party (pp × people, group as is).
  - Plus stays nightly × nights.
  - Plus the owner-covered driver lines, using the same rules as `budget.ts`. For that, `budget.ts` exports a helper that takes a day-like object.
- Photo: `photoUrl`, else the first item with a photo.
- People: union of the items' people, default Kai + Aya.

### Op `applyOption { key }` (owner)

1. For each option day i, date = start + i.
2. On each target date, every item except confirmed items and flights moves back to the pool, following the `unscheduleItem` rules (its origin package, or `removed-<seg>`).
3. Each referenced item is taken out of wherever it is (the pool or another day), with the same rules as `scheduleItem`. It then goes onto its option day, sorted by time.
4. The option day replaces the day's metadata. `title`, `stay` and `driveHrs` come from the option. `costs`, `transfer`, `alt`, `ferry` and `hike` are reset (the option's activities carry their own costs). `needsDriver` is kept, unless the option day sets `noDriver: true`. Then `needsDriver` and `driverConfirmation` are removed (e.g. a rest day in Hobart). Package metadata on activities is never erased, so the option is refused when such a day still needs a driver through its activities (R4-001).
5. In the group, `chosen = true` for this option and false for the others.
6. One op means one version. The client uses `runOpUndoable`, so the toast offers undo.
7. Fails with a 400 error naming the item if a referenced item is `confirmed` on another date. A confirmed item never moves.

### Seed data (one backed-up data write, new version)

| key | group | title | days |
|---|---|---|---|
| east-3d2n | east | 東海岸三天兩夜 | 11/9 Swansea・Spiky Bridge → 酒杯灣 → Honeymoon Bay (a38, a39, a40, h09; stay coles) / 11/10 Bay of Fires → Launceston (a41, a42, h10; stay lst) / 11/11 Cataract Gorge → Ross → back to Hobart (a43, a44; stay utas). Ross sits on the Launceston–Hobart road, so it belongs to the way back. |
| nw-cradle-3d2n | northwest | 搖籃山＋Stanley＋Penguin 三天兩夜 | 11/16 Sheffield → Cradle visitor centre → Devils@Cradle (a49, a50, a52, h16; stay cradle) / 11/17 Dove Lake → Ronny Creek → Stanley (a51, g36, g37, h17; stay stanley) / 11/18 Penguin → Hobart (g38, a53; stay utas) |
| nw-stanley-2d1n | northwest | 只去 Stanley＋Penguin 兩天一夜 | 11/16 Hobart → Penguin → Stanley (g38, g37, h17; stay stanley; 5 h) / 11/17 Stanley → Hobart via Bothwell/Oatlands (a53; stay utas; 5 h) / 11/18 rest day in Hobart (no items, stay utas, 0 h, noDriver) |

- `east-3d2n` and `nw-cradle-3d2n` are seeded with `chosen: false`, because the days are currently empty.
- The seed does not apply them. Kai picks.
- The JJ days (11/14–15, 11/21–22) are day trips with no overnight stay, so they get no cards. I will say so to Kai.

### UI: new tab 「行程方案」 between 每日行程 and 地圖與景點

- Options are grouped by `group`, and each group header shows the date range.
- Cards sit side by side, in a CSS grid of 1 to 3 columns.
- Each card shows:
  - The photo (when photos are allowed), the title and 「3 天 2 夜」.
  - The route summary and the drive hours.
  - Stays with nightly prices.
  - The estimated cost with an 「估計」 badge.
  - The avatar stack.
  - A per-day list of item names.
- The chosen card shows 「目前採用」.
- The owner gets a 「採用這個方案」 PendingButton with a confirm dialog: "會把 11/16–11/18 目前的活動移回待安排，換成這個方案". It uses `runOpUndoable`.
- Guests see the cards read-only, with driver names scrubbed as usual.

## Non-goals

- Facebook embedding or scraping.
- BOM API key registration.
- Editing option contents in the UI. Kai asks me, or uses an option and then edits the days.
- Changing `/` or `/journey`.
- Changing budget rules.

## Acceptance criteria

1. Info shows the 極光與藍眼淚 card. NOAA Kp appears on production; with the network blocked, the card degrades gracefully. The owner can add and remove links and posts; guests see them without names or private fields.
2. `route_cache` and `lookup_cache` exist in Neon after `npm run db:migrate`.
   - The first owner view of a driving day computes and stores legs. A second view makes no OSRM call; a test proves the cache hit.
   - Guests never trigger an OSRM call.
3. `scripts/cache.ts get fuel tas-u91` prints the cached fuel price.
4. The 行程方案 tab shows 3 cards in 2 groups with correct days/nights, drive hours, stays and cost.
   - Applying `nw-stanley-2d1n` and then `nw-cradle-3d2n` yields the expected days.
   - No item is lost or duplicated: the total item count is constant, and the schema passes.
   - Undo restores the previous version.
5. Public documents (`/api/public`, share) contain no driver or friend names and no `photoUrl` without photos permission.
6. `npm test` (all existing tests plus new ones), `npm run lint`, `npx tsc --noEmit` and `npm run build` pass.

## Verification

- Unit tests:
  - Schema accepts and rejects for `skyWatch` and `tripOptions`.
  - Sky ops.
  - `applyOption` round trips (A → B → A keeps the item set; confirmed items stay; the chosen flag is set).
  - Option derived numbers.
  - `getLegs` with a fake fetch: first call fetches and stores, second call makes zero fetches, and `compute: false` makes zero fetches.
  - `lookup_cache` TTL logic.
  - Privacy for posts.
- Integration: PGlite tests through the handlers, as existing tests do.
- Real data: run the seed script in dry-run mode on the production doc and print each option's derived card. Then apply each option to a copy and check the item-count invariant and `parseTripDoc` on the real doc.
- Manual: browser pane on production after deploy.
  - The Info card, Kp values, the route geometry on 11/9 after applying an option on a copy, or on any driving day with stops.
  - The 行程方案 tab at 375 px and desktop.

## Rollout order

1. Code + migration commit, pushed. Vercel deploys. Then run `npm run db:migrate` against Neon. Tables are additive, and the new code tolerates missing tables by catching errors and computing without cache until the migration exists.
2. Data write (back up first): `skyWatch` default, `tripOptions` seed. Then seed `lookup_cache`.
3. Codex inspection of the final diff; fix; re-inspect if needed.

## Risks

- The OSRM demo server can be slow or down. Without it, maps fall back to straight lines and nothing else breaks.
- NOAA format change: parsing is defensive, and on failure the card shows 「暫時無法取得」.
- A Kp threshold for Tasmania is a rule of thumb and is labelled as such.
- `applyOption` is the riskiest op. It is covered by invariant tests on the real document.

## 4. chictrip review additions (Kai, 2026-10-26)

- The review is saved at `../prototypes/route-walk/CHICTRIP-REVIEW.md`, outside the repo.
- It is folded into `docs/DESIGN.md` as 「v2.x 補充：參考 chictrip」.
- Priorities: P1 first. If time runs short, P2 is reported instead of built.

### P1-a Option cards: layout and filters (merges with section 3)

- Option fields gain:
  - `region` (≤20 chars, e.g. 東海岸, 西北海岸)
  - `themes: ("aurora"|"bio"|"hike"|"food"|"wildlife"|"town")[]`
- Card layout:
  - Cover photo, or a hand-drawn line-art SVG fallback, with a region badge at the bottom left.
  - Title, a 「3天2夜」 tag and theme tags.
  - The estimated cost and the 想去 count.
- 想去 count:
  - The owner sees the sum of existing `interest_votes` counts for the option's items, from both `counts.current` and `counts.moved`. This reuses the counts already loaded for the owner.
  - Guests see no counts, as today.
  - There are no likes.
- Filters above the grid: days (全部/1/2/3), theme chips and region chips. They are client-side and kept in the URL query (`optDays`, `optTheme`, `optRegion`), like the map filters.
- Primary action:
  - Owner: 「套用到 11/16–11/18」 (the applyOption op from section 3).
  - Guest: 「分享」, using the Web Share API with the current URL. Without the API it copies the link and shows a toast.
- Card detail: opening a card expands its per-day list in place. The split map reuses the map tab: a 「在地圖上看」 link goes to `?tab=map&day=<first date>`. No separate detail page.

### P1-b Summary card at the top of 總覽

- It replaces the hero's three chip-hero meta items. The hero keeps the title, subtitle and walk link.
- The trip-day countdown moves into the card.
- Three figures: 天數 | 日期 (11/3–11/27) | 目的地 (segment names joined, e.g. 雪梨・塔斯馬尼亞).
- Tags, derived and not stored:
  - 自駕: any day has `needsDriver`.
  - 公車免費: any Tasmania day.
  - 極光季: always, for Tasmania in November. The label reads 「極光季（11 月仍可能）」.
  - The owner cannot edit tags in v1.
- 途經地區 chips:
  - `regionsOf(doc)` in `src/domain/regions.ts` matches a fixed keyword table against day titles and item names: 雪梨、藍山、荷巴特、布魯尼島、塔斯曼半島、東海岸、朗塞斯頓、搖籃山、西北海岸、Huon Valley、Mount Field.
  - Chips appear in trip order. Each chip links to the first matching day.
  - Region names are not private.

### P1-c Map tab split view

Existing: Places.tsx already has a 1fr/360px split and a phone bottom sheet with three detents and spring release. I keep that structure and widen the panel to 30%: `minmax(320px, 30%)`.

Added:

1. **Day strip** at the top of the panel: horizontally scrolling chips 全部 | 11/3 | 11/4 … with 44px targets. `day=<date>` is stored in the URL.
2. **Drawing:**
   - All days: ink-coloured lines at 35% opacity, dashed, with small dots and no labels.
   - Selected day:
     - A vermilion line, using road geometry from the route cache when available.
     - Numbered pins 1..n in the day's order. Clicking a pin opens the existing popup.
     - The map fits the day's bounds.
   - This replaces the per-segment colours on this map only. DaysView's DayMap gets the same vermilion line and numbered pins (it already numbers its pins).
3. **Tools** (top-left, 44px buttons):
   - 「全覽」: fits the whole trip.
   - 「只看今天」: a toggle, on by default while today is within the trip.
   - 「我的位置」: calls `navigator.geolocation` only on click. The position is shown as a dot and is never sent to the server.
4. The pool pins and filters stay as they are.
5. Reduced motion: no `flyTo` animation.

### P2-a Numbered stops and legs in DaysView

- Each activity card shows its number, matching the map pin.
- Between consecutive stops that have coordinates, on driving days, a leg row shows a line icon and 「1 小時 40 分・82 公里」 from `route_cache`. The rows are fetched with the day's legs request from section 2, with cache-only reads for guests.
- Where no cached leg exists, the row is omitted. It is never recomputed client-side as a fake.

### P2-b Share button

- Owner: a 「分享」 button at the top right of the map panel and on the 總覽 summary card.
- It calls the existing share-link API: create or show the active `/s/<token>`. It then uses Web Share where available, else copies the link.
- Creating a link is not a silent side effect: the button reads 「建立分享連結」 when none exists and asks for confirmation.

### Additional acceptance criteria

7. 總覽 starts with the summary card (three figures, tags, region chips). A chip click opens that day. The hero no longer shows the old chip row.
8. 行程方案 filters narrow the cards. The owner sees 「套用到 …」, guests see 分享.
9. Map tab:
   - Desktop panel is about 30%.
   - Selecting a day in the strip draws it in vermilion with numbered pins and fits its bounds, while other days stay faded ink.
   - 全覽 and 只看今天 work.
   - 我的位置 asks for permission only on click.
10. P2, if built: numbered activity cards and cached leg rows; the share button creates or reuses a link only after confirmation.
11. All new controls have ≥44px targets on touch, keyboard access, and reduced-motion behaviour.


## Revision 1: dispositions of Codex round-1 findings (2026-10-26)

- **F-001, accepted.** Option days replace `costs`, `transfer`, `alt`, `ferry` and `hike`. A new `noDriver` flag drops the driver need and confirmation. See §3 step 4.
- **F-002, accepted.** Legs are requested only for pairs whose destination activity is `drive`. See §2 Client.
- **F-003, accepted.** Guests get an IP rate limit as well as the owner quota. See §2 API.
- **F-004, already covered.** The backfill is the one-off data script described under Seed data and Rollout. It writes a backed-up new version after `parseTripDoc` and invariant checks on the real document. It is deliberately not part of `scripts/seed.ts`, which only creates new trips.
- **F-005, accepted.** `scripts/cache.ts` exists, and an npm script `cache` is added. Lookup rows are seeded at rollout.
- **F-006, accepted.** 想去 counts include moved votes.
- **F-007, rejected.**
  - The duplicate fetch in question happens only when several requests arrive at the same moment, just after the 3-hour TTL expires.
  - `/api/sky` responses carry `s-maxage=600`, so the Vercel CDN merges simultaneous visitors into one origin request.
  - The site has one or two viewers. At worst NOAA gets a few extra GETs, which is harmless; a DB lease would add complexity for nothing.
  - The plan wording changes from "at most once" to "normally once per TTL".
- **F-008, accepted.** Kp is shown per dark night, with the slot time.
- **F-009, accepted.** All remaining Tasmania nights are shown.
- **F-010, accepted.** DayMap uses the vermilion line, road legs and attribution.
- **F-011, accepted.** Filters are kept in the URL, and each card gets a 「在地圖上看」 link to `?tab=map&mday=<first date>`.
- **F-012, accepted.** "路線 © OSRM・地圖資料 © OpenStreetMap" is shown wherever road geometry is drawn.
- **F-013, accepted.** A failed cache write still returns the computed legs.

## Revision 2: dispositions of Codex round-2 findings

- **F-014, accepted.** `removeItem` and `applyOption` drop day attachments whose package no longer has an activity on that day.
- **F-015, accepted.** The owner computation quota fails closed. Guest cache reads fail open.
- **F-016, accepted.** The road total is shown only when every drive pair has a cached leg, and only drive legs are summed.
- **F-017, partly accepted.**
  - Map points now require both lat and lng.
  - I did not add a schema rule requiring both-or-none. It could reject stored documents, which is out of scope here. `stopsOf` and the map already skip items with a partial position.
- **F-018, accepted.** Driving runs are split into chunks of 25 points that share their end points.
- **F-019, rejected.**
  - A 400 error that names the confirmed item is enough for a single-owner UI.
  - Adding 409 to OpResult would touch every op for no user-visible gain.
  - The §3 wording now says 400.
- **F-020, accepted.** Numbered day pins sit in a 44px hit area.

## Revision 3: dispositions of Codex round-3 findings

- **R3-001, accepted, then superseded by R4-001.** See Revision 4.
- **R3-002, accepted.** `stopsOf` breaks the route at any activity without coordinates. There is never a leg across an unlocated stop.
- **R3-003, accepted.** The owner's cache reads are not limited. The computation quota is charged only when legs are missing (or a refresh is asked) and OSRM will be called. When the quota is used up, the response returns the cached legs with `limited: true`. Guests are limited per IP for all requests.
- **R3-004, accepted.** The schema checks that every calendar date of an option is a trip day, and that each referenced item's region matches its target day.
- **R3-005, accepted.** The seed table now records the intended itineraries:
  - a44 (Ross) moves to 11/11, the way back.
  - g36 (Ronny Creek) is on 11/17.
  - In nw-stanley-2d1n, a53 is on 11/17, and 11/18 is a `noDriver` rest day.

## Revision 4: dispositions of Codex round-4 findings

- **R4-001, accepted, with a narrower fix.**
  - `noDriver` removes only the day's own driver need and confirmation. Package metadata stays intact, so it travels back to the pool correctly.
  - If the day still needs a driver through its activities (attached packages or package contexts), `applyOption` refuses with a 400 error.
  - A rest day has no such activities in the seed.
- **R4-002, accepted.** Option dates are computed only when `start` is a real date, so a malformed start gives a validation error, not a crash.

## Revision 5: dispositions of Codex round-5 findings (the last plan-review round)

- **R5-001, accepted.** `stopsOf(items, keep)` treats activities that are not drawn on the map (no position, or another region) as gaps. The selected-day map passes the full activity list.
- **R5-002, accepted.** If getting the database fails after OSRM succeeds, the computed legs are still returned, with `cached: false`.
- **Status.** The plan-review budget (5 rounds) is used up. These two fixes are covered by the fresh final code inspection instead of a 6th plan review.

## Final inspection 1: dispositions

- **R-001 and R-002 (backfill script), rejected.** The backfill is a one-off migration by project convention (back up, write, delete; see the earlier data scripts).
  - It ran on 2026-10-26 and wrote v89 (backup `trip-v88-before-options.json`).
  - Before the write it printed the schema, item-set and A→B→A invariants, and all of them passed on the production document.
  - The guest document check after the write shows 3 options and the aurora link, with no private names or fields.
- **R-003, accepted.** 「全覽」 resets the day, region and layer filters, and refits after the redraw.
- **R-004, accepted.** The self-drive tag uses `effectiveDay(d).needsDriver`.
- **R-005, accepted.** The day map note now says that computed drive legs follow roads and the other legs are straight lines.
