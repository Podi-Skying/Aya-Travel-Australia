# PLAN: First-version architecture for Aya Travel Australia

Status: draft for independent review (claudex-loop, host = Claude Code, reviewer = Codex, builder = Claude, inspector = fresh Codex session).

## 1. Goal

Replace the browser-only static prototype (`site/`) with a deployable first version that the owner (Kai), Aya, and invited friends can use on phones during the trip, which starts on **2026-11-03** (owner statement, 2026-10-22). The build must:

1. Fix the system architecture that `docs/DECISIONS.md` lists as "explicitly undecided" and record it in an ADR.
2. Implement the architecture end to end for the requirements that the static prototype only simulated: owner login, server-side storage and versions, view-only share links that the owner can deactivate, cross-device aggregate interest, and offline viewing with a last-sync time.
3. Keep feature parity with the prototype's itinerary, budget, rules, map, and information views.

AI itinerary generation (FR-02, FR-03, FR-06, FR-08 for AI changes) is **phase B** and is a non-goal for this build. This build only fixes the AI architecture decision (section 4.7) so that phase B does not change the data model.

## 2. Confirmed decisions (owner, 2026-10-22, via project thread)

| # | Decision | Source |
|---|---|---|
| D1 | Code is hosted on GitHub: `https://github.com/Podi-Skying/Aya-Travel-Australia` (private), branch `main`. | Owner message with repo URL |
| D2 | Hosting on Vercel (Hobby plan, private non-commercial use), deployed from GitHub. | Owner chose option 1 |
| D3 | Frontend: React with Next.js and TypeScript. | Owner accepted recommendation |
| D4 | Database: Neon Postgres (added through the Vercel Marketplace). | Owner chose option 1 |
| D5 | Owner login: GitHub OAuth through Auth.js; the only owner is GitHub user `Podi-Skying` (numeric id 32431832). Account recovery = GitHub's own account recovery. | Owner chose option 1 |
| D6 | AI provider for phase B: Claude API, called only server-side, owner-only, with a daily usage cap. | Owner chose option 1 |
| D7 | The whole trip now starts on 2026-11-03: Sydney 2026-11-03 to 11-06 first, then Tasmania 2026-11-06 to 11-27. | Owner messages "日期a" and "Sydney 11/03-11/06 塔州11/06-11/27" |
| D8 | Remove the 10/25–11/02 day plans (the travel had not started), but keep their attraction information. No day before 11/03 exists in any seeded version; the old 10/25 schedule is not kept as a version. Those activities become an unscheduled attraction pool the owner can add to days; any suggested placement is only a suggestion until the owner schedules it. | Owner message "10/25-11/02旅遊還沒開始請移除這期間的規劃，但是保留景點資訊" (relayed) |

## 3. Assumptions ledger (host-resolved, reversible)

| # | Assumption | Basis | If wrong |
|---|---|---|---|
| A1 | Itinerary dates are data, not architecture. The seed creates a single version 1 by a deterministic transform of `site/js/data.js` to the new dates (section 4.9). No date values are hard-coded in UI code: the hero, countdown, timeline axis, segment ranges, and the flight to-do are derived from the trip document. | D7; prototype hard-codes "10/25 – 11/26" and "11/3–11/6" in `site/js/app.js` `renderHero`/`renderOverview` | Low: data-only correction through JSON import |
| A12 | Driver availability stays weekday-based (Zayden Mon–Wed, JJ Sat–Sun, unconfirmed). Scheduled days from 11/03 keep their legacy dates, so `needsDriver` stays consistent with `drivers.*.weekdays`; when the owner schedules a pool package that needs a driver, the rules show the existing tentative/driver warnings for that date. UTAS Hobart Apartments (AUD $0) applies to Tasmania nights from 11/06. | `site/js/data.js` `drivers`, `stays.utas`; PRODUCT_BRIEF | Owner adjusts via edit/import |
| A2 | Use **next-auth v4 (4.24.x, stable)**, which is the Auth.js project's stable line and declares Next 16 as a peer. Auth.js v5 is still `5.0.0-beta.x` on npm (checked 2026-10-22). JWT session strategy, no database adapter. | `npm view next-auth` dist-tags and peerDependencies | Swap to v5 later; auth is isolated in `web/src/server/auth.ts` |
| A3 | Next.js 16.x App Router, React 19.x, TypeScript strict. | `npm view next version` = 16.4.2 | — |
| A4 | ORM: Drizzle ORM with SQL migrations committed to the repo. Production driver: `@neondatabase/serverless`. Local development and tests: PGlite (in-process Postgres) so no local Postgres server or Neon account is needed to run tests. | No `psql`/`postgres` on this machine | Tests would need a hosted DB |
| A5 | The itinerary is stored as a validated JSON document per version (snapshot versioning), not as normalized tables. Each version holds the full trip document. Size estimate: about 60 KB per snapshot. The server keeps every version (FR-07; no cap): 1,000 owner edits ≈ 60 MB, well inside the Neon free tier (0.5 GB). Offline storage is capped (section 4.8). | FR-07 requires full restorable versions; prototype already snapshots whole `days` | Normalize later if querying across items is needed |
| A6 | One trip, one owner, for this version. The schema keeps `trip_id` and `owner_github_id` columns so that multiple trips are possible later. | PRODUCT_BRIEF: first version centres on the real trip | — |
| A7 | Map tiles: OpenStreetMap standard tiles through Leaflet (`react-leaflet`), same as the prototype, with the text route list as the non-map alternative. | Prototype `site/index.html`; NFR-01, NFR-06 | Change tile provider if OSM usage policy is a problem |
| A8 | Offline: a hand-written service worker in `web/public/sw.js` (no plugin), plus a local copy of the last fetched trip document in IndexedDB with its sync time. | FR-24, FR-25; avoids plugin compatibility risk with Next 16 | — |
| A9 | Interest votes: the visitor's browser holds a random voter key (UUID v4) in `localStorage`; the server stores only a SHA-256 hash of it. Nickname is optional, max 20 characters. The owner sees counts only. | FR-21, FR-22, DATA_AND_PRIVACY | Duplicate protection is imperfect by design (documented) |
| A10 | The old `site/` prototype stays in the repo, unchanged, for the parity proof. Removing it is a later decision. | Proof requirement in section 7 | — |
| A11 | Weekday rules for drivers are trip data (`drivers` in the trip document), not code. | `site/js/data.js` | — |

