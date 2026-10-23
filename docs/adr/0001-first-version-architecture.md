# ADR 0001: First-version architecture

Status: accepted, 2026-10-22. Decided by the owner (Kai) in the project thread; details in [PLAN.md](../../PLAN.md).

## Context
The static prototype in `site/` stored everything in one browser's `localStorage`. It could not provide owner login, cross-device sharing, aggregate visitor interest, link deactivation, or server-side privacy filtering. The trip starts on 3 November 2026, so the first version must be usable on phones within about 12 days. The project budget is AUD $0–500.

## Decision
- **Code hosting:** GitHub, private repository `Podi-Skying/Aya-Travel-Australia`.
- **Hosting:** Vercel (Hobby plan; private, non-commercial use), Root Directory `web`, deployed from GitHub.
- **Framework:** Next.js 16 App Router with React 19 and TypeScript (strict). The prototype CSS is reused as the global stylesheet.
- **Database:** Neon (Lakebase Postgres), project `quiet-mountain-96197074`, branch `production`, region aws-ap-southeast-2, through Drizzle ORM with committed SQL migrations. The app connects with node-postgres over the pooled URL and `attachDatabasePool` on Vercel Fluid compute (Neon's guidance for Vercel; changed from `@neondatabase/serverless` on 2026-10-22); migrations use the direct URL. Local development and tests use PGlite, an in-process Postgres, so no database server is needed.
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
- Map tiles: OpenStreetMap standard tiles. On 2026-10-23 they were blocked because the site sent `Referrer-Policy: no-referrer` and OSM's tile policy requires a Referer; fixed by sending the origin. OSM tiles suit light private use only; a public launch needs a commercial tile provider. (CARTO's basemaps now require an API key, so they were not used.) The site sends `Referrer-Policy: strict-origin-when-cross-origin`, so tile servers see only the origin, never a share-link path.
- Every new field in the trip document must pass the privacy filter; the filter fails closed if a driver name or address remains.
- Offline copies on visitors' devices cannot be recalled after deletion.

## Addendum 2026-10-23: attraction photos

- The trip site is private (owner + share link) and will be taken down after the trip, so attraction photos are **hotlinked** from the page they were found on: an official or tourism site's `og:image`, otherwise a Wikimedia Commons file. Each photo shows a visible source link; Commons photos also show author and licence. Images are never copied into our storage or proxied.
- Not used: Google Images and Google Maps photo endpoints (terms of service, bot protection). A site that blocks hotlinking (Salamanca Market returned 403 even without a Referer) falls back to Commons instead of a proxy.
- Photos are sent only to the owner and share-link viewers. The anonymous public pages strip the `photo` field (`toPublicDoc(doc, { photos: false })`), and pages stay `noindex`.
- The enrichment ran once as an owner script and was written as a normal restorable version after a JSON backup. It respected robots.txt, rate-limited to about one request per second, and used an honest User-Agent (per Wikimedia's API policy).
- **Possible later source: Google Places API (New) Place Photos.** Use it only if the owner creates a `GOOGLE_PLACES_API_KEY` (paid per request after the free tier). Google's terms require showing `authorAttributions`, keeping the key server-side, and storing only place ids and photo names, not photo bytes. Not implemented, because no key exists.
