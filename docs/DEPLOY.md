# Deploying the first version (owner steps)

These steps need your own accounts. Nothing here was done for you automatically.

## 1. GitHub OAuth App (owner login)
1. GitHub → Settings → Developer settings → OAuth Apps → **New OAuth App**.
2. Homepage URL: your Vercel URL (for example `https://aya-travel-australia.vercel.app`).
3. Authorization callback URL: `https://<your-vercel-domain>/api/auth/callback/github`.
4. Copy the **Client ID**, then generate and copy a **Client secret**.

## 2. Vercel project
1. Sign in to Vercel with GitHub and **Add New → Project**, then import `Podi-Skying/Aya-Travel-Australia`.
2. Set **Root Directory** to `web`. Framework preset: Next.js.
3. **Storage → Neon** (Marketplace): create a free database and connect it to the project. This sets `DATABASE_URL`.
4. Environment variables (Production):
   - `NEXTAUTH_SECRET`: output of `openssl rand -base64 32`
   - `NEXTAUTH_URL`: your production URL (GitHub sends sign-ins back to this address only, so sign-in works on production, not on preview deployments)
   - `GITHUB_ID`, `GITHUB_SECRET`: from step 1
   - `OWNER_GITHUB_IDS`: `32431832`
   - `VOTER_HASH_SALT`: output of `openssl rand -hex 16`
5. Deploy.

## 3. Create the tables and the trip (once)
On your computer, in `web/`, with the Neon connection string from Vercel:

```bash
cd web
npm ci
DATABASE_URL="<neon connection string>" npm run db:migrate
DATABASE_URL="<neon connection string>" OWNER_GITHUB_IDS=32431832 npm run db:seed
```

`db:seed` creates version 1 (Sydney 11/3–11/6, Tasmania 11/6–11/27, plus the unscheduled attraction pool). It does nothing if a trip already exists.

## 4. Check (on the production URL)
1. Open the production site and sign in with GitHub as Podi-Skying. Another GitHub account gets a 403 page.
2. 版本與分享 → 建立分享連結. The link is shown once; open it in a private window to check what visitors see.
3. On your phone, open the site once while online. Then turn on airplane mode and reload: the itinerary and the last sync time remain visible, with an offline notice.

## Local development
```bash
cd web
cp .env.example .env.local   # fill NEXTAUTH_SECRET, OWNER_GITHUB_IDS; leave DATABASE_URL empty to use PGlite in .pglite/
npm ci
npm run db:seed
npm run dev
```
GitHub login on localhost needs a second OAuth App with callback `http://localhost:3000/api/auth/callback/github`.
