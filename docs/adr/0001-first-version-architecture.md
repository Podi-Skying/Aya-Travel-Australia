# ADR 0001: First-version architecture

Status: accepted, 2026-10-22. Decided by the owner (Kai) in the project thread; details in [PLAN.md](../../PLAN.md).

## Context
The static prototype in `site/` stored everything in one browser's `localStorage`. It could not provide owner login, cross-device sharing, aggregate visitor interest, link deactivation, or server-side privacy filtering. The trip starts on 3 November 2026, so the first version must be usable on phones within about 12 days. The project budget is AUD $0–500.

## Decision
- **Code hosting:** GitHub, private repository `Podi-Skying/Aya-Travel-Australia`.
- **Hosting:** Vercel (Hobby plan; private, non-commercial use), Root Directory `web`, deployed from GitHub.
- **Framework:** Next.js 16 App Router with React 19 and TypeScript (strict). The prototype CSS is reused as the global stylesheet.
- **Database:** Neon Postgres (Vercel Marketplace) through Drizzle ORM with committed SQL migrations. Local development and tests use PGlite, an in-process Postgres, so no database server is needed.
- **Data model:** each trip version is a full JSON snapshot validated by one Zod schema. Versions are append-only; restoring creates a new version. Writes lock the trip row and use optimistic concurrency (HTTP 409 on a stale base).
- **Owner login:** GitHub OAuth with next-auth v4 (the stable Auth.js line), JWT sessions, no database adapter. Only GitHub ids in `OWNER_GITHUB_IDS` may sign in (Podi-Skying = 32431832). Account recovery is GitHub's recovery flow.
- **Sharing:** random 32-byte tokens; only SHA-256 hashes are stored; one active link per trip. Visitors only ever receive a server-filtered document without addresses, driver names, or driver time windows.
- **Visitor interest:** per (activity, date, hashed browser key); the owner sees counts only; atomic per-voter and per-link hourly limits.
- **Offline:** a hand-written service worker (network first for pages and trip JSON, cache first for static assets) plus an IndexedDB copy with the last sync time.
- **AI (phase B, not built yet):** Claude API called only from the server with `ANTHROPIC_API_KEY`, owner-only, with a daily cap; AI output is a proposal validated by the same schema and applied only by owner selection.

## Alternatives considered
- Cloudflare Pages + Workers + D1: free and capable; not chosen because the owner preferred GitHub + Vercel.
- GitHub Pages + Supabase: no Vercel, but all access rules would live in Supabase row-level security and Next.js would be limited to static export.
- Vue/Nuxt: viable; React/Next.js chosen for Vercel integration, map/animation libraries, and tooling familiarity.
- Auth.js v5: still beta on npm when checked (2026-10-22); auth is isolated in `web/src/server/auth.ts` so it can be swapped later.
- Normalized itinerary tables: unnecessary for one trip; snapshots make versioning and restore exact.

## Consequences
- Vercel Hobby forbids commercial use; a public or commercial launch needs Vercel Pro.
- OpenStreetMap tiles are fine for private testing; a public launch needs a tile provider.
- Every new field in the trip document must pass the privacy filter; the filter fails closed if a driver name or address remains.
- Offline copies on visitors' devices cannot be recalled after deletion.
