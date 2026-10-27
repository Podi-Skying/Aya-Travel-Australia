# Apple-design audit, 2026-10-27

Kai asked: 「/apple-design 分析並優化目前的網站」. The live site was checked at desktop (1280 px) and phone (375 px) widths, in 繁中, English and 日本語:

- Walk home page.
- 每日行程, 行程方案, 地圖與景點 and 資訊與警示 in the public view.
- The share link, checked on a local copy.

The owner-only tabs (旅遊規劃小測驗, 畫廊, editing) need a sign-in and were checked in code only.

Each tab was scanned for horizontal page scroll and for tap targets under 44 px. Motion and typography were checked against the apple-design rules. Screenshots are in `docs/apple-audit-2026-10-27/`.

## Already in good shape (kept)

- **Gestures.** The calendar, place sheet and photo viewer use critically damped springs with momentum projection and rubber-banding (`components/motion.ts`). Motion can be interrupted. There is no bouncy overshoot left.
- **Press feedback.** Buttons, chips, tabs, calendar cells and place rows scale on press (`:active`, 100 ms).
- **Header.** It is translucent with a blurred background and a scroll-edge fade instead of a hard divider. There are fallbacks for reduced transparency and higher contrast.
- **Reduced motion.** It is respected everywhere: slides become short fades.
- **Typography.** Headings are tight (−0.02 em, line-height 1.12–1.25). Body text is comfortable (0 tracking, 1.6–1.65).
- **Width.** No page scrolls sideways at 375 px on any tab.

## Findings, ranked by impact

| # | Impact | Finding | Fix |
|---|---|---|---|
| 1 | High | **Header on phones (walk page) overflowed.** With the language switch added, 「日本語」, 「散步」 and 「行程」 broke onto two lines (`before-walk-375-header.jpg`). | The labels never wrap. Under 480 px the switch shows 中 / EN / 日, with the full names kept for screen readers, and the header gutters tighten. Every target stays 44 px. |
| 2 | High | **Chinese flashed before English or Japanese.** The server renders 繁中, and the page switched language only after loading. | A tiny script in the page head reads the saved language before the first paint. It holds the page until it is translated, at most 2.5 s, and sets `html lang` right away. |
| 3 | High | **Walk headline in English read "through every dayevery day."** One phrase was pieced together from fragments, and 「接著塔斯馬尼亞」 stayed in Chinese (`before-walk-375-en-hero.jpg`). | The headline and intro are written per language, with the emphasis on the right words (`after-walk-375-en.jpg`, `after-walk-desktop-ja.jpg`). |
| 4 | Medium | **The first stop's label sat behind the walk intro text**, so the two collided on phones. | A soft paper glow behind the headline makes the label recede. |
| 5 | Medium | **Place photos only changed after the finger lifted.** Nothing followed the finger. | The photo now tracks the finger 1:1. A throw is projected from its speed to decide the change; otherwise the photo springs back. A single photo resists with rubber-banding. A vertical drag still scrolls the page. |
| 6 | Medium | **Tap targets under 44 px:**<br>• date links in 資訊與警示 (23 px)<br>• links inside activity details (19 px)<br>• weather and aurora source links<br>• 「依分組檢視」 (26 px)<br>• map cluster markers (32 px)<br>• the sheet's grab handle (28 px)<br>• 「更多」 (42 px wide)<br>• the skip link (42 px) | Each hit area is enlarged to 44 px without changing how it looks. |
| 7 | Medium | **Tour details on phones** put the departure point in a narrow column (one word per line). | The departure takes its own full row. |
| 8 | Low | **English sentences split across two pieces of text lost their space** ("details.The"). | A space is added after a translated sentence. |

## Not changed, and why

- **Dark mode.** The site is intentionally light paper and ink (DESIGN.md), and it looks the same everywhere. Adding a dark theme is a design decision for Kai, not a fix.
- **Calendar day cells are 39 px on desktop.** The month grid sets their size. A mouse pointer is precise, and on phones the cells are larger.
- **Walk-page background waves drift slowly.** This is part of the hand-drawn look. They stop under reduced motion.
- **Owner-only tabs (quiz, gallery, editing).** I could not sign in to check them live (I never sign in for Kai). They use the same motion and press-feedback rules as the rest.
- **No changes to features or trip data.**