## 4. Architecture

### 4.1 Repository layout

```
/                      repo root (unchanged: README.md, docs/, site/)
/web                   Next.js application (Vercel "Root Directory" = web)
  package.json, package-lock.json, next.config.ts, tsconfig.json, drizzle.config.ts
  drizzle/             generated SQL migrations (committed)
  public/sw.js         service worker
  public/manifest.webmanifest, icons
  src/app/             routes (App Router)
  src/components/      React UI components
  src/domain/          pure TypeScript: trip schema, budget, rules, feasibility, privacy filter
  src/server/          db client, repositories, auth, rate limit, share tokens
  src/client/          offline store (IndexedDB), API client
  scripts/             seed, legacy-parity extraction
  tests/               vitest unit + integration tests
/docs/adr/0001-first-version-architecture.md
/docs/DEPLOY.md        manual setup steps for the owner
```

### 4.2 Runtime components

```
Browser (owner / visitor)
  ├─ Next.js pages (React Server + Client Components)
  ├─ Service worker: cache app shell, static assets, last trip JSON
  └─ IndexedDB: last trip document + lastSyncAt
        │ HTTPS
Vercel (Node.js runtime functions)
  ├─ /api/auth/*            next-auth v4, GitHub provider
  ├─ /api/trip              owner: read current doc, write new version
  ├─ /api/trip/versions     owner: list, restore
  ├─ /api/trip/import       owner: validated JSON import → new version
  ├─ /api/trip/share        owner: create / deactivate share link
  ├─ /api/trip/interest     owner: aggregate counts
  ├─ /api/trip (DELETE)     owner: delete trip and all server data (FR-27)
  ├─ /api/s/[token]         public: privacy-filtered trip doc
  └─ /api/s/[token]/interest public: submit / edit / withdraw interest (rate-limited)
        │
Neon Postgres (Drizzle; PGlite locally/tests)
```

All API route handlers run on the Node.js runtime. All mutation handlers for the owner require a valid session **and** a same-origin `Origin` header (CSRF defence for cookie-authenticated JSON endpoints). Every owner **page** (`/`, `/journey`, versions, share management, pool, and any other non-`/s/` page) and every owner read route calls `requireOwner()` on the server **before** any database read: no session → redirect to GitHub sign-in; a session whose GitHub id is not in `OWNER_GITHUB_IDS` → 403 page with no trip data. The data-access functions for the owner document themselves take the verified owner identity as a required argument, so a page cannot read the owner doc without the check. Public endpoints never require cookies and only ever read `toPublicDoc` output.

### 4.3 Data model (Postgres)

- `trips(id uuid pk, owner_github_id text not null, current_version_id uuid null, created_at, updated_at)`
- `trip_versions(id uuid pk, trip_id fk on delete cascade, version_no int not null, summary text not null, doc jsonb not null, created_at, created_by text, restored_from int null, unique(trip_id, version_no))`
- `share_links(id uuid pk, trip_id fk cascade, token_hash text unique not null, active bool not null default true, created_at, deactivated_at null)`
- `interest_votes(id uuid pk, trip_id fk cascade, share_link_id fk cascade, item_id text not null, day_date text not null, nickname text null, voter_hash text not null, created_at, updated_at, unique(trip_id, item_id, day_date, voter_hash))`
- `rate_limits(key text, window_start timestamptz, count int, trip_id uuid null fk on delete cascade, primary key(key, window_start))`. Every trip-specific limit row (voter and share-link keys, phase-B AI cap) carries `trip_id`, so trip deletion removes it (FR-27).

