# Plan: hourly conditions on the Weather tab (天氣・逐時) — 2026-11-08

Kai wants hourly conditions, because a day can show a rain icon when the rain only falls before dawn and
the daytime is sunny. Phone first. Aya prefers icons and numbers over text. Apple-design rules still apply:
- instant press feedback;
- interruptible, critically damped springs;
- 1:1 drag with momentum projection and snap;
- a sheet that follows the finger and leaves the way it came;
- reduced-motion and reduced-transparency fallbacks.

There is no dark mode (Kai 10-27), and the tab makes no Google calls.

Builds on docs/PLAN-2026-11-08-weather.md:
- domain: `src/domain/tas-weather.ts`
- server: `src/server/tas-weather.ts`
- UI: `src/components/TasWeather.tsx`

## 1. Data (server)

### One Open-Meteo request per hour, as today

`tasForecastUrl()` keeps one multi-location request for the 30 points and asks for more hourly variables:

```
hourly=weather_code,temperature_2m,apparent_temperature,precipitation_probability,precipitation,
       cloud_cover,cloud_cover_low,wind_gusts_10m,is_day
```

The daily list is unchanged. The request keeps `forecast_days=16`, because the night-cloud fields need hourly
cloud on every date.

Open-Meteo counts usage at 1 call per location, scaled by number of variables (per 10) and number of days
(per 14). This request has 17 variables over 16 days: about 1.7 × 1.14 ≈ 2 calls per location, about
60 calls per request. At most 24 requests a day is about 1,450 calls a day, against the 10,000-a-day free
limit. The once-an-hour lease (one fetch for the whole site) stays. After a failed fetch the lease is kept for 60 minutes
(`COOLDOWN_MS`, one forecast period) as a shared cooldown, so no instance and no hourly request retries
Open-Meteo before then. Success or failure, that is at most one request an hour (about 24 a day; one more can
fall at Hobart midnight). The
stored forecast is served, marked stale, meanwhile.

### Storage: summary row plus one small hourly row per point

The summary row (`tas-weather` / key `v3`) stays small:
- Changing the key from `v1` to `v3` makes the first request after the deploy fetch the new shape. The old
  `v1` row (and any unreleased `v2` test rows) is ignored.
- The lease keeps using the key, so `v3` gets its own lease.

`TasDay` gains these fields, computed in `parseTasForecast`:
- `dayCode`: the most severe hourly `weather_code` among daylight hours (Open-Meteo's daily code is also
  "most severe", but over 24 h). If no daylight hour exists, it falls back to `code`.
  - "Most severe" uses an explicit ranking, `wxSeverity`, not the numeric code: intensity first
    (slight < moderate < heavy), then kind (drizzle < rain < freezing < snow). Thunderstorms rank above
    everything; fog ranks above clouds and below any precipitation. So violent rain showers (82) beat slight
    snow showers (85).
- `dayPop`: the highest hourly `precipitation_probability` in daylight (null if none).
- `dayRain`: the sum of hourly `precipitation` in daylight, to 1 decimal.
- `nightRain: string[]`: one `HH–HH` range per run of consecutive wet hours outside daylight, e.g.
  `["02–05"]` or `["02–03", "04–05", "21–24"]`.
  - Set only when the date has no wet daylight hour and has at least one wet hour outside daylight.
  - Otherwise it is `[]`.
  - A dry hour splits a run. The end of a range is the last wet hour + 1.
  - Region cards merge their points' runs with `mergeNightRain` into at most two spans, one before dawn and
    one in the evening. Each span means "rain possible sometime in this span", for example 「00–05」.

Definitions:
- **The hour starting at `t`:** covers `[t, t+3600)`.
  - Instant variables (`weather_code`, temperature, apparent temperature, cloud, low cloud, `is_day`) come
    from the sample at `t`.
  - Open-Meteo reports `precipitation`, `precipitation_probability` and `wind_gusts_10m` for the hour
    *before* each sample. So the hour starting at `t` takes them from the sample at `t + 3600`.
  - An hour with no following sample (the very last one) is dropped.
- **Daylight hour:** an hour `[t, t+3600)` that overlaps `[sunrise, sunset)` of the same Hobart civil
  date. Unix compare against the daily sunrise/sunset instants.
- **Wet hour:** unrounded `precipitation ≥ 0.1` mm, or `weather_code ≥ 51` (drizzle, rain, snow, showers, storm).
  It is stored per row as `w` (0/1); `dayRain` sums the unrounded amounts and rounds once. Only the shown
  `mm` is rounded to 0.1.
  Fog (45/48) is not wet.
- Hours are Hobart civil hours from `hobartCivil` (DST-aware, as today).

