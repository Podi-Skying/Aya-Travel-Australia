# Plan: Tasmania weather tab (天氣) — 2026-11-08

Kai: "/apple-design 幫我新增一個天氣頁面，要有塔州每個地區的天氣預報以及塔州地區地圖天氣圖示".
Phone first, pictures over text (Aya skips long text). Apple-design rules apply (instant press feedback,
interruptible critically damped springs, 1:1 drag with momentum projection, rubber-banding, translucent
controls with a reduced-transparency fallback, cross-fades for reduced motion). No dark mode (Kai 10-27).

## 1. Data (server)

- New `src/domain/tas-weather.ts` (pure):
  - `TAS_POINTS`: exactly 30 fixed public points (town/landmark level, no private places), each one point
    (a slash below is one point's display name, not two points), id → region:
    - 西北: `stanley` Stanley (-40.76,145.30), `burnie` Burnie／Table Cape (-41.00,145.80), `arthur` Arthur River
      (-41.05,144.66)
    - 西部: `strahan` Strahan (-42.15,145.33), `queenstown` Queenstown (-42.08,145.56)
    - 中部高地: `cradle` Cradle Mountain (-41.65,145.95), `stclair` Lake St Clair (-42.12,146.17), `miena` Great
      Lake／Miena (-41.99,146.73), `campbell` Campbell Town／Ross (-41.93,147.49)
    - 北部: `launceston` Launceston (-41.44,147.14), `tamar` Tamar Valley (-41.20,146.85), `devonport` Devonport
      (-41.18,146.36), `deloraine` Deloraine／Mole Creek (-41.55,146.40)
    - 東北: `bridport` Bridport (-41.00,147.39), `derby` Derby (-41.15,147.80), `sthelens` St Helens (-41.32,148.25),
      `bayoffires` Bay of Fires／The Gardens (-41.17,148.30), `blue` Little Blue Lake (-40.94,148.00),
      `benlomond` Ben Lomond (-41.53,147.66)
    - 東岸: `bicheno` Bicheno (-41.87,148.30), `freycinet` Freycinet／Coles Bay (-42.12,148.29), `swansea` Swansea
      (-42.12,148.07), `maria` Orford／Maria Island (-42.55,148.05)
    - 東南: `hobart` Hobart (-42.88,147.33), `richmond` Richmond (-42.73,147.44), `portarthur` Port Arthur
      (-43.15,147.85)
    - 南部: `mtfield` Mt Field (-42.68,146.70), `huon` Huon Valley (-43.16,146.93), `bruny` Bruny Island
      (-43.27,147.35), `cockle` Cockle Creek (-43.58,146.89)
    (3+2+4+4+6+4+3+4 = 30.)
  - `parseTasForecast(body, points)`: Open-Meteo multi-location response (array, one object per point, same
    order) → per point, per date: `code, tMax, tMin, pop, rain, gust, cloudDay (09–18 mean), sunrise, sunset,
    nightCloud, nightLow` (night = hourly samples whose Hobart civil time, converted from the Unix timestamp
    with `Intl` in Australia/Hobart, is 22:00–23:59 on that date or 00:00–02:59 on the next date. Daily row
    dates are derived from the daily Unix value plus the response's fixed `utc_offset_seconds` (that is how
    Open-Meteo encodes the local day boundary), never via `Intl`; sunrise/sunset and hourly instants are real
    instants and are converted with `Intl` in Australia/Hobart, so DST changes inside the 16 days are
    handled; at a DST change the window simply has 4 or 6 samples instead of 5). Night fields are null
    unless the window has ≥ 4 samples and the hourly data continues to 03:00 next date (a sample at that
    civil hour exists, so the window is not cut by the horizon; on the spring-forward night the 4 samples
    22, 23, 00, 01 count as complete) (so the last forecast date, whose window runs past the
    horizon, has none; the UI shows 「–」 and no score for it). Values rounded; dates with no code dropped;
    throws on wrong shape or length mismatch.
  - `skyScore(nightCloud, nightLow)` = 0.7·low + 0.3·total → band `clear` (<25), `some` (<55), `cloudy`.
  - `risks(day)`: `gust != null && gust ≥ 60` → wind; `tMin != null && tMin ≤ 1` → frost (missing values
    never raise a warning).
  - `kpWindow(kpRows, date)`: the max predicted Kp in the night window of that Hobart date (from the existing
    `server/sky.ts` NOAA rows), with its Hobart hour range; null when missing.