Rules:
- Writing the trip always runs in one transaction that first locks the trip row (`SELECT … FROM trips WHERE id = $1 FOR UPDATE`), then checks the base version, inserts a new `trip_versions` row with `version_no = current + 1`, and moves `current_version_id`. The lock serializes concurrent writes per trip; a unique-violation on `(trip_id, version_no)` that still occurs is caught and mapped to HTTP 409, never a 500. Version rows are never updated or deleted, except by trip deletion. Restoring version N creates a new version whose `doc` equals version N's `doc` and whose `restored_from = N` (FR-07).
- Optimistic concurrency: a write includes `baseVersionNo`; the server rejects it with HTTP 409 if it is not the current version, so an offline or stale tab cannot silently overwrite newer edits.
- Share tokens: 32 random bytes, base64url, shown once to the owner; only `sha256(token)` is stored. Deactivating sets `active = false`; a public request with an inactive or unknown token returns HTTP 404 with no trip data (FR-23). Creating a new link deactivates the previous active link. Create and deactivate run in one transaction that first locks the trip row (`SELECT … FOR UPDATE`, same lock as trip writes), and a partial unique index `unique (trip_id) where active` enforces at most one active link per trip; a residual unique violation maps to HTTP 409.
- Interest is an activity/date response: the vote identity is `(item_id, day_date, voter_hash)`, and edit/withdraw look up by all three. When the owner moves an activity to another date, existing votes stay attached to the old date (they were cast for that date) and the visitor can vote again for the new date. Owner counts are `count(*) group by item_id, day_date`; counts whose `(item_id, day_date)` no longer matches the current version are shown in a separate "日期已變更的舊回應" group rather than silently merged.
- No endpoint returns nicknames or voter hashes to the owner (FR-22, DATA_AND_PRIVACY).

### 4.4 Trip document and domain logic

- `src/domain/schema.ts`: a Zod schema that matches the shape of `window.TRIP_DATA` in `site/js/data.js` (`meta`, `segments`, `drivers`, `stays`, `alertsSources`, `days[]` with `items[]` and `costs[]`), plus owner-mutable fields the prototype keeps in `localStorage` (`partySize`, per-day driver confirmation). Driver confirmation is stored as `day.driverConfirmation = { driver, window }` (not a bare boolean). The schema requires `driver` to be a key of `drivers` and `window` to be a non-empty time range `HH:MM–HH:MM` (start before end, ASCII hyphen also accepted); a confirmation with a missing or empty window is rejected with 400 on save and import (FR-10 needs driver, date, and time). the day counts as confirmed (`driverOk` in the ported rules) only when `driverConfirmation.driver` equals the effective `needsDriver`. If the effective requirement changes or disappears (package attached or detached, item moved, owner edit), a stale confirmation no longer counts, and the UI shows it as "確認對象已變更" until the owner confirms again or clears it. Items may carry an optional item-level `needsDriver` (section 4.9). The schema also requires item ids to be unique across all scheduled days and all attraction-pool packages (`superRefine`), because votes and journey stops are keyed by item id. Every write and import is validated against it; invalid input returns HTTP 400 with the field path.
- `src/domain/effective-day.ts`: `effectiveDay(day)` returns the day with attached package contributions applied (section 4.9). The budget, rules, feasibility, map, and journey code operate on effective days. For a day without attachments `effectiveDay(day)` equals `day`, so legacy parity (AC3) is unaffected.
- `src/domain/budget.ts`, `rules.ts`, `feasibility.ts`: TypeScript ports of `lineAmount`, `basis`, `budgetLines`, `dayTotal`, `checks`, `feasibility`, `isTentative` from `site/js/app.js` (lines 98–146), keeping the same behaviour (including unknown-cost exclusion, shared-cost split by `max(participants, N)`, UTAS AUD $0 nights, food per person per day per segment).
- `src/domain/privacy.ts`: `toPublicDoc(doc)` used by every public endpoint. It removes every stay `address`, replaces driver names in `needsDriver` with `朋友`, removes `driverConfirmation` (driver and window), and removes `drivers` names/notes. It walks the whole document recursively, so every `needsDriver` value in any nested location (day, item, `packageContext`, `day.attached[]`, `attractionPool[]` packages) becomes `朋友`, and every `driverConfirmation` anywhere is removed. As a final guard, it serializes the result and throws (HTTP 500, nothing sent) if any `address` or `driverConfirmation` key remains anywhere, or if any key of `drivers` or any **non-empty** stay `address` value (after trimming) still occurs in it; empty address strings are ignored, so the seeded stays with `address: ""` do not trip the guard. New fields therefore fail closed. This runs on the server; the full document is never sent to visitors (FR-28; the prototype only hid it in the browser).

