# Mobile audit, 2026-10-31

Kai asked: 「/apple-design 優化使用者手機介面」. The live site was measured signed out at 375 px in the iPhone-sized browser pane. The owner editor needs a sign-in, so it was reviewed in code only.

## High impact (fixed)

1. **Tabs were at the top, out of thumb reach, and scrolled sideways**, hiding 資訊, 測驗 and 畫廊. They are now a bottom tab bar with an icon and short label for all six, above the home indicator (safe-area inset). The full name stays as the accessible label.
2. **Header plus sticky calendar covered 38% of the screen** (104 + 202 px of 812) while reading a day. The calendar now scrolls away, and 前一天 / 後一天 buttons also sit at the end of each day.
3. **246 px of chrome before any content** on every tab. The header is now 56 px, the dates and countdown are one line, and the notice is smaller.

## Medium impact (fixed)

4. The day map's checkbox shared a class with the map page's floating toolbar, so it was absolutely positioned and could land on the calendar. It has its own class now.
5. The aurora table ran off the screen and was clipped. It now scrolls inside its own box.
6. Form fields under 16 px make iOS zoom in. All fields are 16 px on phones.
7. The tab fade took .35 s on every switch. It is now .18 s.
8. Hover zoom on plan cards could stick after a tap. It now applies only to devices with a real pointer. Tap delay and tap highlight are off for all controls.
9. The map page and toast now leave room for the tab bar.

## Already fine (kept)

No sideways page scroll on any tab. The place sheet has detents, momentum and rubber-banding, and so do the calendar and photos. Reduced motion, reduced transparency and higher contrast are supported, and the new bar follows them.

## Not changed

- **Bottom-sheet detail views elsewhere:** day detail stays a page; the place sheet already covers the map. A larger redesign with no clear gain.
- **Gallery photos under 44 px:** they are a drifting 3D field, where distant photos are small on purpose.
- **Map attribution links (14 px):** required by the map provider and rarely tapped.
- **Owner editor:** not checked on a live screen, because that needs Kai's sign-in.
