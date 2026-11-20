# Plan: Kai's own trip photos, sorted by day, private (2026-11-20)

Kai (2026-11-20): 「我要旅遊照片分類，我要上傳我的照片並且分類到旅遊天數，但是這是要只有我的帳號或是我允許的帳號才能看，訪客只能看 google 爬蟲抓的那些圖」.

## Goal and acceptance criteria

1. The owner can upload many photos at once from a phone. Each photo is resized in the browser and stored in a **private** Vercel Blob store. Photos never go in the git repository (it is public) and never into Neon as bytes.
2. Each photo is assigned to a trip day: EXIF capture time first, then a date in the file name (`dji_export_20261115_…`, `IMG_20261115_…`, `20261115_…`), otherwise 「未分類」. Within a day it is attached to the activity whose time window contains the capture time (GPS distance breaks ties when present). The owner can move a photo to another day or activity, set a caption, and delete it (confirm; the blobs are deleted too).
3. Only allowed people see the photos: the owner (`OWNER_GITHUB_IDS`), and, when `PHOTO_VIEWERS=1`, allowlisted GitHub ids or emails who signed in, and holders of a revocable viewer link. Guests and trip share links never see a private photo, its id, URL, caption, or even the count.
4. Guests keep seeing only the existing Google/Commons place photos. Nothing changes for them, and they make no extra request.
5. Until the Blob store exists (no `BLOB_READ_WRITE_TOKEN` and no `BLOB_STORE_ID`), the owner sees 「照片儲存空間還沒設定」 with the menu path to create it, and nothing else breaks.
6. `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass.

## Non-goals

- No face or content recognition, no albums beyond days, no video.
- No editing of the trip document: photos live in their own tables, so the trip version history is unaffected.
- No original-resolution archive: the display copy (long side 2048 px) is the stored copy. Kai keeps originals on his phone.
- No public sharing of a single photo.

## Storage (Vercel Blob, private)

- `@vercel/blob` (current 2.9.0; private storage needs ≥ 2.3).
- **Server upload, not client upload.** The browser resizes first (about 0.3–0.6 MB per display copy, about 40 KB per thumbnail), so one request per photo stays far under Vercel's 4.5 MB function body limit. Server `put()` works with either the read-write token or the store's OIDC connection (`BLOB_STORE_ID` + `VERCEL_OIDC_TOKEN`), while client `handleUpload` requires `BLOB_READ_WRITE_TOKEN` and an `onUploadCompleted` callback that cannot reach localhost. Server upload also lets one request validate, store both copies and insert the row.
- Path: `trip-photos/<photo uuid>/display.jpg` and `…/thumb.jpg`, `access: "private"`, `addRandomSuffix: true`, `contentType: "image/jpeg"`. The stored URLs and pathnames stay server-side.
- Configured = `BLOB_READ_WRITE_TOKEN` or `BLOB_STORE_ID` is set. The SDK reads either; this code never reads, logs or returns their values.
- Reading: `get(pathname, { access: "private" })`, streamed by our route with `Content-Type: image/jpeg`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, max-age=3600`, `X-Robots-Tag: noindex`. Not a CDN-cacheable response.
- Delete: `del([display, thumb])`, then the row.
- Hobby limits (vercel.com/docs/vercel-blob/usage-and-pricing): 1 GB storage, 2,000 advanced operations (each `put` is one, so about 1,000 photos uploaded a month), 10 GB transfer. Exceeding them blocks Blob for 30 days, so the upload route refuses when the stored total would pass 950 MB, and the page shows used / 1 GB.

## Data (Neon, migration `0003_photos.sql`)

