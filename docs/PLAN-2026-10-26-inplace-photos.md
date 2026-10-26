# Plan 2026-10-26l: photos switch in place, no blank tiles, cleaner 畫廊 (Kai, apple-design)

## 1. No blank placeholder

- **Root cause (quiz):** the quiz cards read only a place's own photo or gallery. Places whose photos come from the cached Wikimedia Commons lists (for example QVMAG and the other new indoor places) fell through to the wavy-line placeholder.
- **Fix:**
  - The quiz loads the cached Commons lists for places without their own photo, 6 at a time, for the owner and share links.
  - Cards show the first Commons photo at 500 px.
- **States everywhere:**
  - **Loading:** a drawn camera pulses on a soft shimmer (static under reduced motion). The quiz uses an animated SVG image, the cards `LoadingTile`.
  - **No photo after loading:** the place's category icon on a tint (with its name in cards).
  - The wavy-line placeholder is gone.
- **Places that may still show the category tile:** for share links, the 8 places with no own or Commons photo in `PHOTO-TODO.md` (Bruny chocolate, Bruny cheese and oyster lunch, East Coast Natureworld, Freycinet Air, Markree, Solo Pasta, South Arm, Tasmanian Produce Market). Live Google photos may fill most of them. Two of them, Markree and Tasmanian Produce Market, have no position, so Google cannot be asked.
- **每日行程 rows** without any photo stay text-only (`empty="hide"`).

## 2. Photos switch in place (no pop-up)

- `PlaceGallery` now shows the place's photos in its own card. The sheet, the Stack component and the `motion` dependency are removed.
- **Switching:**
  - Tap or click shows the next photo with a short slide-and-fade in the card. A swipe left or right goes forward or back (vertical scrolling still works). Arrow keys work when the card is focused.
  - The chip reads 「2 / 9」, plus 「+」 while Google may add more.
  - Under reduced motion the swap is instant (site-wide rule).
  - The next photo is preloaded.
- **Credit:** a one-line caption under the card for the current photo. Non-Google photos show source, author and licence as plain text. Google photos show the author linked to their profile, and a 「Google 地圖」 link, as Google requires.
- **Loading order:**
  - Cached Commons photos load when the card comes on screen.
  - Google photos (billed) load on screen only when the place has no other photo; otherwise they load when the viewer reaches the last photo, and the next tap moves on.
- Used in 每日行程 rows, 跨日行程方案 stops and map place cards. The day hero keeps its full-screen viewer.
- **Bundle:** client JS 1,218,376 → 1,108,128 bytes (−110 KB) with Stack and motion removed.

## 3. 畫廊

- **No duplicates:**
  - Photos are deduplicated by image identity: Commons thumbnails and originals reduce to the file name, other URLs drop their query.
  - The field uses at most as many planes as distinct photos (36 max). The planes on screen always map to consecutive photo indexes, so one photo is never shown twice at once.
  - Perceptual hashing is not done: that would mean downloading every image in the browser.
- **No backdrop:** the field background and the planes' paper fill and drop shadow are removed. Only the photos remain, over the page's own paper background, which is kept for readability of the page text.

## Checks

- tsc, lint and 154 tests pass (sameImage and dedupe tests added).
- Local share-link check against a copy of the current trip:
  - the Maria Island card goes 1 / 6+ → 2 / 6+ on tap and back on ←, with no dialog;
  - QVMAG shows its category tile when no Commons list is cached locally;
  - 畫廊 shows 35 visible planes, 35 distinct, with no backdrop.
