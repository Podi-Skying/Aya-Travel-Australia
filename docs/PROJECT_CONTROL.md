# Risks, Open Questions, and Roadmap

## Main risks
- Full AI planning and live data may exceed the AUD $0–500 budget.
- Provider access, licensing, rate limits, and data freshness are unconfirmed.
- Driver availability is not yet confirmed for specific dates or time windows.
- Public links expose travel dates and activity patterns.
- Browser/device-based duplicate-interest prevention is imperfect.
- Offline data may become stale after an alert or schedule change.
- AI edits may create downstream route, time, and budget conflicts.
- Free, dependable real-time transit, accommodation, and car-hire prices may not be available.
- Overloaded days may be unrealistic even when individual activities are open.
- Immersive media may affect performance, accessibility, or warning visibility.
- Accommodation comparisons can mislead if price, availability, or cancellation terms are stale.
- Shared-cost calculations can be wrong if participants vary by driving leg.

## Open questions
- Exact dates and time windows Zayden and JJ can drive; passenger and route constraints.
- Paid accommodation nights and acceptable nightly/whole-trip budget.
- Driving-time ceiling and rest-break policy.
- Required accommodation comparison details and preferred decision criteria.
- Owner login and recovery method.
- Data freshness thresholds and definition of a major alert.
- AI/data usage limits and which sources are feasible within budget.
- Which first-version data must be live versus estimated or linked externally.
- Who participates in each driving leg and how the owner updates that list.
- How to report incorrect data if no feedback feature is included.
- Exact performance thresholds and test conditions.

## Roadmap
1. **Requirements baseline:** separate confirmed requirements from proposals and TBDs; define MVP boundaries and acceptance tests.
2. **Private trip prototype:** present the real itinerary, maps, timeline, transport, budget, sources, and warnings; prioritise immersive maps/animation while protecting core usability.
3. **AI-assisted planning:** generate full itineraries, explain uncertainty, accept selected changes, validate dependencies, and preserve versions.
4. **Sharing:** view-only links, interest responses, aggregate counts, privacy defaults, and link deactivation.
5. **Offline and resilience:** save core details and last-sync status; test poor networks and service failures.
6. **Expansion:** broaden destination/date coverage after validating the real trip and confirming data feasibility.

This roadmap describes product sequence only. It does not select architecture or implementation technology.