- New `src/server/tas-weather.ts`: one Open-Meteo request for all 30 points
  (`latitude=a,b,…&longitude=…&daily=weather_code,temperature_2m_max,temperature_2m_min,
  precipitation_probability_max,precipitation_sum,wind_gusts_10m_max,sunrise,sunset&hourly=cloud_cover,
  cloud_cover_low&timezone=Australia/Hobart&timeformat=unixtime&forecast_days=16&models=best_match`), via the existing
  its own cache flow on lookup_cache (not `cached()`, which would re-stamp a stale value as fresh):
  1. `getLookup("tas-weather","v1")`; fresh = age ≤ 60 min **and** its first daily date is today in Hobart
     (a forecast fetched before Hobart midnight is refreshed after it) → return it.
  2. In-process single flight: one shared promise per instance for steps 3–5.
  3. Lease: `insert (kind "tas-weather-lock", key "v1", value {token}) on conflict do update set … where
     expires_at is null or expires_at < now() or value->>'token' is null returning token` (a hand-written or
     malformed row can never block the lease); `scripts/cache.ts put` refuses the `tas-weather-lock` kind with a 60 s lease and a random token. No row returned → another
     instance holds it: return the previous value with its original `fetchedAt` and `stale: true` (no fetch);
     with no previous value at all, recheck the cache every 500 ms for up to 15 s (beyond the holder's 10 s
     fetch + write), then 503.
     Lease won → re-read the cache first; if it is now fresh (another holder just finished), release the lease
     (token-guarded delete) and return that value without fetching.
  4. Winner: fetch with `AbortSignal.timeout(10_000)`; parse; then one DB transaction: `select … from
     lookup_cache where kind = 'tas-weather-lock' and key = 'v1' and value->>'token' = token for update`;
     only if that row exists, upsert the cache row (TTL 60 min) and delete the lease row, then commit. A holder
     whose lease was lost writes nothing, so an older result can never overwrite a newer one. Fetch + write
     is bounded at ~12 s, well inside the 60 s lease.
  5. Fetch failure: token-guarded lease delete; return the previous value as `stale: true`, or 503 when none.
  Visitors never reach Open-Meteo directly; this feed costs one multi-location Open-Meteo request per
  `tas-weather` cache refresh site-wide (the existing per-day `/api/weather` flow is separate and
  unchanged).
- New `GET /api/weather/tas` (handler `getTasWeather`): public like `/api/weather`; returns
  `{ points, days: Record<pointId, TasDay[]>, kp, fetchedAt, stale, source, url }` with
  `cache-control: public, s-maxage=N, stale-while-revalidate=M`, where S = seconds to the next Hobart
  midnight, N = min(1800, S) and M = min(3600, max(0, S − N)), so N + M ≤ S and no edge copy (fresh or
  stale-while-revalidate) outlives the Hobart date it starts with; the
  client also drops any date before today (Hobart) from the strip. Kp reuses `getKpOutlook()`; a Kp
  failure gives `kp: []` (the line is hidden). The response holds no trip data at all (section 2 is
  computed in the browser), so edge caching can never serve an outdated trip location.
