# Plan 2026-10-26d: galleries, carriage ride, 跨日行程方案, link-icon credits

## Request (Kai, 2026-10-26)

1. Add the Salamanca horse carriage ride.
2. Rename 推薦行程方案 to 「跨日行程方案」 and remove its filters.
3. Give every attraction at least 5 photos, shown in React Bits FlexCarousel.
4. Use Kai's six Hunter Valley balloon photos.
5. Show photo credits as a link icon instead of the long site name.

Builder: Claude. Plan review and inspection: Codex.

## Facts (checked 2026-10-26)

- **Salamanca Jaunts** (Heritage Horse Drawn Carriages, rezdy product 320168):
  - Price: **AU$60 per tour group, 2-adult minimum.** For Kai and Aya that is AU$60 in total, not per person.
  - Other prices: AU$70 for 2 adults + 1 child, AU$30 per extra adult.
  - Duration: about 15–20 minutes.
  - Departures: every 20 minutes, 12:00–17:00, on the sample date shown.
  - The route passes Parliament House, Franklin Wharf and Constitution Dock. The page mentions the Saturday Salamanca Market.
- **Balloon:** activity b01 is Balloon Aloft 「Hunter Valley Flexi Ticket with Return Transfer from Sydney」, so it really is the Hunter Valley flight and matches Kai's photos.
- **FlexCarousel** (reactbits.dev/r/FlexCarousel-JS-CSS.json):
  - It ships as `FlexCarousel.jsx` + `.css` and depends on `ogl@^1.0.11` (WebGL).
  - Textures load with `crossOrigin = "anonymous"`, so image hosts must send CORS headers. That works for: Wikimedia (`upload.wikimedia.org`), Google photo URIs, and same-origin files.
  - Many tourism-site og images do not send CORS headers, so they show the component's grey fallback card.
  - The component reads its items on mount, so the page remounts it (`key`) when the list changes.
  - React Bits licence: MIT + Commons Clause, which allows use in this private site. The registry needs no Tailwind, so the files are copied from the registry JSON (no shadcn setup).

## Build

1. **Carriage ride** (data write: back up first, then save a new version):
   - Add pool item `salamanca-jaunts` to a new package 「Salamanca 可選體驗」 (seg `tas`).
   - Details: category `activity`, status `pending`, time 15:20 (after the market, which closes at 15:00), duration 20 min, mode `walk`, coordinates of Salamanca Place.
   - Cost `{ cat: tickets, unit: group, amount: 60, status: quote, note: 「每團價（最少 2 位成人）」 }`.
   - Link `src` to the rezdy page.
   - Suggestion: 11/7 (Saturday market day), after the market. It is not scheduled automatically.
2. **跨日行程方案:**
   - The tab label and heading are renamed.
   - The filters and their URL parameters are removed, and the reel shows every plan.