Hourly rows (`tas-weather-hourly` / key `v3:<pointId>`), one per point:
- They are written in the same `commit` transaction as the summary row, so the two never disagree.
- They cover only the first 10 Hobart dates, starting today.
- Value:

```ts
// u: Unix start of the hour (unambiguous across DST); h: its Hobart civil hour.
type HourRow = { u: number; h: number; code: number; w: 0 | 1; t: number | null; f: number | null; pop: number | null;
                 mm: number | null; cl: number | null; lo: number | null; g: number | null; d: 0 | 1 };
type HourDay = { date: string; sunrise: string | null; sunset: string | null;
                 sr: number | null; ss: number | null;   // sunrise/sunset as fractional Hobart hour, for shading
                 hours: HourRow[] };                       // 23–25 rows at a DST change
type TasHourly = HourDay[];
```

Rounding: temperatures to 1 decimal; mm to 1 decimal; other values to integers. That is about
240 × ~70 bytes ≈ 17 KB per point and about 500 KB across the 30 rows. The summary row does not grow by
more than the 4 new small fields per day.

### Endpoint

`GET /api/weather/tas/hourly?id=<pointId>` (the response also carries `summary`, the point's summary rows
from the same fetch):
- Public. It reads no trip data and makes no Google call.
- `id` must be one of `TAS_POINTS`; otherwise it returns 404.
- Handler:
  1. Calls `tasWeather()` first, so a stale forecast refreshes under the existing lease.
  2. Reads the summary row and that point's hourly row in one SQL statement (one snapshot). It serves them
     only when their `fetchedAt` values are equal (same commit); otherwise it returns 503.
  3. Filters out dates before today.
  4. Returns `{ id, days: TasHourly, summary: TasDay[], fetchedAt, stale }`. The sheet header uses `summary`,
     so it always matches the hours even when the page's own summary is an hour older.
- If the row is missing (cold start, or the fetch failed), it returns 503 with 「逐時預報暫時無法取得」.
- The edge cache header is the same as `/api/weather/tas`: `s-maxage ≤ 1800`, never past Hobart midnight.

The client keeps an in-memory memo per id and Hobart date (15 minutes, dropped on failure). An open sheet
refetches when Hobart's date changes, so after midnight the new tenth date is available.

## 2. Daily summary uses daylight (fix)

- Map markers, region cards, region-sheet rows and the hourly-sheet header use `dayCode` and `dayPop`, not
  `code` and `pop`. The `wet` class also uses `dayPop`.
- When `nightRain.length > 0`:
  - **Map marker:** a small moon-with-drops glyph next to the warning icons (`title` 「雨在 02–05 點」), in both
  day and night mode.
  - **Region card:** under the main icon, a small `moon-rain` glyph and the ranges (`02–05`). It shows when
    the card's chosen code is not wet and any point in the region has `nightRain`; the ranges are the union
    across those points.
  - **Region-sheet row and hourly header:** glyph and 「雨在 02–05 點」 (en "Rain 02–05", ja 「雨 02–05時」).
- `regionSummary` picks the most frequent `dayCode`. Ties go to the less severe code by `wxSeverity`.

## 3. Hourly sheet (UI)

### Opening it

- **Tapping a map marker** opens the hourly sheet for that point and the picked date. The Leaflet popup is
  removed; its night facts (low cloud, total cloud, Kp, low) move into the sheet header in night mode.
  Leaflet marker keyboard Enter already fires `click`, so keyboard users get the same.
- **In the region sheet:** each point row becomes a `<button>` that opens the hourly sheet on top. The
  region sheet stays behind, dimmed by the new scrim. Closing the hourly sheet returns to it, and focus
  goes back to the row.

### Shared `Sheet` component

`RegionSheet`'s mechanics are extracted into one `Sheet` component, reused by both sheets, with no
behaviour change:
- portal and scrim;
- drag from the grabber or header, with 8 px hysteresis and pointer capture;
- rubber-banding upward;
- velocity projection with a 35 % threshold;
- a spring with response 0.3;
- a grab during close catches the sheet;
- leaves downward, the way it came;
- `inert` behind, focus trap, Escape;
- reduced motion: a cross-fade.

Stacking: each sheet makes everything outside its own host `inert` when it opens and restores that when it
closes, so the stacked case works without extra code.

### Contents, top to bottom (icons and numbers first, almost no words)

1. **Header:**
   - point name; the date as `週二 11/10`; close button;
   - summary chips: `dayCode` icon, H/L, droplet `dayPop`%, sunrise and sunset times, and the night-rain hint
     if any;
   - in night mode: low cloud %, total cloud %, Kp if any.
