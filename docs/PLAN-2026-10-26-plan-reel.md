# Plan 2026-10-26b: 推薦行程方案 photo reel

Kai: "改成推薦行程方案，用這個來呈現不同方案（React Bits Pro Elastic Reel）… 不同方案有對應的主要景點照片也有不同背景顏色，點擊方案下方會顯示詳細資訊與對照的景點照片，背景也會切換成對應的背景顏色".

Builder: Claude. Plan review and inspection: Codex.

## Decision: our own reel, not the Pro package (option A)

- The official component (`npx shadcn add @reactbits-starter/elastic-reel-tw`) needs three things this project lacks:
  - a React Bits Pro licence key (`REACTBITS_LICENSE_KEY` is not set on this Mac);
  - Tailwind (not installed; the site uses plain CSS tokens);
  - a shadcn `components.json` (absent).
- Kai is asked to choose A or B. Until then, the coordinator chose A: an original CSS/React "photo slices that swell open" component with the same behaviour and no key or Tailwind.
- It is isolated in `src/components/PlanReel.tsx` behind a small props API, so the official component can replace it if Kai picks B.
- No React Bits code is copied.

## Scope

- **Tab** `options` is renamed to 「推薦行程方案」. The key stays `options`, so `?tab=options` links keep working.
- **`PlanReel`** takes these props:

  ```ts
  { slices: { key; title; caption; image?; deep; label }[]; active: string; onSelect(key) }
  ```

  - **Desktop (>720px):** a horizontal row of slices, 380px high.
    - Collapsed slices use `flex-grow: 1` and show a vertical title (`writing-mode: vertical-rl`).
    - The active slice uses `flex-grow: 6` and shows the full photo, with a caption (title, N天N夜, region, dates) over a dark scrim.
    - Hovering or focusing a collapsed slice swells it to `flex-grow: 2`.
    - The transition uses an overshoot curve: `cubic-bezier(.34,1.4,.64,1)`, 650ms.
  - **Phone (≤720px):** a vertical stack. Collapsed slices are 64px rows; the active slice is 260px tall, with a height transition. Tap selects.
  - **No photo:** the slice is filled with the plan's `deep` colour plus the line-art SVG.
  - **Accessibility:**
    - Slices are `role="tab"` buttons in a `role="tablist"`, with `aria-selected`, roving tabindex and Arrow, Home and End keys.
    - Details render in `role="tabpanel"`.
    - Each slice is at least 44px in its collapsed dimension.
  - **Reduced motion:** no grow or height transitions, and no background crossfade.
- **Per-plan colours** (`optionPalette(option)` in `domain/options.ts`):
  - Colours derive from the paper/ink/vermilion palette, by keyword in title or region:

    | Plan | `deep` | `tint` |
    |---|---|---|
    | 東海岸 (sea blue-grey) | #3d5a66 | #e3eaec |
    | 搖籃山 (moss) | #445a3b | #e5eadf |
    | Stanley / Penguin (sand) | #7a6236 | #f1e9da |
    | Bruny / Huon (forest) | #2f4a3a | #dfe8e1 |
    | Maria (ochre) | #7f5222 | #f2e4d3 |
    | fallback (ink) | #3d3a33 | #ece8df |

  - `deep` carries white text at AA (≥ 4.5:1). Page text stays `--ink` on `tint`, which is also ≥ 4.5:1.
  - A unit test checks the WCAG contrast of every pair.
- **Selection:**
  - The default is the chosen plan, else the first one.
  - Selecting a plan sets `--plan-tint` on the options panel stage, and its background crossfades (`transition: background-color 600ms`).
- **Details** under the reel (the existing card content, reorganised):
  - Title, N天N夜 and themes.
  - Facts: dates, drive hours, cost, and 想去 for the owner.
  - Route summary, stays with prices, avatars.
  - Per-day stops, each with its photo (owner and share links only) and a credit link (`PhotoCredit`). This is the "對照的景點照片".
  - Owner actions 「套用到 …」 (applyOption, undoable), 「在地圖上看」 and 「看每日行程」. Guests get 分享.
- **Filters** (days, theme, region) stay above the reel and filter its slices.
- **Privacy:** reel data comes from the same public document, so there are no driver or friend names, and photos follow the existing photos rule.

## Acceptance

1. The tab label reads 推薦行程方案, and the reel shows 3 slices on production.
2. Clicking or keyboard-selecting a slice swells it and switches the details and the panel background colour.
3. A phone width (375px) shows the vertical stack with no horizontal scroll, and tapping a row expands it.
4. Reduced motion means instant changes.
5. The contrast test passes, and there are no hydration errors.
6. tests, lint, tsc and build all pass.

## Verification

- Unit tests: palette contrast, and `optionPalette` keyword mapping.
- Manual: a local guest preview (PGlite copy of v89) at desktop and 375px, then a production check.

## Revision 1: Codex review dispositions

- **PLANREEL-001, accepted.** Option A is **provisional**. It ships as the substitute until Kai answers A or B. If Kai picks B, `PlanReel` is swapped for the official component behind the same props, and this plan is updated.
- **PLANREEL-002, accepted.** `aria-orientation` follows the 720px breakpoint (via `matchMedia`). The arrow keys already work both ways.
- **PLANREEL-003, accepted.** Collapsed titles sit on a solid `rgba(0,0,0,.72)` backing. White text on that backing, even over a white photo, is above 9:1.
- **PLANREEL-004, accepted.** The cover is a `Photo` object. An option's own URL is credited to its site, and the reel shows 「封面照片：<credit>」 under it.
- **PLANREEL-005, accepted.** Chosen status shows on every slice, open or not: a vermilion dot, plus 「（目前採用）」 in the spine text. The viewing selection is separate from the stored `chosen` flags.
