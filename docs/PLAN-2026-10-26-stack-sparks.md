# Plan 2026-10-26i: React Bits Stack gallery and ClickSpark

## Stack replaces FlexCarousel (Kai)

- `src/components/stack/Stack.jsx` and `.css` are vendored verbatim from https://reactbits.dev/r/Stack-JS-CSS.json. They depend on `motion@12.23.12`, and types live in `Stack.d.ts`.
- `PlaceGallery`'s `Carousel` now renders Stack:
  - `layout="fan"`, `sendToBackOnClick`, in a 230×230 box;
  - cards are the place photos as `<img alt>`;
  - the same sources as before (own, Kai-supplied, cached Commons, live Google for the owner and share links), loaded when 看照片 is pressed.
- It is used everywhere the gallery was: 更多資訊, the map place cards, and each 跨日行程方案 stop. The plan-wide carousel uses it too.
- Input: click, drag or flick, and Enter, Space or the arrow keys all send the front card to the back. Under reduced motion, the component swaps cards without animation.
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
