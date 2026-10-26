# Plan 2026-10-26f: one top bar, banner only, new site name

Kai (/apple-design) asked for:

1. The planner's tabs in the top bar, with login/logout.
2. Below the bar, only the banner (出遊時間 + 倒數).
3. The site renamed 「2026澳洲旅程with Aya」 everywhere.
4. The same structure for guests, minus owner-only tabs.

## Built

- **Top bar** (`SiteHeader` with `children`):
  - The planner passes its tab list (each tab a `role="tab"` button, with roving focus and Arrow, Home and End keys), which replaces the 散步/行程 links.
  - **散步 stays reachable through the logo**, which links to the walk (title 「回到散步」, aria-label 「2026澳洲旅程with Aya，回到散步首頁」).
  - **Width ≥ 1000px:** one 56px row: logo · tabs (centred) · 登入/登出.
  - **Width < 1000px:** two rows. Row 1 is the logo and login (56px); row 2 is the tabs (48px) as a horizontally scrolling segmented row, with the selected tab kept in view and the edge fading.
  - Tabs have 44–48px targets and a vermilion underline when selected. They scale slightly on press (not with reduced motion).
  - The bar is sticky, with the translucent material (`backdrop-filter`). Under `prefers-reduced-transparency` the existing site-header fallback makes it solid.
- **Fixed chrome height:** `--chrome-h` (56px or 104px, plus the safe area) replaces the hard-coded offsets used by the banner, calendar, day map and map tab.
- **Banner:** only 出遊時間 and 倒數. Removed: the eyebrow, the big title (kept as a screen-reader-only `h1`), the subtitle, the tag chips, the region chips and 「回到散步」.
  - The region chips are removed, not moved (`domain/regions.ts` stays for a later home). Kai is told he can have them back elsewhere.
- **Name:** 「2026澳洲旅程with Aya」 in the logo, the layout default title, the page titles (walk, plan, share walk, share plan) and the web manifest (`short_name` 「2026澳洲旅程」).
- **Guests and share links** get the same bar without the owner-only 版本與分享 tab, with 登入 shown on the public home only.

## Also in this batch (data only, v93)

- 「Maria Island 遊船：Ile des Phoques 海豹島＋彩虹洞＋Darlington」 is in the pool as package `maria-cruise`. It is pending and not scheduled:
  - AU$250 per person (quote), 09:00–16:30 from Triabunna. The source is the Agoda activity 1021224 with tracking parameters removed.
  - Suggested for 11/14 (the car day): leave Hobart about 07:30. It would replace the self-guided ferry visit (Triabunna 搭渡輪, Darlington 遺址與袋熊, Painted Cliffs 彩繪懸崖). The $25 Hobart shuttle is not needed with the car.
  - Kai is asked whether JJ and Anita join and who pays.

## Checks

tsc, lint, tests and build pass. A local preview at desktop width (one row) and at 375px (two rows, 48px tabs, no horizontal scroll) looks right.
