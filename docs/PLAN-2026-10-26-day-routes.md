# Plan 2026-10-26m: each day starts and ends at the stay, roads, one-line legs, navigation (Kai)

## Route model

- `routeStops(items, dayEnds)` builds each day as last night's stay → stops with a position → tonight's stay. The stay is UTAS by default; after an overnight it is the out-of-town stay, and in Sydney it is Riverwood. 「住宿：」 notes are not stops: the stay itself is the end.
- **Leg modes:**
  - The first leg is driven when the first stop is reached by car; the last leg when the last stop was.
  - Walking and transit days keep walking or transit legs.
  - A stay and a stop at the same spot make no leg.
- 每日行程 shows the first leg as a 「出發」 row (with 「全日導航」) and the last as 「回到住處」 (or 「入住 X」), each with its own leg line.
- The day map draws the same route.

## Roads

- Driven legs come from the route cache; Google Routes is billed and capped.
- **Owner's view:** missing driven legs are computed once per page view of that day, within the daily Google cap. A 「重新計算道路路線」 button stays while any are missing.
- **Map lines:** road legs are solid; walking, transit and not-yet-computed driven legs are dashed straight lines. The note explains this and says when the cap held computing back.
- `scripts/google-backfill.ts` includes the stay legs of scheduled days.
- **Backfill timing:** it runs after the Hobart-midnight cap reset, because 26/10 used the full 700 (galleries and the photo backfill).
- **Missing stay positions:** four overnight stays (Penny Royal Launceston, Bicheno by the Bay, Cradle Forest Inn, Stanley Seaview Inn) had none, so those days had no end point. They get positions from a Places search after the reset, as a backed-up data version.
- **11/9 leg 1→2 (Swansea → Wineglass Bay):** the bend north is the real road. Coles Bay Road leaves the Tasman Highway north of Swansea. The Wineglass Bay stop sits on the bay itself, which no road reaches; it moves to the Wineglass Bay Lookout car park, where the walk starts.

## Leg labels (one line)

- With a road-computed leg, it reads 「開車 50 分・62 公里」 only, and the old estimate is dropped.
- Without one, it reads the single estimated mode, or the total when the old data mixes modes: 「約 1 小時 30 分（估計）」.

## Navigation (no API cost)

- Each leg has 「導航」, which opens Google Maps directions (`/maps/dir/?api=1`) with the leg's mode (driving, walking or transit). 「全日導航」 covers the whole day, split every 9 waypoints (Google's limit).
- **Privacy:**
  - Owner links may start from the residence's coordinates.
  - Share links omit the origin when it is the residence, so Google starts from the viewer's location. A trip back to the residence uses the stay's name, never an address.
  - Public visitors get no navigation (they have no positions).

## Map clutter

- Unscheduled pool pins (with their category icons such as the flag and the paw) show only when 「顯示附近的待安排景點」 is ticked; it is off by default.

## Tests

- routeStops: starts and ends at stays, drive flags, walking day, zero-length leg dropped.
- navUrl: no origin when omitted, place-name destination, 9-waypoint split, modes.