- Attribution: "天氣資料：Open-Meteo（CC BY 4.0）" link + 更新時間; BOM warnings link
  (https://www.bom.gov.au/tas/warnings/).

## 2. Where the trip is (computed in the browser from the document the viewer already has)

- `tripPoint(doc, day)` (pure, new, in tas-weather.ts; `dayPlace()` and `/api/weather` unchanged) uses only
  what the public document already shows, so it gives the same answer for owner, share links and the public
  home. It may read item names, item positions, `day.seg`, and stay **names** only (`isStayItem()` uses the
  names the public document also carries); it never reads stay positions, `nightStay()` or home status.
  Rule: candidates = the day's items with a position inside the Tasmania box (lat −43.8…−39.4, lng
  143.5…148.6; no other land in it but Tasmania and its Bass Strait islands), excluding logistics
  (`isLogistics`), stay notes and stay activities (`isStayItem()`, names starting 「住宿：」 or containing
  「住處」). Candidates exist → nearest point to the candidate farthest from Hobart, no distance threshold.
  No candidates → `"syd"` when `day.seg === "syd"`, else `hobart`. So a Sydney→Hobart day (seg "syd") with
  Tasmanian stops badges Tasmania, and one with only Sydney stops shows 「這天在雪梨」. Owner and public
  documents give the same result (owner-only home positions only ever sit on excluded or Hobart-area items;
  a parity test runs `tripPoint` on a document and on `toPublicDoc` of it for every day).
- The weather tab reads `doc` from `useTrip()`, so a new trip version re-renders the badge immediately (the
  mounted panel follows the context, no refetch needed).
- The selected date's point gets a small 「我們在這」 badge on its marker and region card. Sydney days: a
  one-line chip 「這天在雪梨」.

## 3. Page `src/components/TasWeather.tsx` (tab 天氣)

Top to bottom, phone first:
1. **Day strip** (sticky under the header, translucent material): horizontally draggable chips, one per
   forecast date (today … +15). Each chip: weekday + M/D, a tiny dot when it is a trip day in Tasmania.
   Pointer drag tracks 1:1 (pointer capture, grab offset kept), release projects with `project(v)` and snaps
   to the nearest chip with the shared critically damped `spring`; tap selects instantly (pressed state on
   pointer-down). Native horizontal scroll is the fallback (keyboard: arrow keys move the selection).
2. **Map** (Leaflet, OSM tiles as elsewhere, Tasmania bounds, no wheel-zoom trap): one `divIcon` per point:
   weather icon (existing `WxIcon` paths) + `max/min`. Collisions: each point has `tier` 1 or 2. Tier-1
   points (14, no two closer than 50 km — the closest pair is Hobart–Port Arthur at ~52 km; a unit test
   asserts the minimum: Stanley, Arthur River, Strahan, Cradle Mountain, Great Lake, Launceston, Devonport,
   Bridport, St Helens, Bicheno, Orford／Maria Island, Hobart, Port Arthur, Cockle Creek; Swansea is tier 2) show at the island-fit zoom; tier-2 points appear from zoom 8.3 (each region card still lists
   every point). Markers are 34 px wide (icon + 2-line temps). On top of the tiers, a screen-space declutter
   runs after every zoom/move end and day change: visible markers are projected with
   `map.latLngToContainerPoint`, sorted by priority (trip point > tier 1 > tier 2), and a marker whose box
   overlaps (centres < 38 px apart) an already placed higher-priority one is hidden. So the trip point always
   shows (e.g. Richmond hides Hobart at island-fit zoom, Hobart returns when zoomed in), and every point stays
   reachable by zooming or from its region card. Night mode: a round cloud badge, green/amber/grey by
   `skyScore`, label = low-cloud %. Gust/frost show a tiny icon. Marker press: pressed scale on pointer-down;
   tap opens a small Leaflet popup card: name, rain % and mm, gust, sunrise/sunset (day) or total/low cloud and
   Kp (night). Changing the day updates marker contents in place (no re-create), cross-fading icons
   (opacity, 150 ms; none under reduced motion).
   Floating over the map (translucent material, `backdrop-filter` with a solid fallback under
   `prefers-reduced-transparency`): a segmented control 白天／晚上・極光 (thumb slides with a spring from its
   current position; instant under reduced motion), and in night mode one line 「極光指數 Kp 5（凌晨 2–5
   點）」 when Kp data exists.