2. **Date strip:** the same `DayStrip` component with the page's own dates, bound to the same picked date
   as the page, so a change here also changes the map and the cards. The picked date always stays picked.
   For a date past the 10-day hourly horizon, the header shows that date's summary and the chart area says
   「逐時預報只有 10 天」. The chart stays mounted meanwhile, with `visibility: hidden` and no height, so it
   keeps its layout and scroll position. Its scroll effect is skipped while hidden, so returning to an hourly
   date springs from the position it had when it was hidden.
3. **Hour strip:** one horizontal scroller with one 48 px column per hour (00–23, plus or minus 1 at DST).
   - Touch: native `overflow-x: auto` with `scroll-snap-type: x mandatory` and `scroll-snap-align: start` per
     column. That is the platform's own 1:1 tracking, momentum and snap.
   - Snap is switched off (inline `scroll-snap-type: none`) only while our own spring or mouse drag moves
     the strip; any pointer-down stops the spring and restores it.
   - Mouse: DayStrip's drag logic is extracted into a `useDragScroll(ref, { snap, reduce })` hook, used by
     both strips:
     - 10 px hysteresis and pointer capture;
     - release velocity, then `project()`, then snap to the nearest column;
     - a critically damped spring from the current `scrollLeft`;
     - a drag does not click.
   - Initial position: today scrolls to the current hour − 1. Other days scroll to the sunrise hour − 1.
     - On first paint it jumps.
     - The chart stays mounted across date changes, and on a change it springs from where it is (a jump
       with reduced motion).
   - **Current hour:** the row whose `u` is the current hour's start. A store wakes at each hour boundary
     and on `visibilitychange`, so 「現在」 moves while the sheet is open.
   - **Repeated hour:** when clocks go back, the second 02:00 is labelled `02′`.
   - One SVG per day, width 48 × hours, with these rows:
     1. **Hour label:** `HH`, or 「現在」 for the current hour today.
     2. **Weather icon:** at night (`d = 0`), sun becomes moon and partly becomes moon-partly. Two moon paths
        are added to `Weather.tsx` `PATHS`, and `WxIcon` gains a `night` prop. Other icons stay as they are.
     3. **Temperature curve:** a monotone cubic through the hourly temperatures, a dot and a value per hour,
        and **H** and **L** marks at that day's highest and lowest hour.
        - The y scale runs from that day's low − 2° to its high + 2°, so neither mark touches an edge.
        - When the high and low are the same hour, that dot is labelled `H/L`.
        - A dashed line for apparent temperature is left out, to keep it simple. The feels-like value goes
          into the column's `aria-label` only.
     4. **Rain:** a bar per hour with height ∝ `pop` (0–100 %). It is vermilion when the hour is wet, and the
        `pop`% is printed above bars ≥ 20 %. When `mm ≥ 0.1`, the mm value is printed under the bar.
     5. **Gust:** km/h number, in the warning colour when ≥ 60.
     6. **Cloud:** a 0–100 % bar. The darker part is low cloud and the lighter part is the rest of the total.
   - **Night shading:** a soft band from 0 to the `sr` x position and from the `ss` x position to the end,
     drawn behind all rows. At night, hour labels and icons use the muted ink.
   - **Fixed left legend** outside the scroller (icons only): thermometer, droplet, wind, cloud, each aligned
     to its row.
4. **Foot:** 「Open-Meteo（CC BY 4.0）」, the same as the page, plus the hourly data's update time and
   「舊資料」 when the response is stale.

### Accessibility and reduced preferences

- The scroller is `role="group"` with `aria-label` 「逐時預報」.
- Each column has an `aria-label` such as 「14 點，晴，16°，體感 14°，降雨 10%，0 mm，陣風 32，雲 20%」.
- The SVG itself is `aria-hidden`.
- `prefers-reduced-motion`: no spring scrolling (jump) and a cross-fade sheet, as the existing code does.
- `prefers-reduced-transparency`: a solid sheet and header background, no `backdrop-filter`.
- No dark-mode styles.

### Loading

- While the hourly fetch runs, the sheet opens at once with the header filled from the summary data and a
  skeleton strip.
- On failure, it shows 「逐時預報暫時無法取得」 and a retry button.

## 4. Tests (vitest)

`tests/tas-weather.test.ts` is extended:
- **Night-only shower:** a fixture with rain 02–04 only and sunrise 05:40. Expect `dayCode` = 1 (the
  daytime code), `dayPop` = the daytime max, `dayRain` = 0, `nightRain` = `["02–05"]`, while `code` stays
  the daily 61.
