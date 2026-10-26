# Plan 2026-10-26e: day titles follow the day's activities

Kai: "每日行程裡的標題會依據當日摘要來做變更，而不是固定叫什麼，因為我把當日行程都清空了，標題應該要改成 未規劃".

## Behaviour (`src/domain/day-title.ts`)

- **No plans → 「未規劃」.**
  - Stay notes (「住宿：…」) do not count as plans.
  - Flights do count: a travel day is a planned day.
- **Otherwise the title is built from the main activities:**
  - Logistics (taxis, trains, check-in, going back to the hotel) are skipped when the day has anything else.
  - Major activities come first, must-dos first among them. If there are none, must-dos; if none, any plan.
  - Driving days read 「first → last」; other days show the top two joined with 「・」.
  - Names are shortened (no bracketed notes, at most 14 characters each, 18 in total).
  - Kai's shifts show as 「Kai 工作」.
- **Pinned titles:**
  - The owner can pin a custom title (`setDayTitle`, which sets `titlePinned`); an empty title unpins it.
  - 「清空這天」 releases the pin, so an emptied day reads 「未規劃」.
- **Where titles show:** the day header, calendar caption and labels, map day strip, pool date pickers, version list, checklist, and the walk page's day data (`domain/walk.ts`).
- **Privacy:** titles are computed from whatever document the viewer has, so guests' titles come from the redacted document.
- **Stored data:** stored `title` values are no longer shown unless pinned, so no data change is needed.
- **Option days** (跨日行程方案 detail) keep the plan's own day titles.

## Acceptance

- Tests: an empty day reads 「未規劃」, main stops are used, length limits hold, pin/unpin works, 清空這天 releases the pin, and guest titles contain no driver, friend or employer names.
- tsc, lint, tests and build all pass.