### 4.5 Owner features in this build

Parity with prototype plus server persistence:
- View itinerary, overview, day detail, maps, budget, information/alerts tabs.
- Change activity priority (Must-do / Preferred / Replaceable), mark activity verified, confirm a driver for a day with a time window, change party size, change the participant count of a day-level shared cost (`days[].costs[].participants`, as in `site/js/app.js` day detail). Each change creates a new version with a summary (FR-05, FR-07, FR-10, FR-15).
- Edit an activity's basic fields (time, duration, name, note, transport mode, cost amount/unit/status) and add or remove an activity. Removing a Must-do activity requires an explicit confirmation dialog that names the activity (FR-04).
- Attraction pool: view unscheduled packages with their suggestion, schedule a package or a single item onto a date, move a scheduled item back to the pool (section 4.9).
- Version list with timestamps and summaries; restore creates a new version (FR-07).
- Export current document as JSON (backup); import a JSON document (validated, creates a new version with summary "匯入"). This is how corrected dates are loaded (A1).
- Share management: create link, copy link, deactivate link, see aggregate interest counts (FR-21–23).
- Delete trip: requires typing the trip title; deletes the trip, versions, share links, votes, and trip-scoped rate-limit rows (FR-27). The UI states that already-downloaded offline copies and screenshots are not recalled.

### 4.6 Visitor features

- `/s/[token]`: view-only itinerary built from `toPublicDoc`. No edit controls are rendered and the public API has no write path for the itinerary (FR-21).
- "我有興趣" per activity with optional nickname; edit or withdraw own response using the browser's voter key (FR-22).
- Server-side validation of public interest requests: request body ≤ 2 KB; `voterKey` must be a UUID; nickname is trimmed and limited to 20 characters (longer is rejected with 400); a **new** vote must name an `(item_id, day_date)` pair that is scheduled in the current version (pool items and unknown ids are rejected with 400); an **edit or withdraw** must match an existing vote of that voter (otherwise 404).
- Rate limit: max 30 interest writes per voter hash per hour and 300 per share link per hour. Quota is reserved atomically: in the vote transaction, each key is incremented with `INSERT … ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1 RETURNING count`, and the vote is accepted only if both returned counts are within their limits (otherwise the transaction rolls back, so rejected requests do not consume quota); over the limit returns HTTP 429 with a Chinese message, and the UI shows it (NFR-04).

### 4.7 AI (phase B, decision only)

Recorded in the ADR, not implemented: a server-only module `src/server/ai/` calls the Claude API with `ANTHROPIC_API_KEY` (Vercel environment variable, never exposed to the client), owner-only, with a daily request cap stored in `rate_limits`. AI output is stored as a proposal document validated by the same Zod schema and applied only through the owner's selection, as a new version (FR-03, FR-29). No AI code, key, or UI is added in this build.

### 4.8 Offline and freshness (FR-24, FR-25, NFR-03)

- The service worker precaches the app shell and static assets on install; it uses network-first for page navigations and the trip JSON endpoints, falling back to cache when offline.
- The client stores in IndexedDB, separately for the owner and for each share token: the last successfully fetched trip document, `lastSyncAt` (ISO time), and the last-known alert status (the per-day rule warnings and feasibility labels computed at sync time, plus `alertsSources` with their official links). For the owner it also stores the version list metadata for all versions plus the documents of the 20 most recent versions and of version 1, so those can be opened read-only offline (FR-24); older documents show "需要連線才能開啟" offline. Restore needs a connection.
- Every page shows "最後同步：<time>" in the footer. When the page renders from the local copy (network failure), it shows a visible banner "離線副本，可能不是最新資料". The prototype's "標記已查核" and source labels remain visible offline.
- Owner edits require a network connection in this build. When offline, edit controls are disabled with an explanation (no offline write queue).

### 4.9 Seed itinerary for the new dates and the attraction pool

`web/scripts/seed-2026-11.ts` exports a pure function `buildSeed(legacyDoc) → doc`; `npm run db:seed` stores its result as **version 1** (summary "初始行程：雪梨 11/3–11/6、塔斯馬尼亞 11/6–11/27"). No day before 2026-11-03 exists in the result, and the legacy 10/25–11/02 schedule is not stored as a version (D8).

Scheduled days (legacy days from 11/03 keep their date, content, stay, and driver):