3. **Gallery:**
   - `src/components/flex-carousel/FlexCarousel.jsx` + `.css` are copied verbatim from the registry, with a header comment on source and licence. ESLint ignores the folder.
   - `PlaceGallery` wraps it with Kai's configuration (`preset="liquid" intro="rise" cardHeight={0.5} gap={12} squeeze={0.2} focusOnClick captions`).
   - Height is 560px on desktop and 360px at 720px or less.
   - It mounts only when opened (a `<details>`), to limit WebGL contexts.
   - Each photo is credited under the carousel with link icons.
   - **Photo list for an activity:**
     1. its own `photo`;
     2. `gallery` photos (new optional item field, at most 12, owner-supplied);
     3. cached Wikimedia Commons photos near the activity (geosearch within 400 m, image files of at least 800 px, licence and artist recorded), stored once per activity in `lookup_cache` (`commons-photos`) by `scripts/photos-backfill.ts`;
     4. for the owner only, live Google Places photos (up to 6) from `/api/place-photos?item=`.
   - Photos stay limited to owner and share-link viewers. `/api/photos?item=&token=` returns cached Commons lists only to the owner or a valid share token. It never calls out.
   - **Where it appears:** the activity 「更多資訊」 panel in 每日行程, the pool place card on the map, and the 跨日行程方案 detail (one carousel with each stop's photos).
4. **Balloon photos:**
   - From branch `assets/hunter-valley-balloon`, images 01, 04, 05 and 06 are resized to 1600px webp in `web/public/places/balloon-aloft/`.
   - They go into `b01.gallery`, credited 「Kai 提供」, with 06 as the cover: it becomes `b01.photo`, and the old Commons photo moves into the gallery.
   - **02 and 03 are not published.** They show strangers' faces and an agency banner.
   - The branch is deleted after merging.
5. **Credits:**
   - `PhotoCredit` becomes an icon link: 44px hit area, `aria-label="圖片來源：<site>"`, and `title` = site.
   - Google photos keep the author names as text (required), plus an icon link to Google Maps.
6. **Google photos for share links:** not enabled. The cost estimate is reported only:
   - Aya browsing 60 places × (1 details + 5 photos) = 60 Place Details + 300 Photos calls.
   - Free monthly calls: 10,000 Place Details and 1,000 Photos.
   - So one full browse costs US$0 within the free tier. Beyond it, the list price is US$0.30 + US$2.10 = **US$2.40 per full browse**.

## Acceptance

- The carriage ride is in the pool and the budget is unchanged until it is scheduled.
- The tab reads 跨日行程方案, with no filters.
- Galleries open with at least 1 photo and show credits as icons. Reduced motion makes the intro a fade (the component handles it). Keyboard focus works (the component region has tabIndex 0).
- Coverage report: the number of activities with 5+ photos for share-link viewers (non-Google) and for the owner (with Google).
- Tests:
  - the Commons parser;
  - the photo-list assembly order and de-duplication;
  - `/api/photos` auth (owner and token, anonymous gets 401);
  - the schema `gallery` field;
  - the carriage seed cost basis.
- tsc, lint, test and build all pass.

## Revision 1: plan review dispositions

- **RIDE-01, accepted.** The ride time is 15:20, after the market closes at 15:00. Departures run every 20 minutes until 17:00.
- **GALLERY-01, already met.**
  - `PlaceGallery` is just a 「看照片」 button; the WebGL carousel mounts only after it is pressed and unmounts when the gallery is closed.
  - The `<details>` content holds only the button.
- **GOOGLE-01, accepted.**
  - The Google backfill now maps every activity with a position, including those that already have a photo.
  - Each mapping is checked against the activity's name and position.
- **PRIVACY-01, accepted.**
  - Kai's photos live in `web/media/` (not `public/`).
  - They are served by `/api/media/[...path]` only to the owner session or with a valid share token. The share page adds its token to those URLs (`withMediaToken`).
  - The path is restricted to `[a-z0-9/_-]` plus an image extension under `web/media`.
- **COVERAGE-01, partly accepted.**
  - Five legitimately sourced photos cannot be guaranteed for every place: Commons coverage is uneven, and Google photos are owner-only for now.
  - The release reports every activity under 5, separately for share links and for the owner. The way to close the gap for share links (allowing Google photos there) is put to Kai with its cost.
- **CACHE-01, accepted.** Commons entries store name, lat and lng. A changed activity reads as missing, and the backfill searches it again.
- **WEBGL-01, accepted.** Without WebGL2 the gallery shows a plain scrolling strip, with the same credits.

## Inspection 1: dispositions

- **GOOGLE-01, accepted.**
  - `client/photos.ts` shares one Google request per activity (Place Details + up to 6 photos = 7 calls) between the small photo and the gallery.
  - The cap of 400 is kept: about 57 activities' galleries per day.
- **GALLERY-01, partly accepted.**
  - The plan-wide carousel now includes each stop's cached Commons photos (up to 3 per stop).
  - Live Google photos stay in each stop's own gallery, so opening a plan does not cost about 7 Google calls per stop.
- **CACHE-01, accepted.** The client cache key and effect dependencies include the name and position.
- **COVERAGE-01, accepted.** The report counts unique photos using the gallery's own assembly. The owner number is labelled as an upper bound, and Google is counted only when a key is configured.
