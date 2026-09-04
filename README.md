# Daily Challenge

A self-hosted web application that runs a set of daily skill-based games for a Discord community. Players sign in with their Discord account, play that day's challenges once each, and build up streaks, personal bests, and (optionally) in-server currency over time. A weekly boss event and a small achievement system run alongside the daily games, and an admin panel gives the server owner visibility into activity, payouts, and flagged attempts.

The project is a Next.js application backed by a PostgreSQL database. Discord is used for sign-in and, optionally, for paying out rewards and granting roles; the games themselves run entirely on the website, not inside Discord.

## Overview

Each day, at a configurable reset time, a new round of challenges becomes available to every signed-in player: a daily word-guessing game, a typing speed test, an aim/reaction trainer, a memory sequence game, and a staked, difficulty-based run through an obstacle course. Each one can be completed once per player per day. Completing a challenge for the first time that day can pay out a coin reward through an external currency integration (UnbelievaBoat), if one is configured.

On top of the daily games, the site runs a recurring weekly boss encounter shared by the whole server, tracks per-player streaks on a public leaderboard, and awards a small set of one-time achievements for specific milestones. A restricted admin panel covers completion activity, payouts, anti-cheat flags, support submissions, and per-game on/off switches.

Built with:
- Next.js (App Router) and TypeScript
- NextAuth, using Discord as the sign-in provider
- Prisma and PostgreSQL
- UnbelievaBoat's API for the optional currency integration

## Features

- Five daily challenges, each completable once per calendar day per player:
  - A word-guessing game with a fixed number of guesses, using the same word for every player on a given day.
  - A timed typing test, scored on speed and accuracy, with a mistake limit.
  - A reaction/aim trainer where the player clears a set of targets before time runs out.
  - A memory sequence game where each round adds one step to a growing pattern; a player can bank an early reward or keep going for a larger one at the risk of losing it.
  - A staked, auto-running obstacle course with selectable difficulty tiers, each with its own entry cost and payout.
