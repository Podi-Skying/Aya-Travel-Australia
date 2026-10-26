# Plan 2026-10-26i: React Bits Stack gallery and ClickSpark

## Stack replaces FlexCarousel (Kai)

- `src/components/stack/Stack.jsx` and `.css` are vendored verbatim from https://reactbits.dev/r/Stack-JS-CSS.json. They depend on `motion@12.23.12`, and types live in `Stack.d.ts`.
- `PlaceGallery`'s `Carousel` now renders Stack:
  - `layout="fan"`, `sendToBackOnClick`, in a 230×230 box;
  - cards are the place photos as `<img alt>`;
  - the same sources as before (own, Kai-supplied, cached Commons, live Google for the owner and share links), loaded when 看照片 is pressed.
- It is used everywhere the gallery was: 更多資訊, the map place cards, and each 跨日行程方案 stop. The plan-wide carousel uses it too.
- Input: click, drag or flick, and Enter, Space, ArrowRight or ArrowDown send the front card to the back (the component's own keys). Under reduced motion, the component replaces springs with a short 0.2 s ease and turns off tilt, lean and press effects.
- A counter 「n / total」 follows the front card (`aria-live`). Below it are the front photo's source link icon and, for Google photos, the authors' names.
- FlexCarousel and `ogl` are removed.
- **Bundle (all client JS chunks):** 1,137,611 → 1,218,376 bytes (+80,765). `motion` is heavier than `ogl` and FlexCarousel together.

## ClickSpark everywhere

- `src/components/click-spark/ClickSpark.jsx` is vendored from https://reactbits.dev/r/ClickSpark-JS-CSS.json, with no dependencies. Local change: the spark layer's z-index is 2000, so sparks show above the fixed header.
- `Sparks` wraps the whole app in `layout.tsx` with `shape="line" sparkCount={8} sparkSize={14} sparkRadius={30} duration={500}`.
- Colour is vermilion `#d2483a`. Kai asked for white, which would be invisible on the paper background; this was agreed via the coordinator.
- It never blocks input: each burst draws on its own small canvas with `pointer-events: none`, and the listeners are passive. Maps keep dragging and text stays selectable.
- It is disabled under `prefers-reduced-motion`.
- Not done: white sparks over photo overlays (one colour only).

## Checks

- tsc, lint, 143 tests and the build all pass.
- Local share-link preview:
  - the Stack shows 「1 / 7」;
  - Enter and Space advance it to 2 / 7 and then 3 / 7;
  - a click creates a spark canvas with `pointer-events: none`.

## Inspection 1: dispositions (no second inspection; covered by checks)

- **R1, plan corrected.** The vendored Stack keeps its own reduced-motion behaviour: a 0.2 s ease with no springs, tilt or press. The component stays verbatim, and the plan text now describes this behaviour.
- **R2, plan corrected.** Stack handles Enter, Space, ArrowRight and ArrowDown. The component stays verbatim, and the plan text now lists those keys.
- **R3, accepted.** The whole gallery (Stack, counter and credit) is now keyed by the photo sources, so the counter resets when the list changes.

# 2026-10-26: quiz long drives and corner maps (Kai)

- **Long drives:**
  - A place more than 3 h one way from home (straight-line estimate, ×1.3 at 70 km/h) shows 「單程約 X 小時・建議過夜」.
  - A region where most places are like that shows 「建議過夜」.
- **Result step:** when a stop is over 3 h one way, or the day's driving is over 6 h, the quiz first asks 「當天來回」 or 「安排過夜（兩天）」.
  - **當天來回:** a warning with the total drive time and the late return time.
  - **安排過夜:**
    - Day 1 runs to the farthest stop and sleeps at a trip stay within 30 km, else at the nearest listed town, marked 「待找住宿」.
    - Day 2 visits the rest on the way home.
    - There are two maps; the home base marker appears only at the start of day 1 and the end of day 2.
    - The owner's 「加入連續兩天」 calls `addQuizPlan` with `nextRefs`: one version, with the second day's places on the following day.
- **Corner maps:**
  - Every quiz card shows a 60 px SVG map (48 px on phones): Tasmania, or the Derwent around Greater Hobart for the 荷巴特 region.
  - Places are vermilion dots and home is a small house.
  - The map is aria-hidden, with screen-reader text 「位置：<region>」. There is no Leaflet and no API call.
- **Not done:** cached Google road times are not used for the 3 h check, which uses the same estimate as the rest of the quiz.
