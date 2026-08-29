# Daily Challenges

Next.js (App Router) + NextAuth (Discord login) + Prisma (Postgres). Wordle /
Typing / Aim daily games, a weekly boss raid, an admin view, and a support
widget. Rewards pay out through UnbelievaBoat.

## Scaling / hosting notes

The boss raid is chatty (clicks flush every ~2.5s per fighter). On **Netlify
free + Supabase free** this is workable for a small server but has two hard
edges:

1. **Supabase free session pooler caps at ~15 connections.** `DATABASE_URL`
   pins each function to `connection_limit=1`; if you still see
   `FATAL: max clients reached`, raise the pool size in the Supabase dashboard
   (**Settings → Database → Connection pooling → Pool Size**, e.g. 15 → 40).
2. **DB region.** The project is in `ap-northeast-1` (Tokyo). If your players
   and host are far from there, every query pays 150–400ms. A fresh Supabase
   project in a closer region (then `pg_dump | pg_restore`) removes that.

For a bigger crowd, run the app as a **persistent process** instead of
serverless — e.g. [Koyeb](https://www.koyeb.com) free nano instance, or
`npm run build && npm start` on the same always-on box as the bot behind a
free Cloudflare Tunnel. A long-lived process keeps one warm 5-connection pool
forever: no cold starts, no exhaustion, and the in-process caches actually
work across every request.

## What's already wired up
- Next.js project structure, TypeScript, App Router
- NextAuth v5 configured with the Discord provider (`src/auth.ts`)
- Prisma schema with the models NextAuth's adapter needs (`prisma/schema.prisma`)
- A standalone script to test your UnbelievaBoat credentials in isolation,
  before any app code depends on them (`scripts/test-unbelievaboat.mjs`)

## Setup steps

### 1. Install dependencies
```bash
npm install
```

### 2. Discord Application (reuse your existing bot's app — don't create a new one)
1. https://discord.com/developers/applications -> open your bot's application
2. **OAuth2 -> General** -> copy **Client ID** and **Client Secret**
3. Under **Redirects**, add: `http://localhost:3000/api/auth/callback/discord`

### 3. Database (Supabase free tier, or any Postgres host)
1. https://supabase.com -> New Project
2. **Project Settings -> Database -> Connection string**
   - Copy the **pooled** connection string -> `DATABASE_URL`
   - Copy the **direct** (non-pooled) connection string -> `DIRECT_URL`

### 4. UnbelievaBoat API key
1. https://unbelievaboat.com/applications -> create/select your application
2. Copy the API token
3. Also grab your **Guild ID** (right-click your server icon in Discord ->
   Copy Server ID -- you need Developer Mode on) and your own **User ID**
   (right-click your username -> Copy User ID) for testing

### 5. Environment variables
```bash
cp .env.example .env
```
Fill in every value in `.env`. Generate `AUTH_SECRET` with:
```bash
npx auth secret
```

### 6. Test UnbelievaBoat BEFORE running the app
This confirms your token/guild/permissions work, isolated from everything else:
```bash
node scripts/test-unbelievaboat.mjs
```
You should see your current balance printed, then a new balance with +10 cash.
Check your server -- the bot's reward system should reflect the change. Do not
move to Phase 1/2 until this works.

### 7. Set up the database schema
```bash
npx prisma generate
npx prisma db push
```
`db push` creates the tables in Supabase from `prisma/schema.prisma`. You can
open Supabase's Table Editor afterward to confirm `User`, `Account`, `Session`,
and `VerificationToken` tables exist.

### 8. Run locally
```bash
npm run dev
```
Visit http://localhost:3000 -- you should see the "Phase 0" placeholder page.

### 9. Deploy to Vercel
1. Push this project to a GitHub repo
2. https://vercel.com -> New Project -> import the repo
3. Add all the same environment variables from `.env` in Vercel's project settings
   - Set `NEXTAUTH_URL` to your production URL (e.g. `https://yourapp.vercel.app`)
4. Deploy
5. Go back to the Discord Developer Portal and add a **second** redirect URI:
   `https://yourapp.vercel.app/api/auth/callback/discord`

## Phase 7 — hardening (rate limiting + admin/audit)

After pulling these changes, push the two new tables to your database:

```bash
npx prisma generate
npx prisma db push
```

This adds `RateLimit` (fixed-window API rate-limit counters) and
`SuspiciousAttempt` (the anti-cheat audit log). Both are safe to truncate.

- **Rate limiting** — every API route and the `mark complete` action call
  `src/lib/rate-limit.ts`. Limits are per client (Discord id when logged in,
  else IP) per minute; tune them with the `RATE_LIMIT_*` env vars.
- **Admin view** — `/admin` shows completions, payouts and flagged attempts.
  Gated to the Discord ids in `ADMIN_DISCORD_IDS`. A link appears in the
  header only for those users.
- **Audit log** — the typing and aim anti-cheat checks call
  `flagAttempt(...)` (`src/lib/audit.ts`) whenever they reject a submission
  as implausible. Benign failures (slow, unfinished, expired) are not logged.

## Phase 0 checklist
- [ ] `node scripts/test-unbelievaboat.mjs` succeeds and balance updates in Discord
- [ ] `npx prisma db push` succeeds, tables visible in Supabase
- [ ] `npm run dev` shows the placeholder homepage locally
- [ ] Vercel deployment is live and shows the same placeholder page
- [ ] Both redirect URIs (localhost + production) are saved in Discord Developer Portal

Once every box is checked, move to Phase 1 (Discord login).
