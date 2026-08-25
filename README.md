# Daily Challenges — Phase 0 Scaffold

Next.js (App Router) + NextAuth (Discord login) + Prisma (Postgres) scaffold.
This is the Phase 0 foundation: no games, no rewards logic yet — just proving
the environment works end to end.

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

## Phase 0 checklist
- [ ] `node scripts/test-unbelievaboat.mjs` succeeds and balance updates in Discord
- [ ] `npx prisma db push` succeeds, tables visible in Supabase
- [ ] `npm run dev` shows the placeholder homepage locally
- [ ] Vercel deployment is live and shows the same placeholder page
- [ ] Both redirect URIs (localhost + production) are saved in Discord Developer Portal

Once every box is checked, move to Phase 1 (Discord login).