- Rain at 14:00 gives `nightRain` `[]` and `dayCode` 61.
- Rain at 03 and at 22 with a dry day gives two ranges.
- A DST spring-forward date has 23 hourly rows, and the daylight overlap is still correct.
- Hourly rows cover only the first 10 dates, starting today.
- `tasForecastUrl()` contains the 9 hourly variables, and the hourly row shape round-trips.
- Endpoint: an unknown id returns 404; a known id with no row returns 503; dates before today are dropped.
- **Commit:** the summary row and the 30 hourly rows are written in one transaction, and lease-loss writes
  nothing. Existing lease tests are kept.
- **Region summary:** a region with one night-only point and a dry day shows the hint, and the union of
  ranges is correct.

## 5. Out of scope

- No change to trip-day weather (`/api/weather`).
- No Google calls.
- No new place list (still the same 30 points).
- No dark mode.
- No push notifications.

## 6. Verify and ship

1. Run vitest and `tsc`.
2. Run Codex cross-check of the diff, fix the findings, and run the tests again.
3. Commit as Kai's noreply email and push to main, which Vercel deploys.
4. On live, at phone width (375 × 812):
   - open a marker and a region-sheet row;
   - screenshot the hourly sheet, on a date with night-only rain if the live forecast has one (found by
     scanning `/api/weather/tas` for `nightRain`).
5. Check the Open-Meteo usage arithmetic against the actual request.

## 7. Changes after review round 1 (Codex)

- **WXH-01:** preceding-hour variables are shifted onto the hour they describe (§1 definitions).
- **WXH-02:** explicit severity ranking.
- **WXH-03:** runs split at dry hours; region merge is a "possible within" span.
- **WXH-04:** `u` per row, `02′` label, hourly clock store; test for the 25-row fall-back date.
- **WXH-05:** the hourly response carries the point's summary, and the header uses it.
- **WXH-06:** night-rain glyph in both modes.
- **WXH-07:** the sheet strip uses the page's dates and keeps the picked date.
- **WXH-08:** the chart stays mounted and springs on a date change.
- **WXH-09:** mandatory snap, switched off only during our own motion.

## 8. Changes after review round 2 (Codex)

- **WXH-10:** `weather_code` is an instant value, so only rain, rain chance and gusts are shifted.
- **WXH-11:** the summary and hourly rows are read in one statement and served only with equal `fetchedAt`.
- **WXH-12:** the chart stays mounted, hidden, past the horizon.
- **WXH-13:** 2° of padding on both ends; the plan now says 2°.
- **WXH-14:** `H/L` when the high and low fall in the same hour.
- **WXH-15:** the type comment is on its own line.
- **Cache key:** bumped to `v3`, so local test rows written in the old shape are ignored.

## 9. Changes after review round 3 (Codex)

- **WXH-16:** the memo is keyed by point and Hobart date, and the sheet refetches when the date changes.
- **WXH-17:** the hidden chart keeps its scroll position and skips its scroll effect until it is visible.
- **WXH-18:** region ties go to the less severe code by `wxSeverity`.
- **WXH-19:** the accessible label includes `0 mm` whenever the amount is known.

## 10. Changes after review round 4 (Codex)

- **WXH-20:** `stale` comes only from the freshness of the selected summary row.
- **WXH-21:** the hourly sheet ends with the Open-Meteo (CC BY 4.0) attribution link.

## 11. Changes after code inspection round 1 (Codex)

- **WXH-R1:** each sheet host is its own stacking level (`position: relative; z-index: 940`), so a stacked
  sheet's scrim dims the sheet below it.
- **WXH-R2:** the region-row button has no `aria-label`; its visible forecast text is its accessible name.
- **WXH-R3:** the hourly sheet's foot shows the update time and 「舊資料」 when stale.

## 12. Changes after code inspection round 2 (Codex)

- **WXH-22:** wet classification (`w`) and `dayRain` use the unrounded precipitation; only the displayed `mm` is
  rounded.
- **WXH-23:** a failed fetch keeps the lease for `COOLDOWN_MS` (5 min) instead of releasing it. Leases up to one
  cooldown long are no longer treated as malformed.
- **WXH-24:** the page summary memo is keyed by Hobart date. The tab revalidates when the Hobart date changes and
  whenever it becomes active again. A fresh memo returns the same object; a failed refresh keeps what is shown.

## 13. Changes after code inspection round 3 (Codex)

- **WXH-25:** `COOLDOWN_MS` is 60 minutes, so sustained failures cannot exceed about one request an hour.
- **WXH-26:** the region card shows the night-rain hint in both modes, including in its accessible name.
- **WXH-27:** without daylight hours, `dayCode` falls back to the daily code, and `dayPop` and `dayRain` are `null`
  (never whole-day values).

## 14. Changes after code inspection round 4 (Codex)

- **WXH-28:** the marker's night-rain badge sits centred just below the marker (`bottom: -15px`), clear of the
  temperature row. All 11 markers with the badge on 11/11 were checked, with no overlap.
