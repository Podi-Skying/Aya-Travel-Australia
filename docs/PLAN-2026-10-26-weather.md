# Plan 2026-10-26k: weather forecast and rain-day backups (Kai)

## Source and caching

- **Source:** Open-Meteo forecast API (`api.open-meteo.com/v1/forecast`), with no key and `models=best_match`, which uses the BOM ACCESS models for Australia. AccuWeather was not used: it needs a key, has a small free quota and its terms are restrictive.
- **Request:** one request per place for 16 days of daily data: weather code, precipitation probability max, precipitation sum, max and min temperature, max wind, UV, sunrise and sunset.
- **Caching:**
  - Each place is cached in `lookup_cache` (`weather`, key = rounded lat,lng) for 3 hours. A failed fetch falls back to the stale value, marked `stale`.
  - `/api/weather` also sends `s-maxage=900`, and the browser keeps one answer for 15 minutes.
  - Page views never reach Open-Meteo directly.
  - Measured on the real trip: 4 places fetched in 2 s; the second call was served from the cache in 32 ms.
- **Horizon:** only dates within 16 days are asked for. Later days return `wx: null` and show 「尚無預報」.
- The source stamp reads 「Open-Meteo（含 BOM 模型）」 with the update time in Hobart time.

## Where each day is (city-level only)

- **Sydney part:** 雪梨.
- **Tasmania:**
  - On a night away from home, the town nearest that stay.
  - On a day trip going more than 50 km out, the town nearest its farthest stop.
  - Otherwise 荷巴特.
- The residence is never named or located. The server reads the owner's trip itself; the response carries city names and forecasts only, so everyone (public included) gets the same answer.

## Display

- **Day header:** a chip with a line icon, high/low and rain %. Rain likely makes the icon vermilion.
- **Calendar cells:** a small icon, vermilion when wet.
- **Day detail:** a forecast line (place, conditions, temperatures, rain %, mm, wind, strong UV, sunset), with warnings when rain is likely (≥60 %) or wind ≥45 km/h.
- **資訊與警示:** a strip of the next 10 days with the source stamp.

## Rain backups

- **Indoor or outdoor:** inferred from category (history, art, market, food = indoor) and words in the name. Words such as 步道, 海灘, 遊船 and 熱氣球 mean outdoor; 遊客中心 and 保育中心 mean sheltered. The owner can override per activity (`setIndoor`, item `indoor`).
- **Wet day:** rain ≥60 % or a severe code (heavy rain, snow, thunder). The day shows 「雨天備案」: each outdoor plan (not logistics, stays or work) with up to two indoor pool places in the same part of the trip within about 30 minutes.
- **Owner actions:**
  - 「換成備案」 (`useBackup`, undoable): the outdoor plan returns to the pool and the backup takes its time slot as pending.
  - 「其實是室內」: marks the plan indoor.
  - 「和 X 對調」 (`swapDays`, undoable) trades movable plans with a drier day of the same region in the forecast. Booked items, stays, work and transport stay put; days inside a chosen multi-day plan cannot be swapped.
- **Weather-sensitive notes on the activity:** the balloon (early-morning wind decides; the operator cancels or reschedules), cruises and ferries (swell and wind), and scenic flights (cloud and wind). Each says to check the operator's rules.
- **New pool packages, all marked indoor and free where admission is free:**
  - 「雨天備案：室內景點（塔斯馬尼亞）」: Salamanca Arts Centre, Hobart Convict Penitentiary, QVMAG.
  - 「雨天備案：室內景點（雪梨）」: Australian Museum, QVB, Art Gallery of NSW, SEA LIFE Sydney.
  - Already in the pool: TMAG, Cascade, MONA, Devils@Cradle and the Cradle visitor centre.
  - Prices not checked read 「票價待查」. Photos come from the usual Commons backfill.

## Tests

- Open-Meteo is mocked: parsing, labels, the horizon, one fetch per place, a cache hit on the second call, and no residence in the output.
- Wet and indoor rules, the backup search, `useBackup`, `setIndoor` and `swapDays` (confirmed items stay; different regions are refused).