```
trip_photos
  id uuid pk, trip_id uuid fk trips on delete cascade,
  display_path text, thumb_path text, bytes int,
  width int, height int,
  sha256 text            -- of the original file; unique (trip_id, sha256) makes a re-upload a no-op
  taken_at timestamptz null, taken_local text null   -- 'YYYY-MM-DDTHH:mm' wall time used for the day
  time_source text       -- 'exif' | 'filename' | 'none'
  day_date text null     -- 'YYYY-MM-DD' of a trip day; null = 未分類
  item_id text null      -- activity id in that day, null = whole day
  manual bool default false  -- set when the owner moves it by hand
  lat, lng double null   -- from EXIF GPS, owner/viewers only
  caption text null, file_name text,
  uploaded_by text, created_at timestamptz default now()
  index (trip_id, day_date, taken_local)

photo_viewers                      -- allowlist
  id uuid pk, trip_id fk, kind text ('github' | 'email'), value text (github numeric id, or lower-cased email),
  label text, created_at; unique (trip_id, kind, value)

photo_links                        -- revocable viewer links
  id uuid pk, trip_id fk, token_hash text unique (sha256 of the token), label text,
  active bool default true, created_at, revoked_at
```

All reads and writes go through `src/server/my-photos.ts`; the owner functions take the branded `Owner` (as `trips.ts` does).

## Access

`photoAccess(req)` in `src/server/photo-access.ts` returns `{ kind: "owner", owner } | { kind: "viewer", tripId } | null`:

1. Owner session (`checkOwner()`), or
2. only when `PHOTO_VIEWERS=1`: a signed-in session whose GitHub id or email is in `photo_viewers`, or
3. only when `PHOTO_VIEWERS=1`: the `aya_photos` cookie (httpOnly, Secure in production, SameSite=Lax, path `/`, 30 days) whose sha256 matches an active `photo_links` row.

Viewer link flow: `/p/<token>` (server route) checks the token, sets the cookie with the raw token, and redirects to `/photos`; an invalid or revoked token shows 「連結已失效」. The token is 32 random bytes, base64url; only its hash is stored. The owner sees a new link once, at creation.

Sign-in for allowed accounts (behind `PHOTO_VIEWERS=1`):
- The next-auth `signIn` callback keeps owners as today and also admits a GitHub id or verified email in `photo_viewers`. Everyone else is still refused. The session carries `githubId` and `email`.
- A Google provider is added only when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are both set; its email must be `email_verified`. With `PHOTO_VIEWERS` unset, sign-in behaviour is exactly today's.
- A signed-in viewer is not an owner: `/plan` and `/` show the public trip as today, plus their photos (below).

Guests and trip share links: `photoAccess` returns null; every `/api/my-photos/*` route answers 401 with the same body whether or not photos exist. No trip document, `/api/public`, `/api/s/<token>` or walk page gains any photo field.

## API (all `runtime = "nodejs"`, `dynamic = "force-dynamic"`)