- A weekly boss event: one boss is drawn at random from a configurable roster each week (never repeating the previous week's pick), each with a different fight mechanic. Damage is tracked per player, and the reward pool is split by contribution when the boss is defeated; a penalty applies to participants if it survives its time window instead.
- An achievement system: a small, code-defined set of one-time achievements (first completion, a full week of perfect days, a high score on a specific game, taking part in a boss kill, clearing every challenge in a single day), each paying a coin bonus, a permanent reward multiplier, or a Discord role. A short on-screen notice appears the first time a player earns one.
- Streaks and a leaderboard: consecutive days of clearing every challenge are tracked per player and ranked publicly.
- A personal stats page with streak history, a completion heatmap, and per-game personal bests.
- A configurable shop where players can spend earned coins on Discord roles, including time-limited passes.
- A feedback widget for bug reports and suggestions, with an optional AI-assisted chat for answering player questions about the site.
- Rate limiting and anti-cheat checks on every scored action, with flagged attempts logged for review rather than silently rejected.
- An admin panel, restricted to a configurable list of Discord user IDs, covering activity, payouts, flagged attempts, support submissions, and per-game on/off switches.
- A dev mode toggle for admin accounts that removes the daily cooldown for testing, without recording results or paying out rewards.

## Setup / Installation

### Prerequisites

- Node.js 20 or later
- A PostgreSQL database (any host works; a free tier from a provider such as Supabase or Neon is sufficient to start)
- A Discord application, for sign-in (see step 1)
- Optional: a Discord bot token and an UnbelievaBoat account, if you want coin rewards and role grants to work

### 1. Create a Discord application

1. Open the Discord Developer Portal and create a new application.
2. Under OAuth2 > General, copy the Client ID and Client Secret.
3. Under OAuth2 > Redirects, add:
   - `http://localhost:3000/api/auth/callback/discord` for local development
   - `https://yourdomain.com/api/auth/callback/discord` once you have a production URL
4. If you want the site to grant Discord roles (shop purchases, the achievement role reward), add a bot user to the same application and note its token. When you invite the bot to your server, grant it the "Manage Roles" permission and place its role above any role it will be asked to grant.

### 2. Install dependencies

```bash
npm install
```

### 3. Set up a database

Create a PostgreSQL database with any provider. You will need two connection strings: a pooled connection for normal queries and a direct (non-pooled) one for schema changes. Most managed Postgres providers expose both.

### 4. Configure environment variables

```bash
cp .env.example .env
```

Fill in `.env`. At minimum:

| Variable | Purpose |
| --- | --- |
| `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | From step 1 |
| `AUTH_SECRET` | Session signing secret; generate with `npx auth secret` |
| `DATABASE_URL`, `DIRECT_URL` | From step 3 |
| `NEXTAUTH_URL` | The site's own URL (`http://localhost:3000` locally) |

Optional, for the features that depend on them:

| Variable | Enables |
| --- | --- |
| `UNBELIEVABOAT_API_TOKEN`, `UNBELIEVABOAT_GUILD_ID` | Coin rewards for completing challenges and achievements |
| `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID` | Role grants from the shop and from achievements |
| `ADMIN_DISCORD_IDS` | Comma-separated Discord user IDs allowed to open the admin panel |
| `BOSS_RESOLVE_SECRET` | Shared secret used to authorize an external process settling the weekly boss (see "Weekly boss" below) |
| `GEMINI_API_KEY` | Enables the optional AI chat assistant |

The full list, including per-game reward amounts, rate limits, and the boss schedule, is documented with comments in `.env.example`. Every optional integration degrades gracefully when unset: the site still runs, it just skips that feature.

### 5. Set up the database schema

```bash
npx prisma generate
npx prisma db push
```

### 6. Run it

Development:

```bash
npm run dev
```

Production:

```bash
npm run build
npm run start
```

The site listens on port 3000 by default.

### Notes on hosting

If you deploy on a serverless platform with a database connection pooler (for example, Supabase's free tier), be aware of its connection limit; the default `.env.example` values pin each function instance to a single connection to stay under typical free-tier caps. If you expect steady traffic, running the app as a long-lived process (rather than serverless functions) keeps one warm connection pool and avoids cold starts. Also keep your database and your host in the same region where possible; cross-region queries add noticeable latency to every request.

## How to Use

This project is a website, not a Discord bot with slash or prefix commands. There are no commands to register or invoke; once the site is running, its full feature set is reachable from the browser after a player signs in with Discord.

### Adding it to your server

1. Deploy the site following the setup steps above, either for local testing or to a production host (any platform that runs a Node.js server or a Next.js app works).
2. Share the site's URL with your community, for example by pinning it in a channel.
3. Members sign in using the "Enter with Discord" button on the landing page. No separate account or registration step is needed.

### Playing the daily challenges

- The dashboard lists all five games and shows, for each one, whether it is open, already completed for the day, or locked out after too many failed attempts.
- Challenges reset once every 24 hours, at midnight in the timezone set by `CHALLENGE_TZ` in `.env`.
- A player's streak, personal bests, and completion history are visible on their own stats page and, for streaks, on the public leaderboard.

### Weekly boss

- One boss is drawn at random from the roster each week and is active for a fixed window, configured with the `BOSS_SPAWN_DOW`, `BOSS_SPAWN_HOUR`, `BOSS_DESPAWN_HOUR`, and `BOSS_DESPAWN_MIN` variables.
- Players deal damage from the boss's page on the site while it is active.
- When the window closes, something needs to call `POST /api/boss/resolve` with the header `Authorization: Bearer <BOSS_RESOLVE_SECRET>` to pay out the reward pool or apply the penalty. The site has no built-in scheduler for this; run it from a scheduled job, or from a bot or script you control that can make an HTTP request on a timer.

### Admin panel

- Sign in with a Discord ID listed in `ADMIN_DISCORD_IDS`, then visit `/admin`.
- The panel covers recent activity, payouts, anti-cheat flags, support submissions, and switches to take individual games offline.
- `/admin/boss` manages the boss roster: health, reward pool, penalty, and mechanic-specific settings for each boss.

## Permissions

If you connect a bot token so the site can grant Discord roles (shop purchases, the achievement role reward), that bot needs:

- The "Manage Roles" permission in your server
- A role positioned above every role it may be asked to grant or remove

No other Discord permissions are required, and no slash commands need to be registered, since the site has no bot commands of its own.