| Date (weekday) | Content |
|---|---|
| 11/03 (Tue) | legacy 11/03 Sydney day (a26, a27 unchanged). a25 becomes `name` "飛抵雪梨", `en` "Arrival at Sydney Airport", `mode` flight, Sydney Airport coordinates (-33.9399, 151.1753), `src` Sydney Airport (https://www.sydneyairport.com.au/), `travel` {} (unknown), `cost` {cat transport, amount 0, unit pp, status unknown, note "出發地與機票費用待填"}, `note` "出發地、航班與時間待填", `verify` unverified. The HBA→SYD source, durations, and AUD 160 estimate are removed because the origin is unknown. |
| 11/04 – 11/05 | legacy days unchanged |
| 11/06 (Fri) | legacy 11/06 (a33, a34) + a02 "機場前往 UTAS 公寓入住" at 18:30 (first UTAS check-in); title "飛往荷巴特・入住" |
| 11/07 – 11/24 | legacy days unchanged (including open days 11/12, 11/13, 11/19, 11/20, 11/23, 11/24 and Farm Gate Market a56 on Sunday 11/22) |
| 11/25 (Wed) | open day "自由日（待規劃）" |
| 11/26 (Thu) | legacy 11/25 packing day content (open) |
| 11/27 (Fri) | legacy 11/26 departure content (a57), `stay = none` |

`meta.start = 2026-11-03`, `meta.end = 2026-11-27`; segment ranges "11/3–11/6" (Sydney) and "11/6–11/27" (Tasmania).

Attraction pool (`attractionPool[]` in the trip document, validated by the Zod schema): unscheduled **packages** that keep the legacy day context, with every item's full information (id, name, en, coordinates, priority, major flag, mode, travel legs, source, verify, note, cost). Package shape: `{ key, title, seg, items[], costs[], needsDriver?, driveHrs, alt?, ferry?, hike?, transfer?, suggestion?: { date, reason } }`; every seeded package has `seg = "tas"`. Each pool item records `originPackage = key`. Seeded packages from legacy 10/25–11/02 (items a03–a24; a01 is the old arrival flight and is dropped, a02 is used on 11/06):

| key | Legacy day | Items | Suggestion (not scheduled) |
|---|---|---|---|
| waterfront | 10/25 evening | a03 | 11/07 (Sat) evening |
| kunanyi | 10/26 | a04–a06 + shared fuel/parking cost, alt, needsDriver Zayden | 11/23 (Mon, Zayden weekday) |
| richmond | 10/27 | a07–a09 + cost, alt, needsDriver Zayden | 11/24 (Tue, Zayden weekday) |
| mtfield | 10/28 | a10–a12 + cost, alt, needsDriver Zayden, hike | 11/25 (Wed, Zayden weekday) |
| citywalk | 10/29 | a13, a14 | 11/12 (Thu) |
| mona | 10/30 | a15, a16, ferry | 11/13 (Fri) |
| portarthur | 10/31 | a17–a19 + cost, alt, needsDriver JJ | no free JJ weekend; replaces a weekend day only if the owner chooses |
| bruny | 11/01 | a20–a23 + cost, alt, needsDriver JJ, ferry | no free JJ weekend; same |
| northhobart | 11/02 | a24 | 11/20 (Fri) |

Owner actions on the pool (each creates a version):
- **Eligible dates:** a package or item can be scheduled only onto a day whose `seg` equals the package's `seg`. The UI offers only those dates; the API rejects any other date with HTTP 400. Day `seg` is never changed by scheduling.
- **Schedule a whole package:** its items are appended to the day (each keeps `originPackage`), and the package's day-level data (`costs`, `needsDriver`, `driveHrs`, `alt`, `ferry`, `hike`, `transfer`) is stored as an attachment record `day.attached[] = { key, costs, needsDriver, driveHrs, alt, flags }`. Day fields that the owner edits directly are never overwritten. `effectiveDay` adds attached costs to `day.costs`, adds attached `driveHrs`, ORs the flags, joins `alt` texts, and uses the attached `needsDriver` when the day has none. If the day already has an effective `needsDriver` different from the package's, the API rejects with HTTP 400 ("此日已依賴 X 開車") and the owner picks another date.
- **Schedule a single item:** the item moves (keeping `originPackage`) and carries the package's complete non-cost context as `packageContext = { key, needsDriver, driveHrs, alt, ferry, hike, transfer }`. In other words, a single item gets exactly what a whole-package attachment gives except the package `costs` (shared costs are only meaningful for the whole package; the UI says they are not applied). `effectiveDay` merges the contexts of attachments and single items with one rule, deduplicated by package `key`: each package's `driveHrs` is added once per day, each `alt` is listed once, flags are ORed, and the effective `needsDriver` comes from, in order, the day field, then attachment/item contexts; two different required drivers on one day are rejected with HTTP 400. An item whose package context has `needsDriver` is tentative while the day is unconfirmed, whatever its own `mode` (for example a11 Russell Falls is `walk` but is only reachable by the package's drive), so FR-10, FR-11, and FR-12 rules see the same day as they would for the whole package. Moving the item back removes its context. The remaining package stays in the pool.
- **Move an item back:** the item returns to its `originPackage` in the pool (the package is recreated from the attachment record if it is no longer in the pool). When the last item of an attached package leaves a day, that day's attachment record is removed and its data returns to the pool package; unrelated day fields are untouched. Pool items are not counted in trip totals; the pool view shows each package's estimated cost for the current party size using the same budget functions. Visitors see the pool read-only (privacy filter applies: no driver names).

### 4.10 Accessibility, responsiveness, visual parity

Port the prototype's CSS (`site/css/styles.css`) as a global stylesheet first so that the look matches; keep skip link, visible focus, `prefers-reduced-motion`, dark mode, `lang="zh-Hant"`, and the text route alternative to the map. Leaflet is loaded only on the client (dynamic import, `ssr: false`); if it fails, the text route list remains (NFR-01, NFR-06).

### 4.11 3D journey landing page (port of `site/landing.html`)

`site/landing.html` (commit 8f06712) is a scroll-driven landing page: loader, Three.js r128 procedural terrain/sea/aurora sky from cdnjs, SVG foreground parallax, a chapter rail, and 6 chapters (序章, Hobart, East Coast, Wilderness, Sydney, Afterlight) whose stop lists and stats are filled from `TRIP_DATA`. It is linked from the prototype hero ("進入 3D 旅程首頁").

Port into the Next.js app:
- Routes: owner `/journey` (reads the owner trip doc) and visitor `/s/[token]/journey` (reads `toPublicDoc`). The itinerary hero links to it, as in the prototype. The landing's final button links back to the matching itinerary page.
- Three.js comes from the npm `three` package (exact version pinned in the lockfile) inside a client component loaded with `next/dynamic` and `ssr: false`; no CDN script. The scene code is ported from `site/landing.html`.
- Chapter order follows the trip chronology: 序章 → Sydney (雪梨, 11/3–11/6) → Hobart → East Coast → Wilderness → Afterlight. The rail labels follow the same order. For the seeded version, every non-empty chapter's latest stop date is on or before the next non-empty chapter's earliest stop date. Chapters are narrative groups: if the owner later schedules pool items (for example kunanyi on 11/23), stops stay within their chapter, sorted by date, and chronology across chapters is not enforced.
- Stops come from **item ids**, not activity names. Chapter membership is data in the trip document: an optional `journey.chapters[]` array in the Zod schema (`{ key, title, itemIds[] }`), seeded with: sydney `a27,a28,a29,a31`; hobart `a04,a35,a37,a16,a18,a22` (a37 Tahune, 11/08, moved here from wild so chapters stay chronological); coast `a39,a41,a43,a47`; wild `a11,a51,a52`. Each stop's date is the date of the scheduled day that contains the item in the current version; items that are only in the attraction pool or missing are skipped. Stops are listed in date order.
- No stale numbers: the hero lead text, the day count, the destination count, the must-do count, and the major-activity count are computed from the current doc (for the seeded version: 25 days, Sydney first). All route-dependent copy is rewritten for Sydney-first travel: the hero lead, the Sydney chapter (no "Interlude", "插曲", or "十一月初飛去雪梨"; it is the start of the trip), and the Hobart chapter (arrival from Sydney on 11/06). The phrases "三十三天" and "從荷巴特…中途繞去雪梨" are not reused.
- Fallbacks: with `prefers-reduced-motion: reduce`, or if WebGL is unavailable or Three.js fails to load, the page shows the static gradient/SVG background and all chapter text and stops remain readable (NFR-01, NFR-06). The loader never blocks content longer than the prototype's 1.5 s after load.
- Offline: the service worker caches the journey route and its JS chunk like other pages.

## 5. Non-goals for this build

- AI generation, comparison, and AI-driven recheck (phase B).
- Live data feeds (alerts, schedules, prices). Information stays labelled as estimates/links (NFR-05).
- Offline editing and sync queues.
- Multiple trips or multiple owners in the UI.
- Choosing placements for the owner: the build provides the scheduling actions, but the seed schedules nothing from the pool; suggestions in section 4.9 are hints only (D8).
- Creating the Vercel project, Neon database, GitHub OAuth app, or any account. These are manual owner steps documented in `docs/DEPLOY.md`.
- Removing the `site/` prototype.

## 6. Acceptance criteria

AC1. `docs/adr/0001-first-version-architecture.md` records D1–D6, A2, A4, A5, A8 with trade-offs, and `docs/DECISIONS.md` moves architecture/framework/database/hosting/AI provider from "Explicitly undecided" to decided with a link to the ADR. `README.md` guardrail text is updated accordingly. `docs/DECISIONS.md` and `docs/PRODUCT_BRIEF.md` replace the 25 October–26 November dates with Sydney 3–6 November then Tasmania 6–27 November 2026 and record D8 (old 10/25–11/02 schedule removed, attractions kept as an unscheduled pool).
AC2. In `web/`, `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` all exit 0.
AC3. Legacy parity: for the trip in `site/js/data.js`, the TypeScript budget functions produce, for party sizes 1, 2, 3, 4, 6, the same whole-trip total, the same per-day totals, and the same per-category totals as the legacy functions extracted from `site/js/app.js`; `checks` produce the same level/text lists and `feasibility` the same label for every day (with no confirmation and with `driverConfirmation.driver` equal to the day's `needsDriver`, which the parity harness maps to legacy `driverOk` false/true). Driven by a test that executes the legacy code, not hand-copied numbers.
AC4. Versioning: an integration test (PGlite) shows that save creates version n+1, restore of version k creates a new version with `restored_from = k` and identical doc, the original version 1 stays, and a write with a stale `baseVersionNo` returns 409 and creates no version. Two writes started concurrently with the same `baseVersionNo` (`Promise.all`) yield exactly one success and one 409, and exactly one new version.
AC5. Auth: page-level tests show that `/`, `/journey`, and every other owner page redirect to sign-in without a session and render the 403 page for a non-owner session, with the owner-document loader never called (spy) in both cases. Integration tests show every owner API route returns 401 without a session, 403 for a session whose GitHub id is not in `OWNER_GITHUB_IDS`, and 403 for a mutation with a foreign `Origin`. The next-auth `signIn` callback rejects non-owner GitHub ids.
AC6. Sharing privacy: the privacy guard does not throw for stays whose `address` is empty, and does throw for a doc that still contains a non-empty address or a driver name. The public endpoint response contains none of the items below, checked for the seeded trip and again after the owner (a) schedules a single driver-dependent item (a11), (b) attaches a whole driver package (`kunanyi`), and (c) confirms a driver with a window; the journey endpoint is checked the same way. Forbidden content: any stay `address` value, the strings `Zayden` and `JJ`, any `driverConfirmation.window` value. A deactivated or unknown token returns 404 with no trip fields. Creating a new link deactivates the old one.
AC7. Interest: visitor A and visitor B (different voter keys) on the same item give count 2; A withdrawing gives 1; A voting twice keeps 1; a vote for a pool item, an unknown item id, or an item on the wrong date returns 400; a 21-character nickname returns 400; withdrawing a vote that does not exist returns 404; after the owner moves the item to another date, A can vote for the new date, the old-date vote is reported in the "日期已變更" group, and A can still withdraw the old-date vote; the owner endpoint returns counts without nicknames or hashes; exceeding the rate limit returns 429; a concurrent burst (`Promise.all`) of 40 writes from one voter accepts exactly 30, and a burst that crosses the per-link limit accepts exactly up to 300 (test may lower limits through configuration). Share links: two concurrent create requests leave exactly one active link.
AC8. Validation: import or save of a document that fails the schema returns 400 and creates no version.
AC9. Delete: after delete, trip, versions, share links, votes, and rate-limit rows for that trip are gone (row counts 0) and the public link returns 404.
AC10. Offline: a unit test of the offline store round-trips doc, `lastSyncAt`, last-known alert status, and the owner version list, and keeps documents only for the 20 most recent versions plus version 1; a manual check (section 7) confirms that after one online load, reloading with the network disabled shows the itinerary, budget, the version list with readable saved versions (owner), the information/alert tab with last-known status, the last-sync time, and the offline banner.
AC11. UI parity (manual, section 7): overview, day detail with transport legs, warnings and tentative labels, budget with party-size recalculation, information tab, map with text fallback, version list, share management, visitor view with interest buttons — all reachable on a 375 px wide viewport and on desktop, with no edit controls in the visitor view.
AC12. No hard-coded trip dates in UI code: `grep -rnE "10/25|11/26|11/27|11/3|11/6" web/src` returns no matches outside tests (seed code lives in `web/scripts`).
AC14. Seed (unit test on `buildSeed(legacyDoc)`): dates are contiguous 2026-11-03 … 2026-11-27 (25 days) with no duplicates and no date before 2026-11-03; every legacy item id from a25 onward appears exactly once among scheduled days; a03–a24 each appear exactly once in `attractionPool` with name, coordinates, source, cost, and note equal to the legacy values; a01 appears nowhere; a02 is on 11/06; days with `needsDriver = X` fall on a weekday in `drivers[X].weekdays`; 11/06–11/26 stays are `utas` except the legacy `coles`/`lst`/`cradle` nights; 11/27 has `stay = none`; the result validates against the Zod schema. Driver tests: scheduling a11 (mode `walk`) alone onto a day without a driver makes the day's effective `needsDriver` Zayden, shows the driver warning, marks a11 tentative, adds the Mount Field package's 2.5 h drive to the day's effective `driveHrs`, and shows the package's no-driver alternative; scheduling a11 and a12 alone onto the same day adds the 2.5 h only once; scheduling a12 (major, from the `hike` package) alone onto a day that already has three other major activities produces the heavy-day warning; scheduling a04 alone onto a day without a driver makes the day's effective `needsDriver` Zayden, shows the driver warning, and marks a04 tentative; after confirming Zayden for kunanyi on a day, moving all kunanyi items back, and scheduling `portarthur` (JJ) there, the day is unconfirmed and drive items are tentative. Schema tests: a `driverConfirmation` with an empty or malformed `window` is rejected with 400 on import and save; a document with a duplicate item id (two items on one day, or one scheduled and one in the pool) is rejected with 400 on import and save. Pool integration tests: scheduling `kunanyi` onto a Sydney date returns 400; scheduling `portarthur` (JJ) onto a day with effective `needsDriver` Zayden returns 400; scheduling a single item attaches no package costs; moving all items of an attached package back removes the attachment and restores the day's budget total and warnings to their pre-schedule values while keeping an unrelated owner edit made in between. An integration test schedules package `kunanyi` onto 11/23 and shows a new version where the items are on 11/23, gone from the pool, and the day's budget total increased by the package estimate; moving an item back restores it to the pool.

AC15. Journey page (section 4.11): for the seeded version the chapter order is 序章, 雪梨, 荷巴特, 東海岸, 荒野, 南極光; every stop's date equals the date of the scheduled day containing that item id; for consecutive non-empty chapters, the latest stop date of one is not after the earliest stop date of the next; stats show 25 days; `grep -rnE "三十三|Interlude|插曲|十一月初飛去雪梨|中途繞去雪梨" web/src` returns nothing; with WebGL disabled or reduced motion the chapter text and stops render. Unit test on the stop/stat/chronology derivation plus manual check.

AC13. Secrets: no secret values are committed; `web/.env.example` lists every required variable with empty values; `.env*` files other than `.env.example` are git-ignored.

## 7. Verification

Proof commands (run by the host from `web/`):

```
npm ci
npm run lint
npm run typecheck
npm test            # vitest: unit + PGlite integration + legacy parity
npm run build       # next build with dummy env from .env.example-style values set by the test script, no network DB
```

Expected: all exit 0; `npm test` reports the AC3–AC9 test files passing.

Legacy parity method (AC3): `tests/legacy-parity.test.ts` reads `site/js/data.js` and `site/js/app.js` from the repo, extracts the code between the markers `/* ---------- rules` and `/* ---------- header ----------` (which contains `checks`, `feasibility`, `isTentative`, `lineAmount`, `basis`, `budgetLines`, `dayTotal`), evaluates it in a `node:vm` context with `DATA = TRIP_DATA`, `S = { days, partySize }`, `SHARE = false`, and stub `esc`/`driverLabel`/`stayOf` copied from `app.js` helpers, then compares outputs with the TypeScript port on the same inputs. If the markers move, the test fails loudly rather than skipping.

Manual checks (host, local `npm run dev` with PGlite and a test owner session, and on the Vercel preview after the owner completes `docs/DEPLOY.md`):
1. 375 px and desktop: walk through AC11 views.
2. Offline: load owner page and a share page, then set the browser offline and reload: itinerary visible, footer last-sync time, offline banner.
3. Map blocked (block tile domain): text route list still usable.
4. Visitor link in a private window: no address, no driver names, interest submit/edit/withdraw works; owner sees counts.

Local dev auth for manual checks: a development-only credentials bypass is **not** added. Instead, integration tests call route handlers with a mocked `getServerSession`; manual owner checks happen on the Vercel preview with real GitHub login after setup. Local manual checks cover the visitor view and read-only owner rendering with a seeded DB.

## 8. Toolchain

- Host/builder (Claude Code): Node.js v26.10.0, npm 12.2.0 on macOS (checked). No Docker or Postgres needed (PGlite).
- Inspector (Codex): reads the repository; does not need to run commands.
- Owner (manual, `docs/DEPLOY.md`): GitHub OAuth App (callback `https://<vercel-domain>/api/auth/callback/github`), Vercel project with Root Directory `web`, Neon via Vercel Marketplace, environment variables `DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `GITHUB_ID`, `GITHUB_SECRET`, `OWNER_GITHUB_IDS=32431832`, `VOTER_HASH_SALT`; then `npm run db:migrate` and `npm run db:seed` once against Neon (documented commands).

## 9. Risks

- R1 Schedule: about 12 days to departure. Mitigation: phase B (AI) excluded; owner editing limited to listed operations; JSON import covers bulk data fixes.
- R2 next-auth v4 on Next 16 App Router: peer range includes Next 16; covered by `npm run build` and AC5. Fallback: Auth.js v5 beta, isolated in `src/server/auth.ts`.
- R3 Vercel Hobby is non-commercial only; fine for private testing, must upgrade before commercial use.
- R4 OSM tile usage policy forbids heavy use; private testing volume is low. Revisit for public launch.
- R5 Share links reveal travel dates and activity patterns even with addresses hidden (DATA_AND_PRIVACY); the share management UI states this before creating a link.
- R6 Offline copies cannot be recalled after deletion (stated in UI).
- R7 Service worker caching can show stale UI after deploy; the SW uses a versioned cache name tied to the build id and network-first for navigations.
