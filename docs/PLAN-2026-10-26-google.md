# Plan 2026-10-26c: Google Routes and Places photos, with a usage log

Kai wants his Google API key used for:
- (A) driving routes, stored in the backend and never recomputed on each view;
- (B) attraction photos;
- daily usage reports.

There is no Google base map.

## Key handling

- The key comes from `GOOGLE_MAPS_API_KEY` (alias `GOOGLE_PLACES_API_KEY`), in `web/.env.local` and in Vercel Production.
- It is read only in `src/server/google.ts`.
- It is sent only in the `X-Goog-Api-Key` header. It is never in a URL, a response, a `NEXT_PUBLIC_*` variable or a log.
- `/api/google/status` (owner only) reports `keyPresent` as a boolean.

## Terms that shape the design (checked 2026-10-26)

- **Places policies:** place IDs may be stored indefinitely. Other Places content must not be cached.
- **Place Photos page:** "You cannot cache a photo name." Wherever a photo is shown, its `authorAttributions` must be shown too, and the user must be able to open it on Google Maps.
- **Directions/Routes:** coordinates may be cached for up to 30 days. Google route rows in `route_cache` count as missing after 30 days.
- **Pricing** (developers.google.com/maps/billing-and-pricing/pricing, list price per 1,000 calls / free calls per month):

  | SKU | Price per 1,000 | Free per month |
  |---|---|---|
  | Text Search Essentials (IDs only) | free | unlimited |
  | Place Details Essentials | $5 | 10,000 |
  | Place Details Photos | $7 | 1,000 |
  | Compute Routes Essentials | $5 | 10,000 |

## Behaviour

### Routes

- `getLegs` uses Google Routes `computeRoutes` when a key is set, and OSRM otherwise.
- Field mask: `routes.legs.distanceMeters,routes.legs.duration,routes.legs.polyline.encodedPolyline`.
- Polyline, distance and duration are stored in `route_cache` with `source = google-routes`.
- Page views (owner and guests) only read `route_cache` and record a "hit".
- Google is called only for missing legs, when the owner presses 「計算道路路線」 (`compute: true`) or during the backfill.
- `upgrade` (backfill only) replaces earlier OSRM rows with Google rows.

### Places

- **Backfill:** an IDs-only Text Search (field mask `places.id`) runs for activities that have coordinates and no photo of their own. Each `place_id` is stored in `lookup_cache` (`place-id`).
- **Photos:** `/api/place-photo?item=` (owner only) resolves a photo live:
  - Place Details with field mask `photos`, then the photo media with `skipHttpRedirect=true`.
  - It returns `photoUri`, the attributions and the photo's Google Maps link. Nothing is stored on the server; the browser keeps it for 30 minutes.
- **Guests:** they never trigger Google calls, so they see the existing og/Commons photos or the colour fallback.

### Usage guard and log

- Table `google_usage` (day in Australia/Hobart, api, calls, hits).
- Every billable call reserves one unit and is refused past `GOOGLE_DAILY_CAP` (default 200 per day). It fails closed.
- **Reporting:**
  - 資訊與警示 has an owner panel 「Google API 用量」: the last 14 days per API, cache hit rate, month-to-date estimated cost, and what is left today.
  - `/api/usage/daily?date=YYYY-MM-DD` is public and numbers only, for a scheduled report. It is rate limited (30 per 10 minutes per IP) and noindex.

### Backfill

- `scripts/google-backfill.ts`: a dry run prints counts and the estimated cost; `--write` calls Google within the cap.
- It is run by hand once the key is confirmed.

## Acceptance

1. Tests mock Google and cover:
   - the polyline decoder;
   - routes stored once, with no second call;
   - page views (guest and owner) make no Google call;
   - the OSRM-to-Google upgrade only on request;
   - IDs-only search cached;
   - photo attributions, with the key never in a URL or response;
   - the cap refuses calls;
   - the usage endpoint is numbers-only;
   - status reports the boolean only.
2. tsc, lint, tests and build pass.
3. After deploy:
   - the migration is applied;
   - the backfill stores Google legs;
   - the live map draws road geometry for scheduled driving days;
   - the usage endpoint answers.

## Inspection 1: dispositions (all accepted)

- **G-01.** `/api/routes` computes only when `compute: true` is sent, i.e. from the owner's 「計算道路路線」 button or the backfill. Owner page views are read-only. Covered by a test.
- **G-02.** The cap is enforced atomically: the `_total` row is upserted with `setWhere calls < cap`. A concurrency test is included.
- **G-03.** Expired Google rows are deleted when they are found.
- **G-04.** The client keeps photo answers for 25 minutes and does not keep failures.
- **G-05.**
  - The place-ID mapping stores the activity name.
  - A renamed activity is looked up again by the backfill.
  - The photo endpoint returns 404 until then.
- **G-06.** Protocol-relative attribution links are normalised to https.
- **G-07.** Owner pool items without a photo show the Google photo.

## Inspection 2: dispositions

- **GPR-01, accepted.** Route credits list every source drawn: Google, OSRM or both.
- **GPR-02, accepted.**
  - Mappings store the name and the position (rounded to 4 decimals).
  - The backfill also redoes mappings whose name or position no longer match. The photo handler checks both.
- **GPR-03, accepted.** Every photo has a Google Maps link, falling back to the place's `place_id` page.
- **GPR-04, accepted.** When the usage queries fail, both endpoints return 503 (`usageUnavailable`) instead of zeros.
- **GPR-05, rejected.** `next.config.ts` already sends `X-Robots-Tag: noindex, nofollow` for `/:path*`, API routes included.
- **Review budget.** The two-round inspection budget is used up. These fixes have no third inspection; they are covered by tests.
