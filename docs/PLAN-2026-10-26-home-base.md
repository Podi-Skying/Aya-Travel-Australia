# Plan 2026-10-26g: UTAS Hobart Apartments as the home base

Kai: UTAS Hobart Apartments is where they sleep every night, unless a multi-day trip of two or more days takes them elsewhere. It needs a clear landmark on the map.

## Built

- **Night stay (`domain/stay.ts`, `nightStay`)**
  - A Tasmania night is the `home` stay (UTAS), unless an applied (chosen) 跨日行程方案 covers that date, or the day carries a 「住宿：…」 note for its own stay.
  - Sydney nights keep their stay (the Sydney hotel).
  - The budget, checklist, day view and warnings use it, so applying or clearing a plan switches the night automatically.
  - Base nights cost $0 (the UTAS nightly price is 0).
- **Stay positions**
  - `stays.*.lat/lng` are optional.
  - UTAS: 157 Elizabeth St, Hobart (Google Places, the only exact-name match; Kai to confirm).
- **Privacy (`toPublicDoc`)**
  - Owner: exact position, name and address.
  - Share link: name, with the position rounded to 0.003° (about 300 m).
  - Public visitors: no stay positions. The home base appears as 「住處」, including in activity text (「UTAS」 is replaced), and its internal key is renamed to `home`.
- **Map**
  - 住處 landmark: a vermilion hand-drawn house on a paper ring, larger than activity pins, with a 44px hit area.
  - On the whole-trip map it is always visible, for every stay used for a night. On a selected day, and on each day's own map, the day's start (last night's stay) and end (tonight's stay) connect to the first and last stops with dashed lines.
  - The map legend gains 「住處」.
- **Day view:** a 「今晚住：UTAS 公寓 / <stay>」 line under the title. There are no daily check-in or check-out activities.

## Data (v104)

- `stays.utas`: `home: true`, position, and the address (pending Kai's confirmation). `stays.syd`: position.
- The East Coast plan is applied on 11/9–11 and the Cradle + Stanley + Penguin plan on 11/16–18 (Kai's decision), keeping the out-of-town stays and the driver costs.
- No activity is lost. Kai's Penguin and Stanley entries move from 11/9 to the Cradle plan's 11/17–18.

## Tests

- Public visitors get no UTAS name, key or position; share links get rounded positions.
- `nightStay` defaults to home and honours stay notes.

## Inspection 1: dispositions

- **PRIV-001, accepted.** Activities about the home base (their name mentions it, e.g. 「機場前往 UTAS 公寓入住」) follow the stay's rule. Public visitors get no position; share links get it rounded to about 300 m. A test covers this.
- **STAY-001, rejected with clarification.** A stay note is honoured together with the day's stored stay. It cannot pick a different stay by its text, because note texts like 「住宿：搖籃山附近（待確認）」 don't name a stay key reliably. Applied plans set the stored stay, so they are covered.
- **DATA-001, partly accepted.** The seed's home stay now carries the UTAS position. The live trip has both positions from the data write. The seed's legacy Sydney stay is not the live Sydney hotel record, and seeds only create new trips.
- **MAP-001, accepted.** Whole-trip bounds include the stay pins, and the selected day's bounds include its start and end stays.
- **STAY-002, accepted.** The schema rejects two applied plans that claim the same night. A test covers this.
