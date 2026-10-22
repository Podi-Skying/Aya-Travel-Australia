# Requirements and Acceptance Criteria

Requirement IDs are used for discussion and testing. Items marked TBD in other documents are not silently treated as settled.

## Functional requirements

### Itinerary and AI
- **FR-01** The owner can view and edit the real trip itinerary.
- **FR-02** AI can propose a complete daily itinerary using dates, location, budget, interests, transport options, group size, activity priorities, and known constraints.
- **FR-03** The owner can accept a whole-day proposal or selected items; AI changes are not applied without confirmation.
- **FR-04** Preserve owner-selected activities unless the owner explicitly changes them. Explain conflicts and offer alternatives.
- **FR-05** Activities support three priorities: Must-do, Preferred, and Replaceable.
- **FR-06** Compare alternatives by travel time, estimated cost, content, opening hours, and feasibility.
- **FR-07** Keep the original and accepted versions. Record timestamp and change summary; restoring a version creates a new version.
- **FR-08** Recheck affected activities, travel times, transport, and budget after an accepted change.

### Transport and budget
- **FR-09** Plans can combine driving, ferry, public transport, and walking.
- **FR-10** A driving-dependent activity is executable only when driver, date, and time are confirmed; otherwise label the option tentative and offer a feasible alternative where possible.
- **FR-11** Show door-to-door travel time where available, separating driving, waiting, ferry, walking, and transfers.
- **FR-12** Reduce activity load on long-transfer, ferry, demanding-hike, or disruption days. Three to four major activities is a guideline, not a quota.
- **FR-13** Show itemised costs for transport, accommodation, food, tickets/activities, and other expenses.
- **FR-14** State each cost's unit and assumptions (for example per person, group, night, day, vehicle, or one-off) and whether it is estimated, quoted, or confirmed.
- **FR-15** Recalculate totals when dates, group size, or itinerary items change.
- **FR-16** Split shared driving costs among the people participating in that driving leg, and show the assumed participant count.
- **FR-17** Show whole-trip, category, group, and per-person totals where relevant. Unknown prices must be labelled unknown or estimated with explicit assumptions.

### Data, sharing, offline, and access
- **FR-18** Show source, last-checked/updated time where known, and verification/uncertainty status for important data.
- **FR-19** Flag conflicting sources and request owner confirmation rather than silently choosing.
- **FR-20** Show major disruptions, affected activities, and alternatives; never overwrite the original plan automatically.
- **FR-21** Shared links are view-only for the itinerary; visitors can submit interest for an activity/date without accounts.
- **FR-22** Visitors can edit or withdraw their own response where browser/device records permit. The owner sees aggregate counts, not individual voter management.
- **FR-23** The owner can deactivate a share link.
- **FR-24** Save core itinerary information for offline viewing, including daily order, locations, estimated travel times, budget, official links, alternatives, saved versions, and last-known alert status.
- **FR-25** Offline content displays its last-sync time and is not presented as current.
- **FR-26** The owner must log in and have an access-recovery path; the exact method is TBD.
- **FR-27** The owner can delete an itinerary and its associated server-side data.
- **FR-28** Hide the exact accommodation address by default; the accommodation name/area may be shared.
- **FR-29** AI can provide external booking links but cannot book or pay on the user's behalf.

## Non-functional requirements
- **NFR-01 Accessibility:** target WCAG 2.2 AA practices, including contrast, keyboard access, visible focus, alternative text, reduced-motion support, and non-map alternatives.
- **NFR-02 Responsive use:** core tasks work on mobile and desktop.
- **NFR-03 Resilience:** preserve saved work when AI or external data services fail.
- **NFR-04 Abuse and cost control:** use proportionate rate limits for AI generation and public interest submissions; manage billable usage and degrade gracefully at limits.
- **NFR-05 Data integrity:** never present stale, estimated, or uncertain information as verified.
- **NFR-06 Visual experience:** immersive maps and animation must not obscure itinerary details, cost, transport, accessibility, or safety warnings; decorative media may degrade on slow networks.

## Release acceptance checks
- A tester can understand the day's plan, transport, timing, estimated costs, and warnings on a phone.
- The owner can generate an itinerary, review assumptions and conflicts, and apply only selected changes.
- Budget totals respond correctly to party-size and itinerary changes.
- Share-link visitors can view the plan and submit interest without an account; duplicate responses are reasonably limited, with limitations understood.
- Known closures and impossible transport connections are not labelled executable or verified.
- A driver-dependent plan is not confirmed before the driver, date, and time window are confirmed.
- Version restoration creates a new version and preserves history.
- Offline content clearly shows its last-sync time.
- Core itinerary information remains usable if maps, animation, video, AI, or a data provider fails.
- Exact accommodation address is hidden by default.
- Test with the owner, Aya, and friends. The initial small group is not representative of all travellers.

Detailed test cases, performance thresholds, devices, and network conditions remain TBD.