3. **Region list**: 8 compact cards. Each: region name, its best-weather icon for the day, temperature range
   across its places, warning icons, and a mini row of the next 5 days' icons. Tap → **bottom sheet** with the
   region's places (icon, max/min, rain %, gust, sunrise/sunset, night cloud). Sheet: enters from the bottom,
   follows the finger 1:1, rubber-bands upward past fully open, release projects velocity and dismisses
   downward past a threshold (same path it entered); scrim tap/Escape closes; focus moves into the sheet and
   back to the card. Reduced motion: cross-fade.
4. Footer line: source + updated time + BOM warnings link + "預報僅供參考，出發前再確認".

Hobart "today" on the page comes from a reactive hook that re-renders at the next Hobart midnight (timer)
and when the page becomes visible again, so a page left open overnight drops yesterday's chip.
EN/JA: every new static label (tab 天氣, 白天, 晚上・極光, 我們在這, 這天在雪梨, warnings, footer lines) gets
entries in both locale dictionaries, covered by the existing localization test.

Text: numbers and icons first; long text only inside the popup/sheet. Labels zh with `tt()` for EN/JA where
the rest of the site does; place names show Chinese + short English.

## 4. Navigation

Add `{ key: "weather", label: "天氣", short: "天氣", icon: "umbrella" }` after 地圖. Phone bottom bar becomes
7 equal columns (grid, `minmax(0,1fr)`); at 360–390 px each column is ~51–56 px, enough for an icon and a
two-character label without overflow (verified with screenshots at 375 px). The map fills the space like the
地圖 tab (immersive) only on the map section; the page scrolls to the region list.

## 5. Tests (vitest)

- `parseTasForecast`: multi-location fixture (Unix times) → right dates, day-cloud mean, night window crossing
  midnight, both DST transitions (first Sunday of October forward, first Sunday of April back; daily dates
  on both sides of each change stay on their own local date),
  rounding, drops dates without code, throws on mismatched length.
- `skyScore`, `risks`, `kpWindow` (UTC → Hobart conversion, window across midnight, empty rows → null).
- Handler: `/api/weather/tas` serves cached data without a second fetch within the TTL; falls back to stale on
  fetch failure; concurrent cold/expired requests (Promise.all of 5) cause exactly one Open-Meteo fetch;
  a lease held by another instance makes this one serve the stale value without fetching.
- Date rollover: a cached value fetched at 23:50 Hobart is not fresh at 00:05; cache-control near midnight
  is capped at the seconds left; the client hides past dates.
- Lease: a pre-existing `tas-weather-lock` row with null expiry is taken over; cache-control at 23:50 Hobart
  gives N + M ≤ 600.
- A New Zealand stop (−45, 168) is not a Tasmania candidate.
- Sydney: a seg "syd" day with only Sydney stops → `"syd"`; a seg "syd" day ending in Hobart with a
  Tasmanian stop → that stop's point; owner/public parity across every day of the seed document.
- Declutter: pure `declutter(boxes, minPx)` keeps priority order and hides overlaps (trip point beats tier 1).
- Trip badge (`tripPoint`): a Richmond day with stops under 50 km yields `richmond`; an away night yields the point of
  that day's public stops; a day whose only positioned item is a `住宿：…` stay note (with lat/lng) yields
  `hobart`; a day whose only positioned place is the private stay yields `hobart`
  (the stay is never used); owner and public documents give the same result.
- Cache: lease winner rechecks and skips the fetch when fresh; a holder whose token was replaced writes
  nothing; cold waiter receives the holder's value written at 6 s.
- Tab list includes 天氣; privacy: the response JSON has no owner-only keys.

## 6. Out of scope

No Google calls, no writes to the trip document, no dark mode, no new dependencies.
