# Apple-design audit of the whole site, 2026-11-01

Kai asked: 「/apple-design 請撤底檢查整個網站並優化」. This replaces the phone-only audit started on 2026-10-31.

## What was checked

- **Measured live, signed out:** home walk, 每日行程, 行程方案, 地圖, 資訊, 小測驗, 畫廊.
- **Tools:** Lighthouse (mobile, simulated slow 4G) on 4 pages; axe-core on all 6 tabs; a tap-target, sideways-scroll and input-size scan.
- **Viewports actually viewed:** 375 and 768 px. Lighthouse used its 412 px phone.
- **Languages:** 繁中, English and 日本語 in the tab bar and plans page.

**Not checked live:** the owner editor (needs Kai's sign-in, code review only), a working share link (I have no live token), 390, 430, 1024 and 1440 px, and the login page. There is no dark theme to check: the site is light paper and ink by design.

## Before and after (live, signed out)

| Page | Performance | Accessibility | Best practices | LCP | CLS | TBT |
|---|---|---|---|---|---|---|
| Home | 56 → 54 | 98 → 98 | 96 → 100 | 11.8 → 6.5 s | 0 → 0 | 0 → 670 ms |
| 每日行程 | 40 → 68 | 94 → 97 | 96 → 100 | 12.5 → 9.2 s | 0.07 → 0.09 | 610 → 160 ms |
| 行程方案 | 35 → 51 | 100 → 100 | 75 → 79 | 13.3 → 11.8 s | 0 → 0 | 1,560 → 720 ms |
| 地圖 | 34 → 64 | 96 → 97 | 93 → 96 | 12.8 → 10.3 s | 0 → 0 | 1,450 → 200 ms |

First contentful paint went from 3.4–6.4 s to 1.2–1.4 s. Lighthouse's numbers vary between runs, so small differences mean little. The home page's TBT rose from 0 to about 670 ms: with the font no longer blocking the page, the walk's build now falls inside the measured window. Its first paint and LCP are much better.

**axe:** 3–5 rules per tab before (including 1 serious rule with up to 10 nodes). After the first round: 1 moderate rule on every tab, plus 1 serious rule on 資訊 caused by my new scrolling table. Both are fixed in the final commit; see the report for the final recount.

## Findings

### High (fixed)

1. **Tabs out of thumb reach and hidden sideways on phones.** Now a bottom tab bar with icon and short label, above the home indicator. Wider screens keep the top tabs.
2. **Header and sticky calendar covered 38% of a phone screen** while reading a day. The calendar scrolls away; 前一天 / 後一天 also sit at the end of each day.
3. **246 px of chrome before any content on phones.** Header is 56 px, dates and countdown one line, smaller notice.
4. **A blocking CJK web font cost about 6 s to first paint.** Body text uses the system font; one weight of the heading serif loads after paint.
5. **All tabs mounted on load.** Each tab now mounts when first opened and then stays.
6. **React hydration error on every page.** Sync times printed in the server's and the viewer's time zones; now always Hobart time.

### Medium (fixed)

7. Full-size Commons photos up to 1.6 MB on cards: now 500 or 960 px versions.
8. The first plan and day photo were lazy-loaded though on screen: now loaded first.
9. Day maps trapped page scroll on phones: one finger scrolls the page, two move the map, with a hint.
10. No not-found, error or loading pages: added, with a way back to the trip, in all three languages.
11. Accessibility: weather chips had a label on a role-less element, invalid role on an article, heading levels skipped, duplicate banner landmark, content outside landmarks, plan cards' names not matching visible text.
12. Day-map checkbox shared a class with the map page's floating toolbar and could land on the calendar.
13. Aurora table clipped on phones: scrolls in its own box and is keyboard reachable.
14. Form fields under 16 px on phones (iOS zoom): now 16 px. Text size follows the browser setting (rem).
15. Tab fade .35 s: now .18 s. Hover zoom could stick after a tap: now pointer devices only. Tap delay and highlight removed.
16. Home closing screen flashed before the walk was built: hidden until ready.

### Low or not fixed

- **LCP is still 6.5–11.8 s on simulated slow 4G.** Large external photos (one is 862 KB) are not ours to resize. A resizing image proxy would help but is a separate piece of work.
- **行程方案 best practices 79:** third-party cookies from an external photo host.
- **Home walk:** about 2,800 elements and 670 ms of blocking while it builds. Needs lazy building of later days.
- **Walk stops' labels** add 「走到」 before the visible text, and the walk skips a heading level. Minor.
- **Map marker tap areas** flagged by Lighthouse's overlap check when markers are close together.
- **行程方案 intro text** takes about 200 px on phones.
- **Gallery photos under 44 px:** a drifting 3D field, small on purpose. **Map attribution links:** required, rarely tapped.
- **Bottom-sheet detail views** beyond the map's: day detail stays a page.

## 2026-10-27 audit: status

All of its 8 items stay fixed, with one change: the language hold (item 2) still works. The 44 px hit areas it added (item 6) remain, though Lighthouse measures the drawn size for some. Nothing from it is open. Its "not changed" list still stands (no dark mode, desktop calendar cells at 39 px, slow wave drift).

## Privacy

Unchanged. A new test checks the public document hides addresses, the home name, driver names, flight numbers (owner notes) and every stay's position. **Open question for Kai:** the public site does show hotel names and the map position of hotel-related stops (the same for every hotel), which I flagged on 2026-10-27. Not changed here.

## Screenshots

In `docs/apple-audit-2026-11-01/`. The "before" phone shot was taken while the tab was still fading in.
