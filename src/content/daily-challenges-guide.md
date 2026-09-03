# Daily Challenges — site guide (for the assistant)

This is the reference the website assistant uses to answer questions about the
**Daily Challenges** site. Everything a player can ask about the site, its games,
coins, streaks, the shop and the weekly boss should be answered from here. If a
detail isn't here, say so plainly — don't invent rules.

## What the site is

A daily-challenge hub tied to the Discord server. You sign in with Discord. Every
day there is a fresh set of small games. Coins are the server currency, handled by
the UnbelievaBoat bot (the same balance shown in Discord). Your coin balance has
**cash** (on hand) and **bank** (banked); the header shows both plus the total.

**One grace per day:** each game can be *completed* once per day for its reward.
After that the game still opens but pays nothing until the next daily reset.

**Daily reset** happens at **midnight in the challenge timezone (Asia/Bahrain)**.
"Today" everywhere on the site means that day.

## The games

There are six sections. Each has its own page and its own reward.

| Game | Path | What you do |
|---|---|---|
| Wordle | `/wordle` | Guess the day's 5-letter word. |
| Typing Test | `/typing` | Type the passage accurately and fast. |
| Aim Trainer | `/aim` | Hit the targets before the timer runs out. |
| The Litany | `/litany` | Memorise and repeat a growing sequence. |
| Geometry Dash | `/geodash` | A staked auto-runner — see its own section below. |
| Boss Raid | `/boss` | The weekly co-op fight — only live on its window (see below). |

Default rewards (the server owner can change these): Wordle 250, Typing 200,
Aim 200, Litany 200. Geometry Dash has no fixed reward — it is a staked game.

### Retry rules (per game, per day)

- **Wordle** — the standard six guesses. Get it in six to complete the day.
- **Typing** — the first several failed attempts are free. Past that, each further
  fail lowers that day's typing prize; once the prize would reach zero, the day's
  typing is **failed** (locked until reset).
- **Aim** — a few losing runs are allowed; after that the day's aim round is
  **failed**.
- **The Litany** — you pass the day by clearing a sequence of a set length. Going
  further than that on a successful run adds a small bonus to the prize, up to a
  ceiling.

Exact numbers are set by the server owner and can change; if asked for the precise
current value, say it depends on the server's configuration.

### Geometry Dash (`/geodash`) — the staked game

A pay-to-play auto-runner. **One paid run per day.** You choose a difficulty, the
fee is charged up front, and the run starts blind (no preview, no practice).

- **Difficulties:** Easy, Medium, Hard, Impossible. The difficulty you pick is
  **locked for the rest of that day** — you can't switch.
- **Easy / Medium / Hard:** a fixed entry fee (default 100 coins). Winning pays the
  fee back plus a reward — a net gain of roughly +100 (easy), +300 (medium),
  +500 (hard). The confirm screen shows the exact fee and reward.
- **Impossible:** you choose your own stake (a minimum applies, default 5000, no
  maximum). A win pays **5× your stake**.
- **Dying forfeits the stake.** No payout.
- **Free restarts:** after a death you can restart a limited number of times per
  fee (default 5) at no extra cost. Run out of restarts and you must pay the fee
  again to keep going — on Impossible, re-paying lets you pick a new stake and the
  5× payout is on that new stake.
- Restarts reset when you re-pay and at the daily reset.
- **Abandoning** a run you never finished (and never died on) refunds the stake and
  does **not** use up the day's run. A network or loading failure refunds too.
- A win counts as a completion (it credits your streak / perfect day). A loss shows
  the red "Failed" stamp for the day.
- The obstacle set includes spikes, blocks, ceiling hazards, floating bars, moving
  crushers/sweepers, spinning blades, jump orbs and jump pads. Orbs briefly slow
  time and zoom in to help you land the tap.

### Weekly Boss — "Veyrath, The Hollow Sovereign" (`/boss`)

A once-a-week co-op raid. It spawns **Saturday at 16:00 (Asia/Bahrain)** and
vanishes at **23:59** the same day. The Discord server gets an announcement when it
spawns.

- You fight by **clicking** — every click chips its health down.
- **If the raid kills it:** a reward pool is split between everyone who fought, in
  proportion to the damage they dealt. Payouts land when the window closes.
- **If it survives:** every fighter loses a fixed penalty in coins.
- Boss name, health, reward pool, penalty and schedule are set by the server owner
  on the admin side and can change week to week.

## Streaks, perfect days, ranks

- Completing *any* game on a day keeps your **streak** alive; missing a whole day
  breaks it.
- A **perfect day** is completing every game that day.
- `/leaderboard` ranks players by streak.
- `/me` shows your own record — streak, best scores per game, history.

## The shop (`/shop`)

Buy things with **banked** coins. Payment comes off immediately and the reward
(currently Discord roles) is applied by the bot right away. Temporary passes are
removed automatically when they expire.

**Right now the shop is empty** — it shows a "wares coming soon" state. New items
and ranks will appear there later. Tell players to bank their coins so they're
ready.

## Support / bugs / suggestions

There is no support form on the website. To report a bug or suggest something,
players use the Discord bot's **`/report`** slash command — it opens a short form
and sends it straight to the server owner.

## If the assistant itself is failing

If the assistant can't reach its language model, the site shows a message saying
the assistant is temporarily unavailable and that the keeper (owner) has been
alerted automatically. Players should just try again a little later.
