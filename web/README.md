# Aya travel planner (web)

Next.js app for the first version. Architecture: [../docs/adr/0001-first-version-architecture.md](../docs/adr/0001-first-version-architecture.md). Deployment: [../docs/DEPLOY.md](../docs/DEPLOY.md).

```bash
npm ci
npm run lint
npm run typecheck
npm test        # unit, PGlite integration, and legacy-prototype parity tests
npm run build
```

- `src/domain/`: trip schema, budget and planning rules (ported from `site/js/app.js`), pool operations, privacy filter, journey data.
- `src/server/`: database, auth, owner and public handlers.
- `src/components/`: React UI; `src/components/journey/` is the 3D journey page.
- `scripts/`: migrations, seed (`seed-2026-11.ts` builds the 11/3–11/27 itinerary from `site/js/data.js`).
- `drizzle/`: SQL migrations.
