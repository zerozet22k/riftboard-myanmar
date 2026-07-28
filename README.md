# RiftBoard Myanmar

RiftBoard Myanmar is a Myanmar-focused League of Legends stats, rankings, tournament, and player tracking platform built with Next.js and TypeScript.

## Project Summary

This project is a personal/product-style portfolio piece that turns Riot account and match data into a localized community platform. It includes player profiles, leaderboards, match history, mastery pages, admin tools, Discord account linking, and tournament registration/management flows.

## Tech Stack

- Next.js 16 and React 19
- TypeScript
- MongoDB and Mongoose
- Riot API integrations
- Discord OAuth and linked-role flows
- Tailwind CSS 4 and PostCSS
- Zod for validation
- ESLint

## Main Features

- Player search by Riot ID
- Public player profile pages
- Ranked leaderboard views
- Match history and match detail panels
- Champion mastery table
- Player comments and profile refresh flow
- Admin player submission and removal tools
- Discord OAuth, player binding, and linked-role support
- Tournament creation, registration, team invites, and management pages
- TFT entry point prepared for separate Riot API credentials

## Code Evidence

- `src/app/p/[gameName]/[tagLine]` contains player profile and mastery routes.
- `src/app/leaderboard` contains ranking views.
- `src/components` contains reusable UI for search, profiles, matches, leaderboards, tournaments, and admin tools.
- `src/lib/riot.ts`, `src/lib/riotAuth.ts`, and `src/lib/refresh.ts` contain Riot data and refresh logic.
- `src/lib/discord*` and `src/app/api/discord` contain Discord linking and role integration flows.
- `src/lib/tournaments.ts` and `src/components/Tournament*` contain tournament workflows.

## My Role

Built independently as a product-focused community app, covering UI design, data modeling, API routes, Riot/Discord integration, admin workflows, and deployment configuration.

## Local Development

### Requirements

- Node.js 20 or newer
- npm
- MongoDB connection string
- Riot API credentials for live Riot data

### Install

```bash
npm install
```

If PowerShell blocks `npm.ps1`, use the Windows command shim instead:

```powershell
npm.cmd install
npm.cmd run dev
```

### Environment

Copy `.env.example` to `.env.local` and fill in your secrets before local development.

```powershell
Copy-Item .env.example .env.local
```

Important variables:

- `RIOT_API_KEY`: League of Legends production key
- `RIOT_TFT_API_KEY`: Teamfight Tactics production key
- `RIOT_ACCOUNT_REGION`: Riot account routing region, currently `asia` for this project
- `MONGODB_DNS_SERVERS`: optional DNS fallback for `mongodb+srv` lookups, for example `1.1.1.1,8.8.8.8`
- `LEADERBOARD_CRON_SYNC_MATCHES`: background leaderboard refresh also caches recent LoL match history, default `true`
- `LEADERBOARD_CRON_MATCHES_COUNT`: recent matches cached per player, default `5`
- `LEADERBOARD_CRON_MATCH_BACKFILL_COUNT`: older matches cached per pass, default `0`
- `RIOT_MIN_REQUEST_INTERVAL_MS`: shared Riot request pacing, default `1250`
- MongoDB and Discord variables as needed by the enabled flows

For Vercel deployments, add the same variables in the project environment settings. TFT syncing will stay disabled until `RIOT_TFT_API_KEY` is set.

### Riot API Safety

Public pages read saved data instead of calling Riot when somebody visits. Profile refreshes are
cooldown-protected and intentionally small. All server-side Riot calls share a paced queue, honor
`Retry-After`, and stop the current batch after a `429` response. Cron routes also share one database
lease, so leaderboard, TFT, live-game, admin, and public refresh work cannot pile up.

The defaults in `.env.example` are sized conservatively for a personal Riot key:

- `5` players per leaderboard/TFT pass
- `5` recent matches per player
- no automatic historical backfill
- at least `1250ms` between requests in the same routing group

Raise these only after Riot approves a larger production rate limit. Keep exactly one scheduler or
tray agent active for the same deployment.

### Google AdSense

AdSense is opt-in. Until both values below are configured, RiftBoard loads no Google advertising
script, renders no empty ad box, and returns `404` for `/ads.txt`.

- `NEXT_PUBLIC_GOOGLE_ADSENSE_CLIENT_ID`: the approved `ca-pub-...` publisher ID
- `NEXT_PUBLIC_GOOGLE_ADSENSE_LEADERBOARD_SLOT_ID`: the numeric display-ad slot ID

After AdSense approves the site:

1. Add both values to the production environment and redeploy.
2. Confirm `/ads.txt` returns the generated Google seller record.
3. Configure a Google-certified consent management platform for visitors where consent is required.
4. Keep ads away from controls and do not add more units solely to increase clicks.

### Run

```bash
npm run dev
```

### Useful Commands

```bash
npm run build
npm run lint
npm run discord:register
npm run discord:worker
```

`discord:worker` keeps a Discord Gateway connection open so new server members can receive the
`Riftboard: Bind Riot` onboarding role immediately. Enable the bot's Server Members Intent in the
Discord Developer Portal before running it.

## Screenshots / Demo

Screenshots and live demo links can be added here before sending the portfolio to a university or scholarship reviewer.

## License

All rights reserved. See `LICENSE`.
