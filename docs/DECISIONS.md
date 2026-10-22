# Interview Decision Log

This file records decisions and unresolved recommendations. Detailed behaviour belongs in the relevant requirements/rules documents.

## Confirmed through Stage 16
- First test focuses on the real trip. ~~Tasmania 25 October–26 November 2026 with Sydney 3–6 November~~ (superseded 2026-10-22, see below).
- Owner login; visitors can view shared links and submit interest without accounts.
- AI proposes full itineraries and changes; owner confirms changes before application.
- Preserve selected activities, explain conflicts, and suggest alternatives.
- Activity priorities: Must-do, Preferred, Replaceable.
- Three to four major activities daily is a flexible target, adjusted for feasibility.
- Show sources, update time when known, estimates, uncertainty, and feasibility.
- Whole-trip budget includes transport, accommodation, food, tickets/activities, and other relevant costs.
- UTAS Hobart Apartments is AUD $0 for the owner and Aya only while they stay there; other accommodation is budgeted separately.
- Do not rely on friend-provided driving until date and time are confirmed.
- Split shared vehicle costs by participants in the relevant driving leg.
- Immersive maps and animation are a high priority, subject to usability, accessibility, safety, and mobile performance.
- Private testing with the owner, Aya, and friends comes before broader expansion.

## Confirmed on 2026-10-22
- Trip dates: Sydney 3–6 November 2026 first, then Tasmania 6–27 November 2026 (25 days in total).
- The 25 October–2 November day plans are removed because the trip had not started; their attractions are kept, with full information, as an unscheduled attraction pool that the owner can add to days. Suggested dates are hints only.
- First-version architecture (see [ADR 0001](adr/0001-first-version-architecture.md)): code on GitHub, hosting on Vercel, Next.js (React + TypeScript), Neon Postgres, owner login with GitHub through Auth.js (next-auth v4), Claude API for AI planning in phase B (server-side, owner-only, daily cap).

## Proposed, awaiting confirmation
- Compare overnight accommodation with returning to base using travel time, fatigue, route, cost, transport access, and next-day plans.
- Protect Must-do activities from silent removal; resolve conflicts with explicit owner choice.
- For ordinary driving days, use 2–3 hours total driving as a provisional planning guideline, with exceptions for transfer days.

## TBD
- Exact driver dates/time windows.
- Accommodation nights and budget limits.
- Driving and rest limits.
- Login recovery, data freshness, major-alert thresholds, and service usage limits.
- Data-provider feasibility, first-version live-data boundary, and test thresholds.
- Visitor data correction process and offline-copy deletion expectations.

## Decided (previously undecided)
System architecture, framework, database, hosting provider, and AI provider were decided on 2026-10-22; see [ADR 0001](adr/0001-first-version-architecture.md). Live-data providers remain TBD.
