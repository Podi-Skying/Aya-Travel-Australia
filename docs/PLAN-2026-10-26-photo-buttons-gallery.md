# Plan 2026-10-26j: photos open their gallery, no link icons, 畫廊 page, design pass

## 1. Photo is the gallery button (Kai)

- `PlaceGallery({ item, thumb, fallback })` wraps the place's own photo in a button (aria-label 「看 X 的照片」). Clicking it opens the React Bits Stack in a modal `<dialog>` sheet, which can be closed with Esc, the × button or a click on the backdrop.
- There is no 「看照片」 button anywhere: 每日行程 rows (and 更多資訊), map place cards and 跨日行程方案 stops.
- **Count chip:**
  - The number counts the place's own photos, the gallery and cached Commons photos. The Commons list loads when the thumbnail scrolls into view; it costs no external calls.
  - A trailing 「+」 means Google photos may add more. They load only when the sheet opens, because they are billed.
- **No photos:** a stop with no photo shows the hand-drawn placeholder tile. When there can be no photos at all, the tile is plain and not a button: public viewers, logistics items and 住宿 notes, which never trigger Google.
- The plan-level photo overview stack in 跨日行程方案 is removed. Clicking a plan in the reel scrolls to its 第 1 天 and focuses that heading (an instant jump under reduced motion). Arrow keys in the reel keep focus on the reel. The reel itself is kept as the plan chooser.

## 2. Source link icons removed

- `PhotoCredit` and the map popup link icon are gone; the source URLs stay in the data.
- **What remains visible:**
  - **Non-Google photos:** in the opened gallery, the front photo's source, author and licence as plain text, with no link (Commons licences such as CC BY-SA require attribution). The day-hero viewer shows the same text.
  - **Google photos:**
    - The opened gallery shows the authors' names, linked to their profiles, and a text link 「Google 地圖」 to the photo's mapsUri. Google's Places policies require both: "credit the author" with name and profile link, and let users view the photo on Google Maps.
    - Thumbnails inside the gallery button omit the attribution. The policy allows that when space is limited and the user can open a larger version with full attribution, which the button does.
    - The pool list's Google thumbnail is not a gallery button, so it keeps the author names with a text 「Google 地圖」 link instead of the icon.

## 3. 畫廊 (own build; React Bits Pro is not available)

- New private tab 「畫廊」, for the owner and share links only; it is hidden for the public.
- `DriftGallery`:
  - **Rendering:** 36 recycled photo planes are drawn with CSS 3D transforms (perspective 900px). One requestAnimationFrame loop moves a camera through a repeating depth of 36 × 260 px. Each plane's photo and scatter are fixed for each lap, so planes recycle endlessly in both directions. Fog fades planes in from far and out just before the camera.
  - **Input and pausing:**
    - Wheel and trackpad (non-passive listener) add velocity, with exponential friction.
    - Drag and touch move the camera 1:1. Grabbing stops the drift.
    - Arrow keys push the camera.
    - A slow idle drift runs when nothing is held.
    - The loop pauses when the tab is hidden or the page is not active.
  - **Click:** a click (not a drag) shows the place name, the date and the plain credit, plus 「看那天的行程」 for scheduled places.
  - **Content:** photos come from `tripShots`: own photos, galleries and cached Commons photos (500 px Commons thumbnails), each once. Logistics items and 住宿 notes are skipped. Google photos are not used (billed).
  - **Reduced motion:** a still masonry grid with the same click info.
- No new dependencies and no WebGL.

## 4. Maria Island cruise photos (Kai)

- Kai's 6 images are stored as 1600 px webp in `web/media/maria-island-cruise`, behind the owner or share-token media route.
- The cover is 01 (the aerial view of Île des Phoques). 05 (passengers from behind, operator branding) is last in the gallery.
- Data version v106; the backup was taken first.
- The branch `assets/maria-island-cruise` could not be deleted from here (permission), so Kai deletes it.

## 5. Design pass (apple-design)

- **One motion family:** `--ease` (critically damped curve), `--t-press` 100 ms, `--t-ui` 200 ms and `--t-sheet` 280 ms. Every transition now uses `--ease`.
- **Press feedback on pointer-down:** buttons, chips and photo buttons scale to 0.97 when pressed. Under reduced motion they don't scale.
- **Gallery sheet:** it rises 16 px and fades in with its scrim. Under reduced motion it only fades.
- **Loading and empty states:** while loading, the gallery shows a 230 px placeholder box that pulses (still under reduced motion); 畫廊 has an explicit empty state.
- **Photo-first stop cards:** steadier spacing between photo, time and name.

## 6. Photo audit

- `Aya澳洲旅遊規劃/PHOTO-TODO.md` counts the photos a share link sees: own photos, galleries and cached Commons photos; live Google photos are not counted.
- It lists places with fewer than 5 photos, 0 first, grouped by day, 跨日行程方案 and pool. Logistics, stays, meals and work shifts are listed separately as not needing photos.

## Checks

- tsc, lint and tests pass.
- Local share-link preview:
  - the photo button opens the sheet with credits;
  - a plan click lands on 第 1 天 and the overview is gone;
  - 畫廊 drifts, and wheel input and clicks show info.
