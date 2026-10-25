# Australia Travel Planner

Requirements and the first version of a private travel planner for the real Sydney and Tasmania trip, 3–27 November 2026.

## Start here
- [Product brief](docs/PRODUCT_BRIEF.md)
- [Requirements and acceptance criteria](docs/REQUIREMENTS.md)
- [AI, itinerary and budget rules](docs/PLANNING_RULES.md)
- [Data, privacy and security](docs/DATA_AND_PRIVACY.md)
- [User flows](docs/USER_FLOWS.md)
- [Risks, decisions and roadmap](docs/PROJECT_CONTROL.md)
- [Interview decision log](docs/DECISIONS.md)
- [Architecture decision (ADR 0001)](docs/adr/0001-first-version-architecture.md)
- [Deploying to Vercel](docs/DEPLOY.md)
- Code: [`web/`](web/) (Next.js app); the original static prototype stays in [`site/`](site/)
- Plan and review log: [PLAN.md](PLAN.md), [PLAN-REVIEW-LOG.md](PLAN-REVIEW-LOG.md)

## Requirement status
- **Confirmed**: explicitly agreed in the interviews.
- **Proposed**: recommended, awaiting owner confirmation.
- **TBD**: unresolved.
- **Deferred**: intentionally outside the initial test scope.

## Guardrail
The first-version architecture is decided in ADR 0001. Changing the framework, database, hosting provider, or AI provider needs a new ADR. Live-data providers are still undecided.

## Research cache

Before searching the web again for prices, drive times or sources, check the database cache. Store new findings there too.

```bash
cd web
npm run cache -- list
npm run cache -- get fuel tas-u91
npm run cache -- put <kind> <key> '<json>' --source "<where>"
```

Road legs are kept in `route_cache`. They are computed once, when the owner views a driving day.
