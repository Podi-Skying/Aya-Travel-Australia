# UI density review log

Scope (Kai, 2026-10-23): itinerary pages only — `/plan` overview, calendar + day detail, map & places, budget, info, versions/share. The home walk (`/`) and `/journey` are out of scope for now.

## Round 1 — independent findings (2026-10-23)

**Codex (read-only):**

1. Activity cards show every badge, source, cost, long note and owner button at once.
2. Day header repeats the region and stacks feasibility, check, driver, transfer, ferry and hike badges plus four stat blocks.
3. The map panel's filters (search, region, layers, ten categories, in-view toggle) push the list and the selected card down.
4. The place card shows photo, tags, long note, map link and scheduling all expanded.
5. The overview repeats stats, a long to-do list, the must-see list and driver details.
6. The info page is a wall of sources, reminders, legend, principles and privacy text.
7. The budget page runs summaries, two charts and a six-column table in sequence.
8. (Walk home page — out of scope.)

**Claude:**

- Agrees with 1–7.
- Also: scheduled-stop popups on the map were text-only.
- Also: 14 pool places and several scheduled stops had no photo, so recognition relied on text.
- Also: the budget silently added a daily meal allowance, which made empty days look expensive.

**Reconciled fixes:**

- **Activity card:** one primary line (time, name, one badge only when *必去* or *暫定*), a mode + price meta line, and a 104×78 photo thumbnail (144×108 on desktop).
  - Notes are clamped to two lines with 「更多」, except ⚠ warnings, which always show in full on a highlighted background.
  - English name, verify/priority badges, source, cost basis, photo credit and package context move into 「更多資訊」.
  - Owner controls move into 「管理」.
- **Day header:** a 168px hero photo (the first major stop with a photo).
  - Only actionable badges stay visible: reminders and driver status.
  - Two facts remain visible (day cost, tonight's stay); the rest moves into 「當日摘要」.
- **Map panel:** search stays visible; categories and the in-view toggle sit behind 「篩選」 with the active choice shown on the button.
  - Selecting a place shows its card first, with 「返回清單」 instead of the list.
- **Place card:** 16:9 photo capped at 180px; note clamped to two lines with 「更多」.
- **Scheduled-stop popup:** 88×66 photo, date and day title, stop name, 「查看當天行程」, and photo source.
- **Overview:** must-see stops become photo cards (first six; the rest behind 「看全部」); to-do shows three items with the rest collapsed; driver details are collapsible.
- **Info:** legend, principles, privacy and TBD are collapsible; warnings and official sources stay open.
- **Budget:**
  - Line items are collapsible.
  - The page explains 「金額依活動計算」.
  - The daily meal allowance is removed: empty days cost $0, and meals count only as activities.
  - The total went from AUD 6,577.67 to AUD 3,747.67.
- **Photos:** 50 more Wikimedia Commons photos were added (pool coverage 49 of 63). Mismatched automatic matches (e.g. a fish photo for Salmon Ponds, list pages, a different country's lake) were rejected by hand.

**Not changed (safety):** driver, ferry, work-shift and flight-buffer warnings stay fully visible.

## Round 2 — Codex inspection of the implemented fixes (2026-10-23)

Codex confirmed that the round-1 fixes landed and that safety warnings stay visible. It flagged the issues below; all except the last are now fixed:

- The photo credit appeared both under the activity thumbnail and in 「更多資訊」 → the thumbnail no longer shows a caption. The credit stays in 「更多資訊」 and in the photo viewer.
- The day hero repeated the first activity's thumbnail → the hero's activity skips its thumbnail.
- 「更多」 buttons were 32px and popup links 36px → both are now 44px.
- Focus was lost when a list row opened the place card (the row unmounts) → focus moves to the card's close button. Closing the card or using 「返回清單」 returns focus to the row.
- The overview was still long → it now shows 4 must-see photo cards instead of 6.
- **Not changed:**
  - Notes still clamp by character count rather than measured lines (good enough for Chinese text at these widths).
  - Share-link visitors receive photos by design (Kai's decision; the anonymous public pages still do not).
  - The overview timeline's 28px day cells predate this review and stay as they are.

No round 3 was needed.