| Route | Who | What |
|---|---|---|
| `GET /api/my-photos` | owner, viewer | `{ configured, photos: [{ id, w, h, dayDate, itemId, takenLocal, caption }], usedBytes, quotaBytes, viewersEnabled }`; `usedBytes`/`quotaBytes`/`viewersEnabled` and per-photo `lat`/`lng`/`fileName`/`manual` are owner only; viewers get only photos with a day (未分類 is the owner's inbox) |
| `POST /api/my-photos` | owner | multipart: `display` (JPEG ≤ 3 MB), `thumb` (JPEG ≤ 300 KB), `meta` JSON (zod: sha256, fileName, exifTime? (raw DateTimeOriginal), exifOffset? (raw OffsetTimeOriginal), lat?, lng?, width, height). Server checks JPEG magic bytes, size caps, quota, same-origin; duplicates return the existing row. Server computes the wall time, `time_source`, `day_date` and `item_id` from the raw EXIF fields or the file name and the current trip; any other field the client sends is ignored. On a failed insert the two blobs are deleted. |
| `PATCH /api/my-photos/[id]` | owner | `{ dayDate?: string \| null, itemId?: string \| null, caption?: string (≤ 200) }`; day must be a trip day, item must be in that day |
| `DELETE /api/my-photos/[id]` | owner | delete blobs then row |
| `GET /api/my-photos/[id]/[size]` | owner, viewer | `size` = `thumb` or `full`; streams from Blob |
| `GET/POST/DELETE /api/my-photos/viewers` | owner | list, add (`{ kind, value, label }`), remove allowlist entries |
| `GET/POST/DELETE /api/my-photos/links` | owner | list (label, created, active), create (returns the URL once), revoke |

Mutations use the existing `sameOrigin` check (`http.ts`); uploads are also limited to 600 per 10 minutes (`routeQuota`, fail closed). Every denial (signed out, stranger, flag off, revoked link, share token) is the same `401 {"error":"需要登入或照片連結"}`.

## Day and activity assignment (`src/domain/photo-day.ts`, pure)

- `takenLocal` comes from EXIF `DateTimeOriginal` (wall time). If EXIF also has `OffsetTimeOriginal`, the instant is converted to `Australia/Sydney` wall time (Sydney and Hobart are both UTC+11 in November 2026, so the trip days share one zone). No offset: the wall time is used as is (the phone was on local time).
- File-name date: the first `20\d{6}` group that is a valid date (`dji_export_20261115_photo_0034` gives 2026-11-15, time unknown; an `_HHMMSS` right after the date is used when present).
- `dayFor(takenLocal, days)`: the date part if it is one of the trip's days, else null. A photo taken 00:00–03:59 is still that calendar date (no "night belongs to the previous day" rule; Kai can move it).
- `itemFor(takenLocal, day)`: among the day's items with a `time`, the one whose `[time − 15 min, time + dur + 15 min]` contains the time; on overlap the nearest by GPS when both have coordinates, else the later start. Logistics items (stay check-ins) are skipped. No time: null.
- Re-sorting: when the trip changes, nothing is recomputed automatically; the photo page has a 「重新依時間分類」 button for the owner (only photos with a time, and only ones Kai never moved by hand: a `manual` boolean column, set by PATCH).

## Browser upload (`src/client/photo-upload.ts`)

- `<input type="file" accept="image/*,.heic,.heif" multiple>`; up to 3 uploads in parallel, progress per photo, a retry button on failure; leaving the page warns while uploads run.
- Per file: sha256 (Web Crypto) → EXIF with `exifr` (lazy-loaded, `pick: DateTimeOriginal, OffsetTimeOriginal, latitude, longitude`) **before** decoding → decode with `createImageBitmap(file, { imageOrientation: "from-image" })`; if decoding fails and the type or name is HEIC/HEIF, lazy-load `heic2any` to convert to JPEG, then decode → canvas resize to long side 2048 (JPEG quality 0.85) and 480 (0.78) → `POST /api/my-photos`.
- Canvas output carries no EXIF, so the stored images contain no GPS; GPS lives only in the row.

## UI (photo-first, little text, per Aya's preference)

- **`/photos` page** (owner and viewers; others get the sign-in redirect or 401 notice): day chips across the top (`11/15（日）`, …, 「未分類」 for the owner), then a thumbnail grid per day, grouped under the activity name when attached. Tap opens the existing `PhotoViewer` (swipe, momentum, spring) with the caption. Owner only: the upload button (sticky at the bottom on phones), per-photo menu (移到別天 / 換活動 / 說明 / 刪除), the storage meter, and a 「誰可以看」 section (allowlist add/remove; viewer links create/revoke) shown only when `PHOTO_VIEWERS=1`. Not configured: 「照片儲存空間還沒設定」 card with the Vercel steps.
- **每日 tab**: for allowed people only, each day ends with a 「我的照片」 thumbnail strip (horizontal scroll, up to 12 + 「全部」 linking to `/photos?day=…`). Hidden when the day has none.
- **Header**: allowed people get a 照片 link in the site header (walk page and planner), never on share-link pages.
- **畫廊 tab**: allowed people get a two-way switch 「景點照片 / 我的照片」. 我的照片 uses the same drift field fed by thumbnails (full image on tap), with day chips to filter.
- The server pages pass `photoAccess: "owner" | "viewer" | null` to `TripApp` and `WalkView`, so the client fetches `/api/my-photos` only when allowed. Guests fetch nothing.
- The photo page and owner tools are Chinese only, like the other owner tools (e.g. 新增活動 in 每日); viewers see almost no text (photo-first).

## Privacy tests (extend `tests/schema-privacy.test.ts`, new `tests/my-photos.test.ts`)

- Guest (signed out), stranger (signed in, not allowed), and trip share token: every `/api/my-photos*` route returns 401 with an identical body whether 0 or N photos exist.
- `/api/public`, `/api/s/<token>`, the public page props and the walk page props contain no photo id, `trip-photos/`, caption text or count, with photos present in the DB.
- `PHOTO_VIEWERS` unset: allowlisted id and a valid viewer cookie both get 401; set: they get 200 and no `lat`/`lng`/`usedBytes`; a revoked link gets 401.
- `signIn` callback: unset flag = only owners; set = owners + allowlisted GitHub id/verified Google email; unverified email refused.
- Upload: non-JPEG bytes, oversize, cross-origin, and stranger are refused; duplicate sha returns the same id; `dayDate` and `itemId` come from the server's computation.
- Pure tests for `photo-day.ts`: EXIF with and without offset, file-name dates (DJI, IMG_, plain), dates outside the trip, item windows, overlaps and GPS tie-break.
- Blob calls are mocked (`vi.mock("@vercel/blob")`); no test touches the network.

## Verification

```
cd web && npm run typecheck && npm run lint && npm test && npm run build
```
Expected: all pass (242 existing tests + new ones).

Manual (dev server, owner session, Blob not configured): `/photos` shows the not-configured card; `/plan` and `/` render as before; guest view of `/plan` makes no `/api/my-photos` request (network log). With a configured store (after Kai creates it): upload the 16 photos from 11/15 (DJI exports without EXIF): all land on 11/15 by file name; move one; delete one; view on a phone width.

## Deployment

1. Merge to `main` with `--no-ff` after tests pass (photos stay owner-only while `PHOTO_VIEWERS` is unset; the coordinator asked to hold viewer sign-in for Kai's choice, which this flag does).
2. `npm run db:migrate` against Neon (adds three empty tables; nothing else changes).
3. Kai, in Vercel: project → **Storage** → **Create Storage** → **Blob** → name `aya-photos` → **Continue** → access **Private** → tick **Add a read-write token env var to this connection** → **Create**; then Redeploy. No keys are shared with me.
4. Later, for Aya: set `PHOTO_VIEWERS=1`, and either add her Google email (plus `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` and the Google OAuth redirect `https://aya-travel-australia.vercel.app/api/auth/callback/google`) or create a viewer link.

## Risks

- Hobby Blob limits: the 950 MB guard and the meter; a month with more than about 1,000 uploads hits the 2,000 advanced-operation limit (two puts per photo). If that matters, store the thumbnail only on demand. Accepted for now.
- iOS Safari often converts HEIC to JPEG on selection and may drop EXIF time in some share paths; file-name dates and 「未分類」 cover it.
- next-auth v4 sign-in change is the only touch to existing auth; it is behind `PHOTO_VIEWERS`.
- `heic2any` (0.0.4) is old and large; it is lazy-loaded only on HEIC decode failure.

## Sorting stage, categories and export (2026-11-20, second pass)

Kai asked to apply a third-party guide for a local photo sorter (an HTML page that piles photos up, flies them into folders, classifies through a Claude chat and exports). Its ideas are applied to this feature; its text, branding and colours are not copied. The site's own paper, ink and vermilion style is kept.

- **Sorting stage** (`src/components/SortStage.tsx`, owner only, on `/photos`): pick photos, pick a folder (`webkitdirectory`), or drop files and folders anywhere on the stage (folders are read with `webkitGetAsEntry`, calling `readEntries` until it returns nothing). Each photo is read four at a time: fingerprint, EXIF and a 96 px preview. The photos form a sunflower-spiral pile that turns once every 120 s. 「開始整理」 throws each one along a quadratic Bézier into its card: one card per trip day (11/3–11/27), plus 未分類 and 重複. Counters show photos, days and duplicates. Uploads then run in the background, three at a time, with a progress bar on each card.
- **Motion rules:** layout is measured once at the start. Start points come from the pile's rotation angle (its Animation's `currentTime`). Flights are 12-step Web Animations on `transform` and `opacity`, lasting 900–1300 ms with `cubic-bezier(.45,.05,.25,1)`. Launch times follow `D × (i/N)^0.6`, where `D = clamp(4 s, N × 25 ms, 20 s)`. Counters are written once per animation frame, and a card glows at most once every 250 ms. A token cancels a run that was reset. With reduced motion there is no spin and no flights: counts appear directly and the stage uses 200 ms fades. Messages are inline or toasts, never `alert`.
- **Day preview:** the stage uses the same pure functions as the server (`exifLocal`, `fileNameLocal`, `dayFor`). The server still decides the day on upload.
- **Duplicates:** the client fingerprint is `size:sha256` over the first, middle and last 64 KB. It is stored in `trip_photos.fingerprint`, unique per trip (migration `0004_photo_sorting.sql`). A duplicate is caught three ways:
  - earlier in the same batch;
  - already uploaded, checked through `POST /api/my-photos/check` (owner);
  - on the server, which compares the full-file sha256 or the fingerprint.
- **Screenshots:** a file name like Screenshot, Screen Shot, 螢幕截圖, 截圖, スクリーンショット or screen recording gets the category 截圖 and waits in 未分類, even when its date is known. 「重新依時間分類」 leaves screenshots alone.
- **Categories** (`trip_photos.category`): 風景、美食、合照、動物、住宿、交通、截圖、其他.
  - **Classify panel:** 「用 Claude 分類」 (owner). Step 1 downloads numbered contact sheets: 7 × 224 px columns, at most 49 photos per sheet, `#n` in the top-left corner; one sheet downloads as a JPEG, several as a ZIP. Step 2 copies a prompt for a Claude chat Kai already uses. Step 3 reads the pasted reply.
  - **Reply parser** (`parseClassification`): it reads `{"1":"美食"}`, `{"results":[{id,category}]}`, a bare array, and lines such as `#1：美食`, `1. 美食` or `1 - 美食`. It matches names exactly first, then by containment, and falls back to 其他. Batches add up, and the numbering survives a reload in `sessionStorage`.
  - **Skip:** 「略過」 puts every unclassified photo in 其他.
  - **Saving:** `POST /api/my-photos/categories` (owner, up to 500 per call) saves the batch. The edit sheet also has a category field. No API key and no paid model call is involved.
  - **Filters:** category chips filter 我的照片 and the gallery's 我的照片 mode.
- **Export** (owner, `src/client/photo-export.ts`, `src/domain/zip.ts`):
  - **ZIP:** one day or all, built from the display copies. It is an uncompressed (STORE) ZIP with UTF-8 names. Each file's CRC is computed and the file is then added as a Blob, with no big in-memory copy. There is one folder per day (`2026-11-15 第13天/1320 IMG_….jpg`, plus `未分類/`), and repeated names get ` (2)`.
  - **CSV:** 檔名, 日期, 天數, 分類, 活動, 時間, 說明, with a UTF-8 BOM. Cells that start with `= + - @` are quoted so spreadsheets do not run them.
- **Not in this version:** videos (Blob Hobby storage is about 1 GB). If a video is picked, the stage says how many were skipped.
- **Privacy:** unchanged. The new endpoints are owner-only and give guests and strangers the same 401. Viewers see the category of sorted photos only.

## Apple-design pass (2026-11-20, before launch)

- Press feedback on pointer-down for chips, the source switch, day strips, edit buttons and cards (`scale(.97)`, 100 ms). Buttons already had this.
- The sorting stage can be interrupted. A tap on the stage or 「略過動畫」 lands everything still in the air and starts the uploads. 「重來」 cancels the flights through the run token and returns every photo to the pile. A card gives a small under-damped bounce when a photo lands; the bounce comes from the throw's momentum.
- Viewer: it already opens from the tapped thumbnail and closes back into it. Its swipe already tracks the finger 1:1 from the grab offset, projects the release velocity, and rubber-bands at the ends. Swipe-down closes it, with the scrim dimming as you drag. The page decision now lives in `swipeStep` in `motion.ts` and is unit-tested.
- 分類 and 下載 open as bottom sheets on a translucent material that rises from the bottom edge and leaves the same way. The classify task dims the page; the download sheet does not. Reduced transparency makes the sheet solid; reduced motion turns the slide into fades.
- Wayfinding: the gallery's 我的照片 mode links to /photos (「整理與下載 ›」); the header links back to 行程 and 散步.

## PDF layout and local classification (2026-11-20, third pass)

- **Layout:** /photos follows the look of the guide Kai sent: a header with the owner's name and one main button (加入照片, 分類, 開始整理, 下載), a stats row (總照片, 已分天, 天數, 未分類, 重複), day cards in two columns around a central pile with rings, and a 設定 panel on the right (add, classify, export, look, who can see). A navy and a light skin are kept in `localStorage`. The site's fonts are used; no text, branding or images from the guide are copied. `src/components/Sorter.tsx` replaces `SortStage.tsx`. Clicking a day card opens that day's photos.
- **Export to a folder:** 「存到資料夾」 (Chrome and Edge, `showDirectoryPicker`) writes one sub-folder per day; ZIP and CSV stay.
- **Local classification on Kai's Mac:** originals go in `照片待分類/` next to the repository, never inside it. `npm run photos:scan` fingerprints them with the browser's function (`fingerprintOf`), reads the day from EXIF or the file name, and writes numbered contact sheets and a manifest to a temp folder. Claude looks at the sheets and writes the answers; `npm run photos:apply -- <file>` stores them in `photo_labels` (migration `0005_photo_labels.sql`, keyed by trip and fingerprint, source `local-claude`). Nothing is uploaded by the script.
- **How labels are used:** `POST /api/my-photos/check` returns the labels for the fingerprints it is asked about, so the sorter shows the category before upload. On upload the server applies the label's category, and the label's day when the photo is not a screenshot. `saveLabels` also back-fills photos already uploaded: the category only where it is empty, the day only when it was not set by hand.
- **Checks:** `tsc` clean; `vitest` 263/263, including fingerprint parity between the script and the browser; `next build` passes. Codex review still unavailable until 2026-11-25.

## Videos (2026-11-21, fourth pass)

Kai asked for videos as well as photos (「影片也要，不能只有照片」).

- **Storage limit:** Vercel Blob Hobby includes 1 GB of storage and 10 GB of transfer a month. Going over is not billed, but it blocks the store for 30 days. One setting, `STORAGE_LIMIT_BYTES` in `src/domain/video.ts`, holds the limit. Uploads stop at 90 % (900 MB) and a warning shows from 75 % (750 MB). The server checks the limit before it issues a video token, and again when it finishes a video. The 設定 panel shows a meter: 已用 x MB / 1 GB, with the stop line marked. Raise the setting after moving to Pro.
- **Which files:** mp4, mov, m4v and webm (including DJI files) are accepted from pick, folder or drag. Other video formats are counted and skipped. Videos fly into the day cards like photos, with ▶ on the tile. The stat bar reads 總檔案 / 影片 / 照片 / 天數 / 重複.
- **Day:**
  - First choice is the time in the file header: `com.apple.quicktime.creationdate` with its zone, or the UTC creation time (read as +00:00).
  - Second choice is a date in the file name. `DJI_YYYYMMDDHHMMSS` is now read as well.
  - Otherwise the video goes to 未分類.
  - Duplicates are caught with the same fingerprint as photos.
- **Poster frame:** taken at min(1 s, 15 %). It becomes the display JPEG and thumbnail, and it stands for the video on the contact sheets (marked ▶) and for the Mac classifier.
- **Compression in the browser (`src/client/video-upload.ts`):**
  - Videos are converted with Mediabunny (WebCodecs; it loads only when a video is picked) to MP4 H.264, long edge 1280, about 1.8 Mbps, with AAC 128 kbps. That is about 15 MB a minute.
  - A small MP4 with H.264 (1280 or less, 2.5 Mbps or less) is only re-packed, not re-encoded.
  - If the browser cannot encode, a video of 50 MB or less is re-packed. Anything bigger shows 「請放進 Mac 的照片待分類，我幫你壓縮」.
  - Only the creation time is kept from the original's tags, so stored videos carry no GPS, like the photos.
- **Upload:**
  - The video goes straight from the browser into the private store with a one-video token from `POST /api/my-photos/video/token`.
  - That route is owner only. It checks the path pattern, the declared size (500 MB at most) and the room left, and caps the token at the room left. It handles only token requests; there is no completion callback.
  - Files over 100 MB go up in parts.
  - `POST /api/my-photos/video` then sends the poster, the thumbnail and the details. The server confirms the file is in the store and is a video, checks duplicates and the limit, and deletes the stored file on any refusal.
  - Photos upload three at a time first, then videos one at a time.
- **Playback:** `/api/my-photos/<id>/video` checks access exactly like a photo, then redirects to a signed link that is valid for 30 minutes. The store serves byte ranges, so seeking works. The viewer plays the video with controls, `playsInline` and no autoplay, and pauses it when you swipe away. Downloads (ZIP or 存到資料夾) stream the stored file through `/api/my-photos/<id>/download`. The CSV gains 類型 and 長度 columns.
- **Mac route:**
  - `npm run photos:scan` also handles videos in 照片待分類. It reads the time with ffprobe (Spotlight's date when ffprobe is missing).
  - It writes a 720p copy into `照片待分類/已壓縮/<name>.mp4`, using ffmpeg when installed and macOS avconvert (Preset1280x720) otherwise. Only the creation time is carried over.
  - It takes the poster for the contact sheet.
  - `photos:apply` stores the label under the original's fingerprint and under the copy's fingerprint.
  - When a folder holds both an original and its copy in 已壓縮, the sorter keeps only the copy.
- **Data:** migration `0006_photo_videos.sql` is additive. It adds `media_type` (default 'photo'), `video_path` and `duration_ms`. `bytes` now includes the video.
- **Privacy:** every new route gives guests and strangers the same 401, and the leak test covers them. Guests never get a redirect or a store path. Viewers reach only videos that are sorted into a day, as with photos.
- **Checks:**
  - `tsc` clean; `eslint` shows only the 5 problems already on `main`; `vitest` 268/268 (31 photo and video tests); `next build` passes.
  - The Mac scan was run on generated test-pattern videos (a MOV with a zone and GPS tag, and a DJI-named MP4). Its copies came out H.264 1280×720 at about 1.8 Mbps with no location tag.
  - The sorter was run locally at 1440 px and 375 px with generated test media. Browser compression ran to 100 %. Real uploads cannot be tested locally because there is no store.
  - Codex review is still unavailable until 2026-11-25.

## Review status (2026-11-20)

- Built on branch `feat/my-photos` from `f28aef0`.
- Independent Codex plan review and code inspection did not run: the first attempt timed out, the second stopped on Codex's usage limit (resets 2026-11-25). Neither the plan nor the code has independent approval yet.
- Host checks: `tsc` clean; `eslint` shows only the 5 problems already on `main`; `vitest` 253/253; `next build` passes; owner UI checked locally at phone width with the store not configured.
- Second pass (sorting stage, categories, export) built on the same branch. Codex review again not possible before the quota reset on 2026-11-25. Host checks: `tsc` clean; `eslint` only the 5 problems already on `main`; `vitest` 260/260 (18 photo tests); `next build` passes; ZIP output checked with `unzip -t`. The sorting stage was run locally at 375 px with 84 placeholder images (gradients, no people, including 3 duplicates, 4 screenshots and 5 undated files); uploads were stubbed in the browser so nothing left the machine.
- Launched on Kai's go (「上線讓我在網站測試」, 2026-11-20) without the Codex review, which stays unavailable until 2026-11-25. Rerun it then.
